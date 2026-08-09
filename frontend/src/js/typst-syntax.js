/**
 * Simple Typst syntax highlighting for Monaco.
 *
 * Regexes from the official Typst TextMate grammar
 * (typst/typst -> tools/support/typst.tmLanguage.json), flattened for
 * Monarch. Order matters: the first rule that matches wins.
 *
 * Four tokenizer states mirror Typst's structure:
 * - root    : markup, the document body
 * - content : markup inside a content block [...]
 * - codeEOL : Typst code after #..., ends at end of line
 * - code    : Typst code inside { ... }, may span lines
 * - string  : "..." strings inside code
 *
 * Strong  *bold*  and emphasis  _italic_  only apply in markup states
 * (root / content). In code, `_` belongs to identifiers
 * (first_line_indent) and `*` is the multiplication operator.
 * Content blocks [...] may span several lines.
 *
 * Two tables to edit:
 *
 * 1. RULES  : "when the text contains X, token is Y"
 *    Each entry is [pattern, token], `token` is a color key from COLORS.
 *
 * 2. COLORS : "token Y has this color in light/dark theme"
 *    If a token has no entry here, Monaco keeps its default theme color.
 */

import * as monaco from 'monaco-editor';

// ## Markup rules (document body and content blocks) #######################

const MARKUP_RULES = [
    // Escape sequences
    [/\\[\\/\[\]{}#*_=~`$\-.]|\\u\{[0-9a-zA-Z]*\}?/, 'escape'],
    [/\\/, 'escape'], // linebreak

    // Text shorthands characteristic of Typst
    [/~/, 'punctuation'],     // non-breaking space
    [/-\?/, 'punctuation'],   // soft hyphen
    [/---/, 'punctuation'],   // em-dash
    [/--/, 'punctuation'],    // en-dash
    [/\.\.\./, 'punctuation'],// ellipsis

    // Symbols :name:
    [/:[A-Za-z0-9]+:/, 'symbol'],

    // Links (before comments so https://... is not seen as a comment)
    [/https?:\/\/[0-9a-zA-Z~\/%#&=',;.+\?]*/, 'link'],

    // Comments
    [/\/\*[^*\n]*\*\//, 'comment'],
    [/\/\/[^\n]*/, 'comment'],

    // Strong (*bold*) and emphasis (_italic_): only when the delimiter is
    // surrounded by non-word characters, so first_line_indent or a*b*c in
    // plain text are never mistaken for them. Since Monarch matches rules
    // against line.substr(pos), a plain ^ would match at every position:
    // two rules are needed - one anchored to the true line start
    // (Monarch sets matchOnlyAtLineStart), one that requires (and consumes)
    // a non-word character before the delimiter.
    [/^\*{1,2}[^*\n]+\*{1,2}(?=[\W_]|$)/, 'strong'],
    [/[\W_]\*{1,2}[^*\n]+\*{1,2}(?=[\W_]|$)/, 'strong'],
    [/^_{1,2}[^_\n]+_{1,2}(?=[\W_]|$)/, 'emphasis'],
    [/[\W_]_{1,2}[^_\n]+_{1,2}(?=[\W_]|$)/, 'emphasis'],

    // Raw text (`` `code` `` and blocks of 3+ backticks)
    [/`{3,}[\s\S]*?`{3,}/, 'raw'],
    [/`[^`\n]*`/, 'raw'],

    // Math ($x^2 + 1$)
    [/\$[^$\n]*\$/, 'math'],

    // Heading marker (= Only the mark, like the official grammar)
    [/^\s*=+\s+/, 'heading'],

    // Lists (-, 1., +, term:)
    [/^\s*-\s+/, 'punctuation'],
    [/^\s*([0-9]*\.|\+)\s+/, 'punctuation'],
    [/^\s*\/\s+[^:\n]*:/, 'punctuation'],

    // Labels <name> and references @name
    [/<[A-Za-z_][A-Za-z0-9_-]*>/, 'label'],
    [/@[A-Za-z_][A-Za-z0-9_-]*/, 'reference'],

    // Code expressions (#... always switch to code mode)
    [/#(let|set|show|context|as|in|import|include|export|return|break|continue|for|while)\b/, 'keyword', 'codeEOL'],
    [/#(if)\b/, 'keyword', 'codeEOL'],

    // Function calls #name(, #name[
    [/#[A-Za-z_][A-Za-z0-9_-]*!?(?=\[|\()/, 'function', 'codeEOL'],
    // Interpolation #var, #var.field
    [/#[A-Za-z_][A-Za-z0-9_.-]*/, 'variable', 'codeEOL'],
    [/#(?=\S)/, 'bracket', 'codeEOL'],

    // Code-ish constructs that also appear in markup prose
    [/=>|\.\./, 'operator'],
    [/==|!=|<=|<|>=|>/, 'operator'],
    [/\+=|-=|\*=\/|=/, 'operator'],
    [/[+*\/]|-(?![A-Za-z0-9_-]*[A-Za-z_])/, 'operator'],

    // Constants
    [/\bnone\b|\bauto\b|\b(true|false)\b/, 'constant'],

    // Numbers with units
    [/\b(\d*)?\.?\d+([eE][+-]?\d+)?(mm|pt|cm|in|em)\b/, 'number'],
    [/\b(\d*)?\.?\d+([eE][+-]?\d+)?(rad|deg)\b/, 'number'],
    [/\b(\d*)?\.?\d+([eE][+-]?\d+)?%/, 'number'],
    [/\b(\d*)?\.?\d+([eE][+-]?\d+)?fr/, 'number'],
    [/\b(0x[0-9a-fA-F]+|(0b|0o)?\d+)\b/, 'number'],
    [/\b(\d*)?\.?\d+([eE][+-]?\d+)?\b/, 'number'],

    // Content block [ ... ] (may span several lines)
    [/\[/, 'bracket', 'content'],
];

// ## Code rules (shared by codeEOL and code) ###############################

const CODE_RULES = [
    [/\/\*[^*\n]*\*\//, 'comment'],
    [/\/\/[^\n]*/, 'comment'],

    // Strings can span lines
    [/"/, 'string', 'string'],

    // Content block inside code: #name[ ... ]
    [/\[/, 'bracket', 'content'],
    // ] closes the content block
    [/\]/, 'bracket', '@pop'],

    // Code blocks { ... } may span lines
    [/\{/, 'bracket', 'code'],
    [/\}/, 'bracket', '@pop'],

    // Groups
    [/\(/, 'bracket'],
    [/\)/, 'bracket'],

    // Separators
    [/,:;/, 'punctuation'],

    // Operators
    [/=>|\.\./, 'operator'],
    [/==|!=|<=|<|>=|>/, 'operator'],
    [/\+=|-=|\*=\/|=/, 'operator'],
    [/[+*\/]|-(?![A-Za-z0-9_-]*[A-Za-z_])/, 'operator'],
    [/\b(and|or|not)\b/, 'operator'],

    // Constants
    [/\b(none|auto|true|false)\b/, 'constant'],

    // Keywords
    [/\b(let|as|in|set|show|context)\b/, 'keyword'],
    [/\b(if|else|for|while|break|continue|import|include|export|return)\b/, 'keyword'],

    // Numbers with units
    [/\b(\d*)?\.?\d+([eE][+-]?\d+)?(mm|pt|cm|in|em)\b/, 'number'],
    [/\b(\d*)?\.?\d+([eE][+-]?\d+)?(rad|deg)\b/, 'number'],
    [/\b(\d*)?\.?\d+([eE][+-]?\d+)?%/, 'number'],
    [/\b(\d*)?\.?\d+([eE][+-]?\d+)?fr/, 'number'],
    [/\b(0x[0-9a-fA-F]+|(0b|0o)?\d+)\b/, 'number'],
    [/\b(\d*)?\.?\d+([eE][+-]?\d+)?\b/, 'number'],

    // Nested #expr
    [/#[A-Za-z_][A-Za-z0-9_.-]*/, 'variable'],
    [/#(?=\S)/, 'bracket'],
    // Identifiers (underscores and dashes included)
    [/\b[A-Za-z_][A-Za-z0-9_-]*\b/, 'variable'],
];

// ## Tokenizer #############################################################

const tokenizer = {
    root: MARKUP_RULES,

    // Content block [ ... ]: same markup rules, ] pops back
    content: [
        [/\]/, 'bracket', '@pop'],
        { include: '@root' },
    ],

    // Code after #... (ends at end of line); \n pops back to markup
    codeEOL: [
        [/\n/, '', '@pop'],
        { include: '@code' },
    ],

    // Code inside { ... } (may span lines)
    code: CODE_RULES,

    // "..." strings inside code (may span lines)
    string: [
        [/\\u\{[0-9a-zA-Z]*\}?/, 'escape'],
        [/\\[\\"nrt]/, 'escape'],
        [/"/, 'string', '@pop'],
        [/[^"\n]+/, 'string'],
        [/\n/, 'string'],
    ],
};

// ## Colors: token -> { light, dark } #####################################

const COLORS = {
    heading:      { light: '#0f6ab4', dark: '#56a8f5' },
    strong:       { light: '#a626a4', dark: '#d67cd6' },
    emphasis:     { light: '#a626a4', dark: '#d67cd6' },
    math:         { light: '#986801', dark: '#d19a66' },
    raw:          { light: '#2e7d32', dark: '#6a9955' },
    string:       { light: '#a31515', dark: '#ce9178' },
    escape:       { light: '#c2185b', dark: '#d16969' },
    punctuation:  { light: '#8a8a8a', dark: '#808080' },
    symbol:       { light: '#0184bc', dark: '#61afef' },
    link:         { light: '#0f6ab4', dark: '#4fc1ff' },
    comment:      { light: '#2e7d32', dark: '#6a9955' },
    label:        { light: '#0f6ab4', dark: '#4fc1ff' },
    reference:    { light: '#0f6ab4', dark: '#4fc1ff' },
    keyword:      { light: '#a626a4', dark: '#c586c0' },
    function:     { light: '#0f6ab4', dark: '#56b6c2' },
    variable:     { light: '#0184bc', dark: '#61afef' },
    operator:     { light: '#7a3e9d', dark: '#d4d4d4' },
    constant:     { light: '#986801', dark: '#d19a66' },
    number:       { light: '#986801', dark: '#d19a66' },
};

// ## Registration #########################################################

let registered = false;

export function registerTypstLanguage() {
    if (registered) return;
    registered = true;

    if (!monaco.languages.getLanguages().some((l) => l.id === 'typst')) {
        monaco.languages.register({ id: 'typst' });
    }

    monaco.languages.setLanguageConfiguration('typst', {
        comments: { lineComment: '//' },
        brackets: [['(', ')'], ['[', ']'], ['{', '}']],
        autoClosingPairs: [
            { open: '(', close: ')' },
            { open: '[', close: ']' },
            { open: '{', close: '}' },
            { open: '"', close: '"', notIn: ['string'] },
            { open: '$', close: '$', notIn: ['string'] },
        ],
    });

    // includeLF: without it, `\n` rules (codeEOL pop) never match because
    // Monarch appends no newline to the line text (monarchCompile defaults
    // includeLF to false)
    monaco.languages.setMonarchTokensProvider('typst', { tokenizer, includeLF: true });

    defineTheme('typst-light', 'vs');
    defineTheme('typst-dark', 'vs-dark');
}

function defineTheme(themeName, base) {
    const rules = Object.entries(COLORS)
        .filter(([, c]) => c && c[baseDarkName(base)] !== undefined)
        .map(([token, c]) => ({ token, foreground: c[baseDarkName(base)] }));

    monaco.editor.defineTheme(themeName, {
        base,
        inherit: true,
        colors: {},
        rules,
    });
}

function baseDarkName(base) {
    return base === 'vs-dark' ? 'dark' : 'light';
}

export function getThemeName(theme) {
    return theme === 'dark' ? 'typst-dark' : 'typst-light';
}