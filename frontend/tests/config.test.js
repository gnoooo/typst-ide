/**
 * tests/config.test.js
 *  Unit tests for the config export/import helpers.
 *
 *  localStorage is stubbed (vitest 4 runs in the node environment).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SETTINGS_KEYS,
  buildExportPayload,
  parseConfigDocument,
  applySettings,
  exportAvailability,
  importAvailability,
} from '../src/js/config.js';

beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
});

const fillSettings = () => {
  localStorage.setItem('theme', 'dark');
  localStorage.setItem('lang', 'fr');
  localStorage.setItem('auto-compile', 'false');
  localStorage.setItem('show-console-on-error', 'true');
  localStorage.setItem('console-ignore-terms', 'warning A');
  localStorage.setItem('editor-font-size', '15');
  localStorage.setItem('editor-font-family', 'Fira Code');
  localStorage.setItem('webview-zoom', '1.15');
  localStorage.setItem(
    'comments.keytags.v1',
    JSON.stringify([{ id: 'todo', keyword: 'TODO:', label: 'TODO', color: '#eab308', enabled: true }]),
  );
  localStorage.setItem('preview-debug', 'true');
};

describe('buildExportPayload', () => {
  it('exports an envelope with the whitelisted settings only', () => {
    fillSettings();
    const payload = buildExportPayload(
      { notes: [{ id: 'n1' }], history: [], templates: {} },
      { appVersion: '1.6.5' },
    );

    expect(payload.format).toBe('typst-ide-config');
    expect(payload.formatVersion).toBe(1);
    expect(payload.appVersion).toBe('1.6.5');
    expect(payload.exportedAt).toBeTruthy();
    expect(payload.notes).toEqual([{ id: 'n1' }]);

    // All whitelisted keys are present…
    for (const key of SETTINGS_KEYS) {
      expect(payload.settings).toHaveProperty(key);
    }
    // …and only them (preview-debug must never be exported).
    expect(Object.keys(payload.settings).sort()).toEqual([...SETTINGS_KEYS].sort());
  });

  it('omits absent settings instead of exporting nulls', () => {
    const payload = buildExportPayload();
    expect(payload.settings).toEqual({});
  });

  it('excludes unselected sections', () => {
    fillSettings();
    const payload = buildExportPayload(
      { notes: [{ id: 'n1' }], history: [{ path: 'h1' }], templates: { starter: {} } },
      {},
      { settings: true, keytags: false, notes: false, history: false, templates: false },
    );

    expect(payload.settings).toHaveProperty('theme');
    expect(payload.settings).not.toHaveProperty('comments.keytags.v1');
    expect(payload.notes).toEqual([]);
    expect(payload.history).toEqual([]);
    expect(payload.templates).toEqual({});
  });

  it('exports only the keytags when settings are unselected', () => {
    fillSettings();
    const payload = buildExportPayload(
      { notes: [], history: [], templates: {} },
      {},
      { settings: false, keytags: true },
    );

    expect(Object.keys(payload.settings)).toEqual(['comments.keytags.v1']);
  });

  it('defaults to every section selected when none is given', () => {
    fillSettings();
    const payload = buildExportPayload(
      { notes: [{ id: 'n1' }], history: [{ path: 'h1' }], templates: {} },
    );
    expect(payload.notes).toEqual([{ id: 'n1' }]);
    expect(payload.history).toEqual([{ path: 'h1' }]);
    expect(payload.settings).toHaveProperty('comments.keytags.v1');
  });
});

describe('parseConfigDocument', () => {
  it('accepts a valid document', () => {
    const doc = parseConfigDocument(
      JSON.stringify({ format: 'typst-ide-config', formatVersion: 1, settings: {} }),
    );
    expect(doc.formatVersion).toBe(1);
  });

  it('rejects non-JSON content', () => {
    expect(() => parseConfigDocument('not json')).toThrow();
  });

  it('rejects documents with the wrong format marker', () => {
    expect(() => parseConfigDocument('{"format":"something-else","formatVersion":1}')).toThrow();
  });

  it('rejects future format versions', () => {
    expect(() =>
      parseConfigDocument('{"format":"typst-ide-config","formatVersion":99}'),
    ).toThrow();
  });
});

describe('applySettings', () => {
  it('writes whitelisted keys and ignores unknown ones', () => {
    fillSettings();
    localStorage.removeItem('theme');

    applySettings({
      theme: 'light',
      'preview-debug': 'false', // unknown → must be ignored
      unknown_future_key: 'whatever',
      'comments.keytags.v1': [
        { id: 'todo', keyword: 'TODO:', label: 'TODO', color: '#000000', enabled: false },
      ],
    });

    expect(localStorage.getItem('theme')).toBe('light');
    expect(localStorage.getItem('preview-debug')).toBe('true'); // untouched
    expect(localStorage.getItem('unknown_future_key')).toBeNull();
    expect(localStorage.getItem('comments.keytags.v1')).toContain('#000000');
  });

  it('does nothing on empty or null settings', () => {
    applySettings(null);
    applySettings({});
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('only writes the given keys when a subset is passed', () => {
    fillSettings();
    applySettings({ theme: 'light', 'comments.keytags.v1': '[]' }, ['theme']);
    expect(localStorage.getItem('theme')).toBe('light');
    // keytags key not in the subset → untouched
    expect(localStorage.getItem('comments.keytags.v1')).toContain('#eab308');
  });
});

describe('exportAvailability', () => {
  it('is true for sections that have content', () => {
    fillSettings();
    const availability = exportAvailability({
      notes: [{ id: 'n1' }],
      history: [{ path: 'h1' }],
      templates: { starter: {} },
    });
    expect(availability).toEqual({
      settings: true,
      keytags: true,
      notes: true,
      history: true,
      templates: true,
    });
  });

  it('is false for empty sections', () => {
    localStorage.clear();
    const availability = exportAvailability({ notes: [], history: [], templates: {} });
    expect(availability).toEqual({
      settings: false,
      keytags: false,
      notes: false,
      history: false,
      templates: false,
    });
  });
});

describe('importAvailability', () => {
  const base = { format: 'typst-ide-config', formatVersion: 1 };

  it('is true for sections present in the file', () => {
    const doc = {
      ...base,
      settings: { theme: 'dark', 'comments.keytags.v1': [] },
      notes: [{ id: 'n1' }],
      history: [{ path: 'h1' }],
      templates: { starter: {} },
    };
    expect(importAvailability(doc)).toEqual({
      settings: true,
      keytags: true,
      notes: true,
      history: true,
      templates: true,
    });
  });

  it('is false for sections missing or empty in the file', () => {
    const doc = { ...base, settings: { unknown_future_key: 'x' } };
    const availability = importAvailability(doc);
    expect(availability).toEqual({
      settings: false, // only a whitelisted key would count
      keytags: false,
      notes: false,
      history: false,
      templates: false,
    });
  });
});