/**
 * Typst syntax highlighting for Monaco.
 *
 * Regexes follow the official Typst TextMate grammar
 * (typst/typst -> tools/support/typst.tmLanguage.json), whose rules were
 * converted to Monarch states, with mode transitions taken from the official
 * parser (crates/typst-syntax/src/parser.rs). A condensé of sources and rules
 * lives in docs/typst-highlight-veille.md.
 *
 * Typst has three modes, each a tokenizer state (plus helpers):
 * - root     : markup, the document body
 * - content  : markup inside a content block [...] (nestable)
 * - codeEOL  : code after a `#expr/#stmt`, ends at newline, `;`, `]` or a bare `)`
 * - code     : code inside `{ ... }` (nestable), newlines are transparent
 * - group    : code inside `(...)` (nestable), newlines are transparent
 * - strong   : content of *bold*; emph _italic_ mirrors it for `_`
 * - math     : content of $...$, uniform, may span lines
 * - rawBlock : raw text fenced with 3+ backticks (may span lines)
 * - rawInline: raw text after a single ` until the next `
 * - string   : "..." strings inside code (may span lines)
 * - blockComment : content of \/* ... *\/ (may span lines)
 *
 * Order matters: the first rule that matches wins, like in the
 * TextMate grammar. Content blocks [...] exist only in code: `[` in markup
 * is a plain character. Global flag `unicode: true` adds `u` so \p{L}/\p{N}
 * classes match the full-range identifiers (first_line_indent, π, CJK).
 *
 * Assumed (documented) simplifications:
 * - `#let x = [a] + [b]` on ONE line: code highlighting stops after the
 *   first `]` (content pops straight to markup). Multi-line content blocks
 *   and `#(...)`/`{...}` scalene are handled exactly.
 * - A raw-fence opener of any length >= 3 backticks closes on the first
 *   3+-backtick run (TextMate requires the same count).
 * - `#` inside math keeps math color; embedded code in math is not styled
 *   beyond the uniform math token (as in the official grammar).
 *
 * Two tables to edit:
 * 1. RULES  : "when the text contains X, token is Y" — [regex, token] or
 *    [regex, token, state-name]: the action `next` pushes the state.
 * 2. COLORS : "token Y has this color in light/dark theme"; a token without
 *    an entry keeps Monaco's default theme color.
 */

import * as monaco from 'monaco-editor';

// ## Markup rules (document body and content blocks) #######################

const MARKUP_RULES = [
    // Comments (before links so https://... stays out; the lookbehind makes
    // the line-comment rule unable to match at the // of a URL)
    [/\/\*/, 'comment', 'blockComment'],
    [/(?<!:)\/\/[^\n]*/, 'comment'],

    // Escape sequences: any of \/[]{}#*_=~`$-. or \u{hex}
    [/\\(?:[\\\/\[\]\{\}#*_=~`$.\-]|u\{[0-9a-zA-Z]*\}?)/, 'escape'],
    [/\\/, 'escape'], // plain \ linebreak

    // Punctuation shorthands, official order
    [/~/, 'punctuation'],
    [/-\?/, 'punctuation'],
    [/---/, 'punctuation'],
    [/--/, 'punctuation'],
    [/\.\.\./, 'punctuation'],

    // Symbol shorthands :alpha:
    [/:(?:[a-zA-Z0-9]+:)+/, 'symbol'],

    // Strong *...* and emphasis _..._ open on word boundaries only: at the
    // line start or after a non-word character, so first_line_indent or
    // a*b*c in plain text stay plain. The delimiters keep highlighting in
    // their own states (see `strong`/`emphasis` below), which allows spans
    // over several lines like the official grammar.
    [/^\*/, 'strong', 'strong'],
    [/(?<=\W|_)\*/, 'strong', 'strong'],
    [/^_/, 'emphasis', 'emphasis'],
    [/(?<=\W|_)_/, 'emphasis', 'emphasis'],

    // Links (before comments in the original order... kept here for parity)
    [/https?:\/\/[0-9a-zA-Z~\/%#&=',;.+\?]*/, 'link'],

    // Raw text: first the fenced block (3+ backticks), then inline
    [/`{3,}/, 'raw', 'rawBlock'],
    [/`/, 'raw', 'rawInline'],

    // Math $...$, uniform color, may span lines
    [/\$/, 'math', 'math'],

    // Heading marker: the mark only, line-anchored
    [/^\s*=+\s+/, 'heading'],

    // Lists: -, 1. / +, term:
    [/^\s*-\s+/, 'punctuation'],
    [/^\s*(?:[0-9]*\.|\+)\s+/, 'punctuation'],
    [/^\s*\/\s+[^:\n]*:/, 'punctuation'],

    // Labels <name> and references @name (markup only, Unicode identifiers)
    [/<[\p{L}_][\p{L}\p{N}_-]*>/, 'label'],
    [/@[\p{L}_][\p{L}\p{N}_-]*/, 'reference'],

    // "else" replayed without # right after a }/]-block
    [/(?<=(?:\}|\])\s*)else\b/, 'keyword'],

    // Statements in code mode after # (ended by ; or newline)
    [/#(?:let|set|show|context|as|in|if|for|while|break|continue|import|include|export|return)\b/, 'keyword', 'codeEOL'],

    // Function call #name( or #name[ , then variable #expr (fields/-)
    [/#(?:[\p{L}_][\p{L}\p{N}_-]*)!?(?=\[|\()/, 'function', 'codeEOL'],
    [/#(?:[\p{L}_][\p{L}\p{N}_-]*)?[.\p{L}\p{N}_-]*/, 'variable', 'codeEOL'],
    [/#(?=\S)/, 'bracket', 'codeEOL'],
];

// ## Code rules (shared by codeEOL, code, group) ######################
// Newline semantics live in the surrounding states: codeEOL pops on
// newline/;/], code and group ignore newlines (parentheses and braces make
// them legal there, per the official parser).

const CODE_RULES = [
    // Comments
    [/\/\*/, 'comment', 'blockComment'],
    [/\/\/[^\n]*/, 'comment'],

    // Strings "..." (may span lines), math $...$
    [/"/, 'string', 'string'],
    [/\$/, 'math', 'math'],

    // Brackets: { } nestable code blocks, ( ) groups, [ ] content blocks
    [/\{/, 'bracket', 'code'],
    [/\(/, 'bracket', 'group'],
    [/\[/, 'bracket', 'content'],

    // Labels <name> survive in embedded code, like the official grammar
    [/<[\p{L}_][\p{L}\p{N}_-]*>/, 'label'],

    // Operators, official order (longest first); a bare - keeps identifiers
    // with dashes intact: x-1 is one identifier, 2-3 is subtraction
    [/=>|\.\./, 'operator'],
    [/==|!=|<=|<|>=|>/, 'operator'],
    [/\+=|-=|\*=|\/=|=/, 'operator'],
    [/\+|\*|\//, 'operator'],
    [/(?<![\p{L}_][\p{L}\p{N}_-]*)-(?![\p{L}\p{N}_-]*[\p{L}_])/, 'operator'],

    // Word operators and keywords
    [/\b(?:and|or|not)\b/, 'operator'],
    [/\b(?:let|as|in|set|show|context|if|else|for|while|break|continue|import|include|export|return)\b/, 'keyword'],

    // Constants and numbers (units before plain integers)
    [/\b(?:none|auto|true|false)\b/, 'constant'],
    [/\b(?:0x[0-9a-zA-Z]+|0b[01]+|0o[0-7]+)\b/, 'number'],
    [/\d*\.?\d+(?:[eE][+-]?\d+)?(?:mm|pt|cm|in|em|rad|deg|fr)?%?/, 'number'],

    // Function name before a call ([ or ( follows)
    [/\b(?:[\p{L}_][\p{L}\p{N}_-]*)!?(?=\[|\()/, 'function'],
    // rewrite target after `show`: show heading: ...
    [/(?<=\bshow\s*)[\p{L}_][\p{L}\p{N}_-]*(?=\s*[:.])/, 'variable'],
    // named argument / dict key before the colon (`rows`)
    [/\b(?:[\p{L}_][\p{L}\p{N}_-])+\s*(?=:)/, 'variable'],
    // generic identifier
    [/\b[\p{L}_][\p{L}\p{N}_-]*/, 'variable'],

    // Separators
    [/[:,;)]/, 'punctuation'],
];

// ## Tokenizer #############################################################

const tokenizer = {
    root: MARKUP_RULES,

    // Content block [...]: markup rules; ] closes, nested [ opens deeper
    content: [
        [/\]/, 'bracket', '@pop'],
        [/\[/, 'bracket', 'content'],
        { include: '@root' },
    ],

    // Code after #... on a line: ends at newline, `;`, before a `]`, or on a
    // bare `)` (a group closed upstream leaves us here: (#ref(<fig2>)). text
    // must resume markup after the code), so #text(..)[Hello] some texts
    // colors the text after ] as markup
    codeEOL: [
        [/\n/, '', '@pop'],
        [/;/, 'punctuation', '@pop'],
        [/(?=\])/, '', '@pop'],
        [/\)/, 'punctuation', '@pop'],
        [/\[/, { token: 'bracket', switchTo: 'content' }],
        { include: '@code' },
    ],

    // Code inside { ... }: newlines transparent, } pops (nestable)
    code: [
        [/\}/, 'bracket', '@pop'],
        ...CODE_RULES,
    ],

    // Code inside (...): same files; newlines transparent, ) pops
    group: [
        [/\)/, 'bracket', '@pop'],
        ...CODE_RULES,
    ],

    // Strong/Ehm after the opening delimiter; closes on the same word-
    // boundary conditions, at the end of the line or before a `]`
    strong: [
        [/\*(?=\W|_|\n|$)/, 'strong', '@pop'],
        [/(?<=\W|_)\*/, 'strong', '@pop'],
        [/^\*/, 'strong', '@pop'],
        [/(?=\])/, '', '@pop'],
        [/\*/, 'strong'],
        [/[^*\n]+/, 'strong'],
        [/\n/, 'strong', '@pop'],
    ],

    emphasis: [
        [/_(?=\W|_|\n|$)/, 'emphasis', '@pop'],
        [/(?<=\W|_)_/, 'emphasis', '@pop'],
        [/^_/, 'emphasis', '@pop'],
        [/(?=\])/, '', '@pop'],
        [/_/, 'emphasis'],
        [/[^_\n]+/, 'emphasis'],
        [/\n/, 'emphasis', '@pop'],
    ],

    // Math content: monochrome, may span lines; comments visible (official
    // lexer allows them in all modes)
    math: [
        [/\\\$/, 'math'],
        [/\$/, 'math', '@pop'],
        [/\/\*/, 'comment', 'blockComment'],
        [/\/\/[^\n]*/, 'comment'],
        [/[^$\\\n]+/, 'math'],
        [/\\/, 'math'],
        [/\n/, 'math'],
    ],

    // Raw fenced block ```...```; inline raw `...` (may span lines if
    // the closing backtick is on a later line)
    rawInline: [
        [/`/, 'raw', '@pop'],
        [/[^`\n]+/, 'raw'],
        [/\n/, 'raw'],
    ],
    rawBlock: [
        [/`{3,}/, 'raw', '@pop'],
        [/`{1,2}/, 'raw'],
        [/[^`]+/, 'raw'],
    ],

    // "..." strings inside code (may span lines)
    string: [
        [/\\(?:["\\nrt]|u\{[0-9a-zA-Z]*\}?)/, 'escape'],
        [/"/, 'string', '@pop'],
        [/[^"\\\n]+/, 'string'],
        [/\\/, 'string'],
        [/\n/, 'string'],
    ],

    // Block comment /* ... */ : close-first order keeps */ reachable at
    // every position (fixes the old grammar eating the rest of the file)
    blockComment: [
        [/\*\//, 'comment', '@pop'],
        [/\*/, 'comment'],
        [/[^*\n]+/, 'comment'],
        [/\n/, 'comment'],
    ],
};

// ## Language definition what lives on the assembly ##################

export const typstLanguage = {
    unicode: true,   // adds the `u` flag: \p{L} classes, full identifiers
    includeLF: true, // lets the \n rules match (codeEOL pop, etc.)
    tokenizer,
};

// ## Colors: token -> { light, dark } #####################################

const COLORS = {
    heading:      { light: '#0f6ab4', dark: '#9DB2BF' },
    strong:       { light: '#a626a4', dark: '#d67cd6' },
    emphasis:     { light: '#a626a4', dark: '#d67cd6' },
    math:         { light: '#986801', dark: '#d19a66' },
    raw:          { light: '#2e7d32', dark: '#6a9955' },
    string:       { light: '#a31515', dark: '#ce9178' },
    escape:       { light: '#c2185b', dark: '#d16969' },
    punctuation:  { light: '#8a8a8a', dark: '#808080' },
    symbol:       { light: '#0184bc', dark: '#AFC3CF' },
    link:         { light: '#0f6ab4', dark: '#8EB0C6' },
    comment:      { light: '#2e7d32', dark: '#6a9955' },
    label:        { light: '#0f6ab4', dark: '#8EB0C6' },
    reference:    { light: '#0f6ab4', dark: '#8EB0C6' },
    keyword:      { light: '#a626a4', dark: '#c586c0' },
    function:     { light: '#0f6ab4', dark: '#7FB0BD' },
    variable:     { light: '#0184bc', dark: '#AFC3CF' },
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

    monaco.languages.setMonarchTokensProvider('typst', typstLanguage);

    defineTheme('typst-light', 'vs');
    defineTheme('typst-dark', 'vs-dark');
}

function defineTheme(themeName, base) {
    const rules = Object.entries(COLORS)
        .filter(([, c]) => c && c[baseDarkName(base)] !== undefined)
        .map(([token, c]) => ({ token, foreground: c[baseDarkName(base)] }));

    const colors = base === 'vs-dark'
        ? { 'editor.background': '#27374D' }
        : {};

    monaco.editor.defineTheme(themeName, {
        base,
        inherit: true,
        colors,
        rules,
    });
}

function baseDarkName(base) {
    return base === 'vs-dark' ? 'dark' : 'light';
}

export function getThemeName(theme) {
    return theme === 'dark' ? 'typst-dark' : 'typst-light';
}
