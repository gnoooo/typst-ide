/**
 * tests/color-scheme.test.js
 *  User color scheme parsing and application (vitest runs in node; jsdom is
 *  set up by hand, like the other DOM tests).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseColorScheme, applyColorScheme, reloadColorScheme, initColorScheme } from '../src/js/color-scheme.js';

// Fixed allowed set: the real one is read from getComputedStyle at runtime.
const ALLOWED = new Set(['--bg', '--text', '--accent']);

const withFormat = (extra) =>
  JSON.stringify({ format: 'typst-ide-color-scheme', formatVersion: 1, ...extra });

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  // jsdom 29 ships no CSS.supports: stub the color check the parser calls.
  globalThis.CSS = {
    supports: (prop, value) =>
      prop === 'color' && /^(#[0-9a-f]{3,8}|rgb|hsl)/i.test(value),
  };
  return dom.window.document.documentElement;
}

let root;

beforeEach(() => {
  root = setupDom();
});

describe('parseColorScheme', () => {
  it('accepts a valid scheme and keeps only allowed color entries', () => {
    const scheme = parseColorScheme(
      withFormat({
        name: 'Mine',
        light: { '--bg': '#ffffff', '--text': '#111111', '--nope': '#000000' },
        dark: { '--bg': '#000000' },
      }),
      ALLOWED,
    );

    expect(scheme.name).toBe('Mine');
    expect(scheme.light).toEqual({ '--bg': '#ffffff', '--text': '#111111' });
    expect(scheme.dark).toEqual({ '--bg': '#000000' });
  });

  it('ignores unknown keys and non--- keys', () => {
    const scheme = parseColorScheme(
      withFormat({ light: { '--bg': '#fff', 'background': 'red', '--unknown': '#123' } }),
      ALLOWED,
    );
    expect(scheme.light).toEqual({ '--bg': '#fff' });
  });

  it('rejects invalid color values and url()', () => {
    const scheme = parseColorScheme(
      withFormat({
        light: { '--text': 'not-a-color' },
        dark: { '--bg': 'url(#x)', '--accent': '#123456' },
      }),
      ALLOWED,
    );
    expect(scheme.light).toEqual({});
    expect(scheme.dark).toEqual({ '--accent': '#123456' });
  });

  it('returns null on invalid JSON', () => {
    expect(parseColorScheme('not json', ALLOWED)).toBeNull();
  });

  it('returns null on a wrong format or version', () => {
    expect(
      parseColorScheme(JSON.stringify({ format: 'other', formatVersion: 1, light: { '--bg': '#fff' } }), ALLOWED),
    ).toBeNull();
    expect(
      parseColorScheme(JSON.stringify({ format: 'typst-ide-color-scheme', formatVersion: 2, light: { '--bg': '#fff' } }), ALLOWED),
    ).toBeNull();
  });

  it('returns null when no light/dark section has a valid entry', () => {
    expect(parseColorScheme(withFormat({ name: 'empty' }), ALLOWED)).toBeNull();
    expect(parseColorScheme(withFormat({ light: {}, dark: { '--nope': '#fff' } }), ALLOWED)).toBeNull();
  });
});

describe('reloadColorScheme', () => {
  it('discovers variables from the stylesheets and applies the loaded file', async () => {
    const style = document.createElement('style');
    style.textContent = ':root { --bg: #ffffff; --text: #000000; }';
    document.head.appendChild(style);
    document.documentElement.setAttribute('data-theme', 'dark');
    globalThis.window.__TAURI__ = {
      core: {
        invoke: async (cmd) =>
          cmd === 'load_color_scheme'
            ? withFormat({ dark: { '--bg': '#123456', '--nope': '#000000' } })
            : null,
      },
    };

    const scheme = await reloadColorScheme();

    expect(scheme.dark).toEqual({ '--bg': '#123456' });
    expect(root.style.getPropertyValue('--bg')).toBe('#123456');
    delete globalThis.window.__TAURI__;
  });

  it('clears the applied overrides when the file is gone', async () => {
    const scheme = parseColorScheme(withFormat({ light: { '--bg': '#ffffff' } }), ALLOWED);
    applyColorScheme(scheme, 'light');
    expect(root.style.getPropertyValue('--bg')).toBe('#ffffff');

    globalThis.window.__TAURI__ = { core: { invoke: async () => null } };

    expect(await reloadColorScheme()).toBeNull();
    expect(root.style.getPropertyValue('--bg')).toBe('');
    delete globalThis.window.__TAURI__;
  });
});

describe('initColorScheme', () => {
  // Fake computed style: the real WebKit returns the custom properties of the
  // applied theme; jsdom does not, hence the stub.
  function fakeComputed(theme) {
    const vars = theme === 'dark'
      ? { '--bg': '#000000', '--text': '#eeeeee', '--font-code': 'monospace' }
      : { '--bg': '#ffffff', '--text': '#111111', '--font-code': 'monospace' };
    const keys = Object.keys(vars);
    const decl = { length: keys.length, getPropertyValue: (key) => vars[key] ?? '' };
    keys.forEach((key, i) => { decl[i] = key; });
    return decl;
  }

  it('writes the built-in palette for both themes, then applies the current one', async () => {
    let saved = null;
    document.documentElement.setAttribute('data-theme', 'dark');
    globalThis.getComputedStyle = () => fakeComputed(document.documentElement.getAttribute('data-theme'));
    globalThis.window.__TAURI__ = {
      core: {
        invoke: async (cmd, args) => {
          if (cmd === 'save_color_scheme') saved = args.payload;
        },
      },
    };

    await initColorScheme({ writeDefault: true });

    const doc = JSON.parse(saved);
    expect(doc.name).toBe('Default');
    expect(doc.light['--bg']).toBe('#ffffff');
    expect(doc.dark['--bg']).toBe('#000000');
    expect(doc.light['--font-code']).toBeUndefined();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(root.style.getPropertyValue('--bg')).toBe('#000000');

    delete globalThis.window.__TAURI__;
  });
});

describe('applyColorScheme', () => {
  it('applies a parsed scheme to documentElement for the given theme', () => {
    const scheme = parseColorScheme(
      withFormat({ light: { '--bg': '#ffffff' }, dark: { '--bg': '#000000' } }),
      ALLOWED,
    );

    applyColorScheme(scheme, 'dark');

    expect(root.style.getPropertyValue('--bg')).toBe('#000000');
  });

  it('defaults to the theme currently set on the document', () => {
    const scheme = parseColorScheme(
      withFormat({ light: { '--bg': '#ffffff' }, dark: { '--bg': '#000000' } }),
      ALLOWED,
    );
    document.documentElement.setAttribute('data-theme', 'dark');

    applyColorScheme(scheme);

    expect(root.style.getPropertyValue('--bg')).toBe('#000000');
  });

  it('clears the previous overrides when switching theme', () => {
    const scheme = parseColorScheme(
      withFormat({ light: { '--text': '#111111' }, dark: { '--bg': '#000000' } }),
      ALLOWED,
    );
    applyColorScheme(scheme, 'light');
    expect(root.style.getPropertyValue('--text')).toBe('#111111');

    applyColorScheme(scheme, 'dark');

    expect(root.style.getPropertyValue('--text')).toBe('');
    expect(root.style.getPropertyValue('--bg')).toBe('#000000');
  });

  it('clears everything with a null scheme', () => {
    const scheme = parseColorScheme(withFormat({ light: { '--bg': '#ffffff' } }), ALLOWED);
    applyColorScheme(scheme, 'light');
    expect(root.style.getPropertyValue('--bg')).toBe('#ffffff');

    applyColorScheme(null);

    expect(root.style.getPropertyValue('--bg')).toBe('');
  });
});
