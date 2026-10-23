// Golden tests for the Typst Monaco grammar (frontend/src/js/typst-syntax.js).
//
// Runs in node: the grammar module is loaded without its `monaco-editor`
// import line, and the real Monarch tokenizer is built on top of the same
// monaco-editor sources as in the app, with the few services it needs stubbed.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
// Relative node_modules path on purpose: deep imports bypass any exports map
const { MonarchTokenizer } = require('../node_modules/monaco-editor/esm/vs/editor/standalone/common/monarch/monarchLexer.js');
const { compile } = require('../node_modules/monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js');

// Load the grammar with its monaco import stripped (browser-only in node).
async function loadGrammar() {
    const path = new URL('../src/js/typst-syntax.js', import.meta.url);
    const source = readFileSync(path, 'utf8').replace(/^import \* as monaco.*\n/m, '');
    const file = join(mkdtempSync(join(tmpdir(), 'typst-grammar-')), 'typst-syntax.mjs');
    writeFileSync(file, source);
    return import(pathToFileURL(file).href);
}

function toMonarchJson(language) {
    return {
        unicode: language.unicode,
        includeLF: language.includeLF,
        tokenizer: Object.fromEntries(Object.entries(language.tokenizer).map(([state, rules]) => [
            state,
            rules.map((rule) => (Array.isArray(rule) ? [...rule] : { ...rule })),
        ])),
    };
}

// Tokens as [type, text] spans of one line (offsets -> printable spans).
// Monarch appends the language postfix `.typst` to every token type; the
// app's theme rules use the bare names, so the tests normalize it away.
function spansOf(tokens, lineLength) {
    return tokens.map((t, i) => [t.type.replace(/\.typst$/, ''), t.offset, (tokens[i + 1] ? tokens[i + 1].offset : lineLength)]);
}

// Tokenize a whole document with the real Monarch tokenizer.
async function tokenize(text) {
    const { typstLanguage } = await loadGrammar();
    const lexer = compile('typst', toMonarchJson(typstLanguage));
    const configurationService = {
        getValue: () => 1000000, // big maxTokenizationLineLength: `>= null` coerces null to 0 and would disable tokenization entirely
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
    };
    const languageService = {
        languageIdCodec: { encodeLanguageId: () => 1, decodeLanguageId: () => 'typst' },
        getLanguageIdByLanguageName: () => null,
        getLanguageIdByMimeType: () => null,
    };
    const tokenizer = new MonarchTokenizer(languageService, {}, 'typst', lexer, configurationService);

    const lines = text.split('\n');
    let state = tokenizer.getInitialState();
    let all = [];
    for (let i = 0; i < lines.length; i++) {
        const hasEOL = i < lines.length - 1;
        const res = tokenizer.tokenize(lines[i], hasEOL, state);
        all = all.concat(spansOf(res.tokens, lines[i].length).map(([type, start, end]) => [type, lines[i].slice(start, end)]));
        state = res.endState;
    }
    return all;
}

describe('typst syntax grammar', () => {
    // Regression: Monaco adds the `u` flag to every rule regex when
    // unicode: true. A char class that parses without u (e.g. /:,;]/ where
    // a bare ]) crashed the editor at startup with the u flag.
    it('compiles every rule regex with the `u` flag, as Monaco does with unicode: true', async () => {
        const { typstLanguage } = await loadGrammar();
        for (const [state, rules] of Object.entries(typstLanguage.tokenizer)) {
            for (let i = 0; i < rules.length; i++) {
                const rule = rules[i];
                const regex = Array.isArray(rule) && rule[0] instanceof RegExp ? rule[0] : (rule instanceof RegExp ? rule : null);
                if (!regex) continue;
                const source = regex.source.replace(/^\^/, '');
                expect(() => new RegExp(`^(?:${source})`, 'u'), `${state}[${i}] /${source}/ should compile with the u flag`).not.toThrow();
            }
        }
    });

    it('compiles through Monaco and exposes every state', async () => {
        const { typstLanguage } = await loadGrammar();
        const lexer = compile('typst', toMonarchJson(typstLanguage));
        expect(Object.keys(lexer.tokenizer).sort()).toEqual([
            'root', 'content', 'codeEOL', 'code', 'group',
            'math', 'rawInline', 'rawBlock', 'string', 'blockComment',
        ].sort());
    });

    it('marks markup, headings, comments and escapes', async () => {
        expect(await tokenize('= Today\nbold here\n// note\n\\#x\n')).toEqual([
            ['heading', '= '],
            ['source', 'Today'],
            ['source', 'bold here'],
            ['comment', '// note'],
            ['escape', '\\#'],
            ['source', 'x'],
        ]);
    });

    it('closes a /* */ block comment with an internal * (bug: */ eaten)', async () => {
        const tokens = await tokenize('/* a\nb * c\n*/\n#example()\n');
        expect(tokens).toEqual([
            ['comment', '/* a'],
            ['comment', 'b * c'],
            ['comment', '*/'],
            ['function', '#example'],
            ['bracket', '()'],
        ]);
    });

    it('makes https:// links stay links, not line comments', async () => {
        const tokens = await tokenize('see https://typst.app/doc now\n');
        expect(tokens).toEqual([
            ['source', 'see '],
            ['link', 'https://typst.app/doc'],
            ['source', ' now'],
        ]);
    });

    // The flag bug: after a content block ] inside #expr, code coloring
    // leaked to the rest of the line. Content [Hello] keeps markup rules and
    // the text after ] falls back to plain markup.
    it('ends #expr code at ] and resumes markup (the #text(..)[Hello] case)', async () => {
        const tokens = await tokenize('#text(..)[Hello] some texts\n');
        expect(tokens).toEqual([
            ['function', '#text'],
            ['bracket', '('],
            ['operator', '..'],
            ['bracket', ')['],
            ['source', 'Hello'],
            ['bracket', ']'],
            ['source', ' some texts'],
        ]);
    });

    it('keeps code across newlines inside a (...) group', async () => {
        const tokens = await tokenize('#let xs = (\n  1,\n  2,\n)\n');
        expect(tokens).toEqual([
            ['keyword', '#let'],
            ['source', ' '],
            ['variable', 'xs'],
            ['source', ' '],
            ['operator', '='],
            ['source', ' '],
            ['bracket', '('],
            ['source', '  '],
            ['number', '1'],
            ['punctuation', ','],
            ['source', '  '],
            ['number', '2'],
            ['punctuation', ','],
            ['bracket', ')'],
        ]);
    });

    it('forces code end with ; and resumes markup on the same line', async () => {
        const tokens = await tokenize('#set page(margin: 5pt); plain text\n');
        expect(tokens).toEqual([
            ['keyword', '#set'],
            ['source', ' '],
            ['function', 'page'],
            ['bracket', '('],
            ['variable', 'margin'],
            ['punctuation', ':'],
            ['source', ' '],
            ['number', '5pt'],
            ['bracket', ')'],
            ['punctuation', ';'],
            ['source', ' plain text'],
        ]);
    });

    it('colors functions, named arguments, operators and units in code', async () => {
        const tokens = await tokenize('#show heading: it => [#emph[Br]]\n');
        expect(tokens).toEqual([
            ['keyword', '#show'],
            ['source', ' '],
            ['variable', 'heading'],
            ['punctuation', ':'],
            ['source', ' '],
            ['variable', 'it'],
            ['source', ' '],
            ['operator', '=>'],
            ['source', ' '],
            ['bracket', '['],
            ['function', '#emph'],
            ['bracket', '['],
            ['source', 'Br'],
            ['bracket', ']]'],
        ]);
    });

    it('spans $ math over newlines and escapes \\$', async () => {
        const tokens = await tokenize('a $x\n\\$ y$\n');
        expect(tokens).toEqual([
            ['source', 'a '],
            ['math', '$x'],
            ['math', '\\$ y$'],
        ]);
    });

    it('spans ``` raw blocks over newlines', async () => {
        const tokens = await tokenize('before ```py\n# not a comment\n```\nafter\n');
        expect(tokens).toEqual([
            ['source', 'before '],
            ['raw', '```py'],
            ['raw', '# not a comment'],
            ['raw', '```'],
            ['source', 'after'],
        ]);
    });

    it('colors strings and string escapes only in code', async () => {
        const tokens = await tokenize('#let v = "a\\"b"\nplain "demo"\n');
        expect(tokens).toEqual([
            ['keyword', '#let'],
            ['source', ' '],
            ['variable', 'v'],
            ['source', ' '],
            ['operator', '='],
            ['source', ' '],
            ['string', '"a'],
            ['escape', '\\"'],
            ['string', 'b"'],
            ['source', 'plain "demo"'],
        ]);
    });

    it('keeps *strong* and _emphasis_ to word boundaries', async () => {
        const tokens = await tokenize('wordmark x*y a*b\n_first_ and pi_x\n');
        expect(tokens).toEqual([
            ['source', 'wordmark x*y a*b'],
            ['emphasis', '_first_'],
            ['source', ' and pi_x'],
        ]);
    });

    // Regression: after the group close of #ref(<fig2>) we land back in
    // codeEOL on a bare `)`, which must end the #expr and resume markup -
    // previously the rest of the line stayed code-colored.
    it('resumes markup after a bare ) and colors <fig2> as a label', async () => {
        const tokens = await tokenize("(#ref(<fig2>)). Il y en a six parce que l'ADN est double brin.\n");
        expect(tokens).toEqual([
            ['source', '('],
            ['function', '#ref'],
            ['bracket', '('],
            ['label', '<fig2>'],
            ['bracket', ')'],
            ['punctuation', ')'],
            ['source', ". Il y en a six parce que l'ADN est double brin."],
        ]);
    });

    it('keeps code alive through nested groups and following operators', async () => {
        const tokens = await tokenize('#f(a(g)) + y\n');
        expect(tokens).toEqual([
            ['function', '#f'],
            ['bracket', '('],
            ['function', 'a'],
            ['bracket', '('],
            ['variable', 'g'],
            ['bracket', '))'],
            ['source', ' '],
            ['operator', '+'],
            ['source', ' '],
            ['variable', 'y'],
        ]);
    });

    it('keeps <= comparisons as operators, not labels', async () => {
        const tokens = await tokenize('#a <= b\n');
        expect(tokens).toEqual([
            ['variable', '#a'],
            ['source', ' '],
            ['operator', '<='],
            ['source', ' '],
            ['variable', 'b'],
        ]);
    });

    it('keeps the (x) => x closure in code after the group closes', async () => {
        const tokens = await tokenize('#let f = (x) => x\n');
        expect(tokens).toEqual([
            ['keyword', '#let'],
            ['source', ' '],
            ['variable', 'f'],
            ['source', ' '],
            ['operator', '='],
            ['source', ' '],
            ['bracket', '('],
            ['variable', 'x'],
            ['bracket', ')'],
            ['source', ' '],
            ['operator', '=>'],
            ['source', ' '],
            ['variable', 'x'],
        ]);
    });

    it('colors same-line else as markup and line-start else as keyword', async () => {
        const tokens = await tokenize('#if x [y] else [z]\nelse [w]\n');
        expect(tokens).toEqual([
            ['keyword', '#if'],
            ['source', ' '],
            ['variable', 'x'],
            ['source', ' '],
            ['bracket', '['],
            ['source', 'y'],
            ['bracket', ']'],
            ['source', ' else [z]'],
            ['keyword', 'else'],
            ['source', ' [w]'],
        ]);
    });

    it('colors mid-line *strong* (boundary char eaten into the token)', async () => {
        const tokens = await tokenize('something *bold* here_and_there\n');
        expect(tokens).toEqual([
            ['source', 'something'],
            ['strong', ' *bold*'],
            ['source', ' here_and_there'],
        ]);
    });

    it('colors inline raw and keeps it open across lines', async () => {
        const tokens = await tokenize('one `x` two\nunclosed `still\nraw`\nplain\n');
        expect(tokens).toEqual([
            ['source', 'one '],
            ['raw', '`x`'],
            ['source', ' two'],
            ['source', 'unclosed '],
            ['raw', '`still'],
            ['raw', 'raw`'],
            ['source', 'plain'],
        ]);
    });

    it('colors labels with dots and colons, inline and in code', async () => {
        const tokens = await tokenize('see <Fig.1:a-b_2>\nand #ref(<fig:base>)\n');
        expect(tokens).toEqual([
            ['source', 'see '],
            ['label', '<Fig.1:a-b_2>'],
            ['source', 'and '],
            ['function', '#ref'],
            ['bracket', '('],
            ['label', '<fig:base>'],
            ['bracket', ')'],
        ]);
    });
});
