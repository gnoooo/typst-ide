/**
 * tests/comments-ui.test.js
 *  DOM and pure-style tests for the marker UI:
 *    - styles.js   : CSS generation + hover markdown escaping (no Monaco).
 *    - entry.js    : marker-book row builder (jsdom, XSS-safe).
 *    - keytags.js  : manager form validation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

import { buildKeytagCss, buildHoverMessage, hexToRgba, ALPHA } from '../src/js/comments/styles.js';
import { buildEntryRow } from '../src/js/comments/entry.js';
import { findKeytagListError, isValidKeyword } from '../src/js/comments/keytags.js';

// ## DOM setup (mirrors xss-sinks.test.js) ###################################

let dom;
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);

  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
});

// ## styles.js ###############################################################

describe('buildKeytagCss', () => {
  const keytags = [
    { id: 'todo', color: '#eab308' },
    { id: 'fixme', color: '#ef4444' },
  ];

  it('emits the line band, the gutter dot and the bold tag per keytag', () => {
    const css = buildKeytagCss(keytags);
    expect(css).toContain('.comments-kg-todo { background-color: rgba(234, 179, 8, 0.22); }');
    expect(css).toContain('.comments-kg-fixme { background-color: rgba(239, 68, 68, 0.22); }');
    expect(css).toContain('.monaco-editor .lines-content .cdr.comments-kg-todo { height: 1.1em; top: 0; border-radius: 2px; }');
    expect(css).toContain('.comments-gm-todo::before { content: ""; width: 0.8em; height: 0.8em; border-radius: 50%; background: #eab308; }');
    expect(css).toContain('.comments-kw-fixme { font-weight: bold; }');
  });

  it('hexToRgba converts colors with the exported alpha', () => {
    expect(hexToRgba('#eab308', ALPHA)).toBe('rgba(234, 179, 8, 0.22)');
    expect(hexToRgba('#abcdef', 0.5)).toBe('rgba(171, 205, 239, 0.5)');
  });
});

describe('buildHoverMessage', () => {
  it('returns bold keyword + escaped message', () => {
    const msg = buildHoverMessage({ keytag: { keyword: 'TODO:' }, message: 'a *b* [c]' });
    expect(msg.value).toBe('**TODO:**\n\na \\*b\\* \\[c\\]');
  });

  it('omits the message part when empty', () => {
    expect(buildHoverMessage({ keytag: { keyword: 'NOTE:' }, message: '' }).value).toBe('**NOTE:**');
  });
});

// ## entry.js ################################################################

describe('buildEntryRow', () => {
  const l10n = {
    emptyMessage: '(vide)',
    lineLabel: (n) => `ligne ${n}`,
  };

  it('renders chip, message and line number', () => {
    const row = buildEntryRow(
      { keytag: { label: 'TODO', color: '#3b82f6' }, message: 'fix me', line: 7 },
      l10n,
    );
    dom.window.document.body.appendChild(row);

    const [chip, msg, line] = row.children;
    expect(chip.textContent).toBe('TODO');
    expect(chip.style.background).toBe('rgb(59, 130, 246)');
    expect(msg.textContent).toBe('fix me');
    expect(line.textContent).toBe('ligne 7');
  });

  it('falls back to the empty-message label', () => {
    const row = buildEntryRow(
      { keytag: { label: 'NOTE', color: '#22c55e' }, message: '', line: 3 },
      l10n,
    );
    expect(row.children[1].textContent).toBe('(vide)');
  });

  it('picks a contrast-aware chip text color', () => {
    const dark = buildEntryRow(
      { keytag: { label: 'FIXME', color: '#ef4444' }, message: '', line: 1 },
      l10n,
    );
    expect(dark.children[0].style.color).toBe('rgb(17, 17, 17)');

    const light = buildEntryRow(
      { keytag: { label: 'X', color: '#ffffff' }, message: '', line: 1 },
      l10n,
    );
    expect(light.children[0].style.color).toBe('rgb(17, 17, 17)');

    const veryDark = buildEntryRow(
      { keytag: { label: 'X', color: '#000000' }, message: '', line: 1 },
      l10n,
    );
    expect(veryDark.children[0].style.color).toBe('rgb(255, 255, 255)');
  });

  it('keeps malicious messages inert (XSS-safe)', () => {
    const row = buildEntryRow(
      { keytag: { label: 'TODO', color: '#eab308' }, message: '<script>alert(1)</script>', line: 1 },
      l10n,
    );
    dom.window.document.body.appendChild(row);
    expect(dom.window.document.body.querySelector('script')).toBeNull();
    expect(row.children[1].textContent).toBe('<script>alert(1)</script>');
  });

  it('calls onJump on click with the entry', () => {
    const entry = { keytag: { label: 'TODO', color: '#eab308' }, message: 'm', line: 4, messageColumn: 9 };
    let jumped = null;
    const row = buildEntryRow(entry, l10n, (e) => (jumped = e));
    row.click();
    expect(jumped).toBe(entry);

    const noop = buildEntryRow(entry, l10n);
    expect(() => noop.click()).not.toThrow();
  });
});

// ## keytags.js validation ###################################################

describe('findKeytagListError', () => {
  it('accepts a valid list', () => {
    const rows = [
      { keyword: 'TODO:' },
      { keyword: 'FIXME:' },
      { keyword: 'CUSTOM:' },
    ];
    expect(findKeytagListError(rows)).toBeNull();
  });

  it('detects invalid keywords', () => {
    expect(findKeytagListError([{ keyword: '' }])).toBe('comment.invalid_keyword');
    expect(findKeytagListError([{ keyword: 'with space' }])).toBe('comment.invalid_keyword');
    expect(findKeytagListError([{ keyword: 'a//b' }])).toBe('comment.invalid_keyword');
  });

  it('detects duplicate keywords case-insensitively', () => {
    expect(findKeytagListError([
      { keyword: 'TODO:' },
      { keyword: 'todo:' },
    ])).toBe('comment.duplicate_keyword');
  });

  it('still accepts arbitrary single keywords', () => {
    expect(isValidKeyword('XXX')).toBe(true);
  });
});