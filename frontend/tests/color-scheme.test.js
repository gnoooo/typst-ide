/**
 * tests/color-scheme.test.js
 *  Theme parsing, application and selection (vitest runs in node; jsdom is
 *  set up by hand, like the other DOM tests).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  DEFAULT_THEME_FILE,
  applyColorScheme,
  applyThemeSelection,
  getActiveThemePath,
  getThemeMode,
  initColorScheme,
  loadActiveTheme,
  parseColorScheme,
} from '../src/js/color-scheme.js';

// Fixed allowed set: the real one is read from getComputedStyle at runtime.
const ALLOWED = new Set(['--bg', '--text', '--accent']);

const withFormat = (extra) =>
  JSON.stringify({ format: 'typst-ide-color-scheme', formatVersion: 1, ...extra });

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  // jsdom 29 ships no CSS.supports: stub the color check the parser calls.
  globalThis.CSS = {
    supports: (prop, value) =>
      prop === 'color' && /^(#[0-9a-f]{3,8}|rgb|hsl)/i.test(value),
  };
  // getAllowedKeys() falls back to stylesheet declarations in jsdom.
  const style = dom.window.document.createElement('style');
  style.textContent = ':root { --bg: #fff; --text: #000; --accent: #123; }';
  dom.window.document.head.appendChild(style);
  return dom.window.document.documentElement;
}

let root;

beforeEach(() => {
  root = setupDom();
  localStorage.clear();
  delete globalThis.window.__TAURI__;
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

  it('accepts a theme with only light or only dark', () => {
    expect(parseColorScheme(withFormat({ light: { '--bg': '#fff' } }), ALLOWED).dark).toEqual({});
    expect(parseColorScheme(withFormat({ dark: { '--bg': '#000' } }), ALLOWED).light).toEqual({});
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

describe('applyColorScheme', () => {
  it('applies a parsed scheme to documentElement for the given theme', () => {
    const scheme = parseColorScheme(
      withFormat({ light: { '--bg': '#ffffff' }, dark: { '--bg': '#000000' } }),
      ALLOWED,
    );

    applyColorScheme(scheme, 'dark');

    expect(root.style.getPropertyValue('--bg')).toBe('#000000');
    expect(getThemeMode()).toBe('dark');
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

describe('theme selection', () => {
  it('persists the file path and mode, applies the palette and emits the event', async () => {
    const emit = vi.fn();
    globalThis.window.__TAURI__ = {
      core: {
        invoke: async (cmd) => {
          if (cmd === 'read_theme') {
            return withFormat({
              name: 'Mine',
              light: { '--bg': '#ffffff' },
              dark: { '--bg': '#000000' },
            });
          }
          return null;
        },
      },
      event: { emit },
    };

    const result = await applyThemeSelection('mine.json', 'dark');

    expect(result.mode).toBe('dark');
    expect(getActiveThemePath()).toBe('mine.json');
    expect(getThemeMode()).toBe('dark');
    expect(root.style.getPropertyValue('--bg')).toBe('#000000');
    expect(emit).toHaveBeenCalledWith('theme:changed', { theme: 'dark', path: 'mine.json' });
  });

  it('falls back to the available variant when the requested one is missing', async () => {
    globalThis.window.__TAURI__ = {
      core: {
        invoke: async (cmd) => {
          if (cmd === 'read_theme') {
            return withFormat({ name: 'Light only', light: { '--bg': '#ffffff' } });
          }
          return null;
        },
      },
      event: { emit: vi.fn() },
    };

    const result = await applyThemeSelection('light-only.json', 'dark');

    expect(result.mode).toBe('light');
    expect(getThemeMode()).toBe('light');
    expect(root.style.getPropertyValue('--bg')).toBe('#ffffff');
  });

  it('falls back to default.json when the active file is missing', async () => {
    localStorage.setItem('theme-path', 'missing.json');
    globalThis.window.__TAURI__ = {
      core: {
        invoke: async (cmd, args) => {
          if (cmd !== 'read_theme') return null;
          if (args.file === DEFAULT_THEME_FILE) {
            return withFormat({ name: 'Default', light: { '--bg': '#eeeeee' } });
          }
          return null;
        },
      },
      event: { emit: vi.fn() },
    };

    await loadActiveTheme();

    expect(getActiveThemePath()).toBe(DEFAULT_THEME_FILE);
    expect(root.style.getPropertyValue('--bg')).toBe('#eeeeee');
  });

  it('creates the default theme when it is missing', async () => {
    let saved = null;
    document.documentElement.setAttribute('data-theme', 'dark');
    globalThis.getComputedStyle = () => fakeComputed(document.documentElement.getAttribute('data-theme'));
    globalThis.window.__TAURI__ = {
      core: {
        invoke: async (cmd, args) => {
          if (cmd === 'read_theme') return null;
          if (cmd === 'write_theme') {
            saved = args;
            return undefined;
          }
          return null;
        },
      },
      event: { emit: vi.fn() },
    };

    await initColorScheme({ createDefault: true });

    const doc = JSON.parse(saved.payload);
    expect(saved.file).toBe(DEFAULT_THEME_FILE);
    expect(doc.name).toBe('Default');
    expect(doc.light['--bg']).toBe('#ffffff');
    expect(doc.dark['--bg']).toBe('#000000');
    expect(doc.light['--font-code']).toBeUndefined();
    expect(root.style.getPropertyValue('--bg')).toBe('#000000');
  });
});

function fakeComputed(theme) {
  const vars = theme === 'dark'
    ? { '--bg': '#000000', '--text': '#eeeeee', '--font-code': 'monospace' }
    : { '--bg': '#ffffff', '--text': '#111111', '--font-code': 'monospace' };
  const keys = Object.keys(vars);
  const decl = { length: keys.length, getPropertyValue: (key) => vars[key] ?? '' };
  keys.forEach((key, i) => { decl[i] = key; });
  return decl;
}
