/**
 * tests/comments.test.js
 *  Unit tests for the keytag comment feature.
 *
 *  tokens.js   : span extraction (Monaco tokens + regex fallback).
 *  scan.js     : keytag matching against spans (UTF-16 Monaco columns).
 *  keytags.js  : registry, localStorage persistence, default merging.
 *
 *  A minimal localStorage stub is installed because vitest 4 runs in the
 *  node environment by default.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { findKeytagComments } from '../src/js/comments/scan.js';
import {
  commentSpansFromText,
  commentSpansFromTokens,
  isCommentToken,
} from '../src/js/comments/tokens.js';
import {
  getKeytags,
  saveKeytags,
  resetKeytags,
  getKeytagByKeyword,
  isValidKeyword,
  onChange,
} from '../src/js/comments/keytags.js';

const DEFAULTS = [
  { id: 'todo',    keyword: 'TODO:',    label: 'TODO',    color: '#eab308' },
  { id: 'note',    keyword: 'NOTE:',    label: 'NOTE',    color: '#3b82f6' },
  { id: 'comment', keyword: 'COMMENT:', label: 'COMMENT', color: '#22c55e' },
  { id: 'fixme',   keyword: 'FIXME:',   label: 'FIXME',   color: '#ef4444' },
  { id: 'warning', keyword: 'WARNING:', label: 'WARNING', color: '#f97316' },
];

beforeEach(() => {
  // Minimal in-memory localStorage (module reads the global at call time).
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
});

// ## Helper: scan text with the regex-span fallback ########################

const scanText = (text, keytags = getKeytags()) =>
  findKeytagComments(commentSpansFromText(text), keytags);

// ## commentSpansFromText ###################################################

describe('commentSpansFromText (regex fallback)', () => {
  it('splits line comments into one span per line', () => {
    const spans = commentSpansFromText('// a\n// b');
    expect(spans.map((s) => s.text)).toEqual(['// a', '// b']);
    expect(spans[0]).toMatchObject({ line: 1, col: 1 });
    expect(spans[1]).toMatchObject({ line: 2, col: 1 });
  });

  it('keeps positions in UTF-16 units', () => {
    const spans = commentSpansFromText('é😀 x // c');
    expect(spans).toHaveLength(1);
    expect(spans[0].col).toBe(7); // 6 UTF-16 units before the marker
  });

  it('extracts single- and multi-line block comments', () => {
    const spans = commentSpansFromText('a /* b */ c\n/* d\ne */');
    expect(spans.map((s) => s.text)).toEqual(['/* b */', '/* d\ne */']);
  });

  it('splits two closed blocks on one line', () => {
    const spans = commentSpansFromText('/* a */ /* b */');
    expect(spans.map((s) => s.text)).toEqual(['/* a */', '/* b */']);
  });
});

// ## commentSpansFromTokens #################################################

describe('commentSpansFromTokens (Monaco tokens)', () => {
  // Synthetic token line helper: `span(texts, types)` builds Token[][] where
  // each entry covers the whole line (offset 0) or empty line.
  const line = (text, types) => {
    const toks = [];
    let offset = 0;
    for (let i = 0; i < types.length; i++) {
      // Each simulated token covers one "word"; keep offsets consistent with
      // the real text only when the test cares about columns.
      toks.push({ offset, type: types[i] });
      offset += 3;
    }
    return toks;
  };

  it('merges a multi-line block comment into one span', () => {
    const text = '/* a\nb */';
    const tokens = [
      [{ offset: 0, type: 'comment.typst' }],
      [{ offset: 0, type: 'comment.typst' }, { offset: 3, type: 'comment.typst' }],
    ];
    const spans = commentSpansFromTokens(tokens, text);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ line: 1, col: 1 });
    expect(spans[0].text).toBe('/* a\nb */');
  });

  it('keeps adjacent line comments as separate spans', () => {
    const text = '// a\n// b';
    const tokens = [
      [{ offset: 0, type: 'comment.typst' }],
      [{ offset: 0, type: 'comment.typst' }],
    ];
    const spans = commentSpansFromTokens(tokens, text);
    expect(spans.map((s) => s.text)).toEqual(['// a', '// b']);
  });

  it('does not span line comments across lines', () => {
    const text = '// a\nx';
    const tokens = [
      [{ offset: 0, type: 'comment.typst' }],
      [{ offset: 0, type: 'text.typst' }],
    ];
    const spans = commentSpansFromTokens(tokens, text);
    expect(spans.map((s) => s.text)).toEqual(['// a']);
  });

  it('ignores non-comment tokens (no false positive on strings)', () => {
    const text = '#let x = "// TODO: fake"';
    const tokens = [
      [
        { offset: 0, type: 'keyword.typst' },
        { offset: 4, type: 'variable.typst' },
        { offset: 6, type: 'operator.typst' },
        { offset: 9, type: 'string.typst' },
      ],
    ];
    expect(commentSpansFromTokens(tokens, text)).toEqual([]);
  });

  it('splits closed block and line comment on the same line', () => {
    const text = '/* c */ // d';
    const tokens = [
      [
        { offset: 0, type: 'comment.typst' },  // "/* c */"
        { offset: 7, type: 'default.typst' },  // " "
        { offset: 8, type: 'comment.typst' },  // "// d"
      ],
    ];
    const spans = commentSpansFromTokens(tokens, text);
    expect(spans.map((s) => s.text)).toEqual(['/* c */', '// d']);
  });

  it('flushes an unclosed block when the tokenizer leaves the state', () => {
    const text = '/* a\nx';
    const tokens = [
      [{ offset: 0, type: 'comment.typst' }],
      [{ offset: 0, type: 'text.typst' }],
    ];
    const spans = commentSpansFromTokens(tokens, text);
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe('/* a');
  });

  it('handles an unclosed block at end of file', () => {
    const text = '/* TODO: x';
    const tokens = [[{ offset: 0, type: 'comment.typst' }]];
    const spans = commentSpansFromTokens(tokens, text);
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe('/* TODO: x');
  });

  it('isCommentToken accepts comment and comment.<lang>', () => {
    expect(isCommentToken('comment')).toBe(true);
    expect(isCommentToken('comment.typst')).toBe(true);
    expect(isCommentToken('string.typst')).toBe(false);
    expect(isCommentToken('commentary')).toBe(false);
  });
});

// ## scan.js ################################################################

describe('findKeytagComments', () => {
  const keytags = getKeytags();

  it('finds a line comment with TODO:', () => {
    const entries = scanText('= Chapter\n// TODO: fix the title\nHello', keytags);
    expect(entries).toHaveLength(1);
    expect(entries[0].keytag.id).toBe('todo');
    expect(entries[0].message).toBe('fix the title');
    expect(entries[0].line).toBe(2);
    expect(entries[0].startColumn).toBe(1);
    expect(entries[0].messageColumn).toBe(9); // "// TODO: " = 8 units → next col
  });

  it('matches case-insensitively', () => {
    const entries = scanText('// todo: check this\n// NOTE: and this', keytags);
    expect(entries.map((e) => e.keytag.id)).toEqual(['todo', 'note']);
  });

  it('ignores comments without a known keytag', () => {
    const entries = scanText('// plain comment\n// FIXME', keytags);
    expect(entries).toHaveLength(0);
  });

  it('requires the colon (no false positive on //TODO, plain)', () => {
    expect(scanText('// TODO without colon', keytags)).toHaveLength(0);
    expect(scanText('//NOTE: nospace', keytags)).toHaveLength(1);
  });

  it('matches with leading whitespace inside the comment', () => {
    const entries = scanText('//   TODO: aligned', keytags);
    const cols = [entries[0].startColumn, entries[0].messageColumn];
    expect(cols).toEqual([1, 11]); // "//   TODO: " → first message char at col 11
  });

  it('lists an empty message as empty string', () => {
    const entries = scanText('// NOTE:', keytags);
    expect(entries[0].message).toBe('');
  });

  it('handles single-line block comments', () => {
    const entries = scanText('Some text /* FIXME: crash here */ more', keytags);
    expect(entries).toHaveLength(1);
    expect(entries[0].keytag.id).toBe('fixme');
    expect(entries[0].message).toBe('crash here');
    expect(entries[0].startColumn).toBe(11);
  });

  it('handles multi-line block comments', () => {
    const entries = scanText('/* TODO: first line\nsecond line */', keytags);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('first line\nsecond line');
    expect(entries[0].line).toBe(1);
    expect(entries[0].startColumn).toBe(1);
  });

  it('reports columns in UTF-16 code units (Monaco contract)', () => {
    const entries = scanText('é😀 x // TODO: unicode', keytags);
    expect(entries[0].startColumn).toBe(7); // 6 UTF-16 units before the marker
    expect(entries[0].message).toBe('unicode');
  });

  it('takes only the earliest keytag on a line', () => {
    expect(scanText('// TODO: keep, and FIXME: not this', keytags)).toHaveLength(1);
  });

  it('skips disabled keytags', () => {
    const disabled = keytags.map((k) => ({ ...k, enabled: k.id !== 'comment' }));
    const entries = scanText('// COMMENT: off\n// WARNING: on', disabled);
    expect(entries).toHaveLength(1);
    expect(entries[0].keytag.id).toBe('warning');
  });

  it('counts one entry per matching comment', () => {
    const text = ['// TODO: a', '// TODO: b', '/* NOTE: c */'].join('\n');
    expect(scanText(text, keytags)).toHaveLength(3);
  });
});

// ## keytags.js ############################################################

describe('keytags registry', () => {
  it('returns the built-in defaults when nothing is stored', () => {
    const list = getKeytags();
    expect(list.map((k) => [k.id, k.keyword])).toEqual(
      DEFAULTS.map((k) => [k.id, k.keyword]),
    );
    expect(list.every((k) => k.enabled === true)).toBe(true);
  });

  it('persists edits and reloads them (round-trip)', () => {
    saveKeytags([{ id: 'customA', keyword: 'URGENT:', label: 'Urgent', color: '#ff0000', enabled: false }]);
    const list = getKeytags();
    const custom = list.find((k) => k.id === 'customA');
    expect(custom).toMatchObject({ keyword: 'URGENT:', label: 'Urgent', color: '#ff0000', enabled: false });
    // Built-ins are still present next to the custom one.
    expect(list.filter((k) => k.id !== 'customA')).toHaveLength(DEFAULTS.length);
  });

  it('merges stored overrides with new defaults', () => {
    // Simulate an older stored list that misses a later default.
    localStorage.setItem(
      'comments.keytags.v1',
      JSON.stringify([{ id: 'todo', keyword: 'TODO:', label: 'À faire', color: '#111111', enabled: true }]),
    );
    const list = getKeytags();
    expect(list.find((k) => k.id === 'todo').label).toBe('À faire');
    expect(list.some((k) => k.id === 'note')).toBe(true); // default re-added
  });

  it('drops corrupted stored entries', () => {
    localStorage.setItem('comments.keytags.v1', JSON.stringify([null, { keyword: '  ' }, { keyword: 'OK:', label: 'Ok', color: '#123456', enabled: true }]));
    const list = getKeytags();
    expect(list.some((k) => k.keyword === 'OK:')).toBe(true);
    expect(list.some((k) => (k.keyword ?? '').trim() === '')).toBe(false);
  });

  it('drops duplicate keywords on save (case-insensitive)', () => {
    saveKeytags([
      { id: 'a', keyword: 'TODO:', label: 'A', color: '#111111', enabled: true },
      { id: 'b', keyword: 'todo:', label: 'B', color: '#222222', enabled: true },
    ]);
    const list = getKeytags();
    const todoCount = list.filter((k) => k.keyword.toLowerCase() === 'todo:').length;
    expect(todoCount).toBe(2); // one stored override + one built-in default id
    expect(list.filter((k) => k.id === 'b')).toHaveLength(0); // duplicate dropped
  });

  it('reset restores the defaults and clears storage', () => {
    saveKeytags([{ id: 'customB', keyword: 'XXX:', label: 'Custom', color: '#333333', enabled: true }]);
    expect(getKeytags().some((k) => k.id === 'customB')).toBe(true);

    const list = resetKeytags();
    expect(list.map((k) => k.id)).toEqual(DEFAULTS.map((k) => k.id));
    expect(localStorage.getItem('comments.keytags.v1')).toBeNull();
  });

  it('getKeytagByKeyword finds only enabled tags', () => {
    expect(getKeytagByKeyword('todo:')?.id).toBe('todo');
    expect(getKeytagByKeyword('TODO')).toBeNull(); // colon required
    expect(getKeytagByKeyword('unknown:')).toBeNull();

    saveKeytags([{ id: 'todo', keyword: 'TODO:', label: 'TODO', color: '#eab308', enabled: false }]);
    expect(getKeytagByKeyword('todo:')).toBeNull();
  });

  it('isValidKeyword rejects whitespace and comment markers', () => {
    expect(isValidKeyword('TODO:')).toBe(true);
    expect(isValidKeyword('TODO')).toBe(true);
    expect(isValidKeyword(' multi')).toBe(false);
    expect(isValidKeyword('TODO: ')).toBe(false);
    expect(isValidKeyword('a//b')).toBe(false);
    expect(isValidKeyword('a/*b')).toBe(false);
    expect(isValidKeyword('')).toBe(false);
  });

  it('onChange fires on save and reset, with unsubscribe', () => {
    let fired = 0;
    const off = onChange(() => fired++);
    saveKeytags([]);
    expect(fired).toBe(1);
    off();
    saveKeytags([]);
    expect(fired).toBe(1);
    resetKeytags();
    expect(fired).toBe(1);
  });
});