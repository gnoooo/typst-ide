/**
 * tests/xss-sinks.test.js
 *  Adversarial inputs against the XSS sinks identified by the audit.
 *
 *  These tests drive the REAL builders (openSources, openHistory,
 *  viewHistoryEntry, viewNote, the STRUCT_ELEMENTS modal builders, openModal,
 *  isValidFontFamily) over hostile data. That data MUST come out as inert
 *  text (textContent / input.value / CSS style property). A surviving
 *  `<script>`/`<img>` element or inline event attribute means an XSS
 *  regression.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

// editor.js pulls `monaco-editor` and top-level `localStorage`, unloadable
// under node the whole module is mocked. A controlled getCurrentFontFamily()
// doubles as the injection vector for the font-family interpolations
// (structures.js) and the style.cssText sinks (sources/history/notepad).
const malice = vi.hoisted(() => ({ font: '"><img src=x onerror=alert(1)><' }));
vi.mock('../src/js/editor.js', () => ({
  getEditor: () => null,
  getCurrentFontFamily: () => malice.font,
}));

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  const invoke = vi.fn(async () => null);
  // The app modules destructure Tauri's core at module top-level.
  dom.window.__TAURI__ = { core: { invoke } };
  return { dom, doc: dom.window.document, invoke };
}

// An executable element or inline handler surviving any builder means XSS.
function assertNoExecutableMarkup() {
  const doc = globalThis.document;
  expect(doc.querySelector('script')).toBeNull();
  expect(doc.querySelector('img:not(#structures-figure-preview-img)')).toBeNull();
  expect(doc.querySelector('[onerror], [onmouseover], [onload]')).toBeNull();
}

const type = (el, dom, value) => { el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
const click = (el, dom) => el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

// Modules freeze `window.__TAURI__.core` at first import: rebuild them for
// every test so each one binds its own JSDOM window/invoke stub.
afterEach(() => vi.resetModules());

describe('XSS: bibliography source list (sources.js, real code)', () => {
  const entry = {
    cite_key: '"><img src=x onerror=alert(1)><',
    entry_type: '@misc"<script>',
    data: {
      title: 'She said "hi"',
      author: '<svg onload=alert(2)>',
      field_with_quote: 'value"with"quotes',
    },
  };

  it('leaves hostile .bib values inert (rendered via openSources)', async () => {
    const { dom, doc, invoke } = setupDom();
    invoke.mockImplementation(async (cmd) => (cmd === 'parse_bib_file' ? [entry] : null));
    const { openSources } = await import('../src/js/bibliography/sources.js');
    await openSources('test.bib');

    assertNoExecutableMarkup();
    // user data round-trips through the safe `.value` / `.textContent` sinks
    expect(doc.querySelector('.cite-key-input').value).toBe(entry.cite_key);
    expect(doc.querySelector('.entry-type-input').value).toBe(entry.entry_type);
    expect(doc.querySelector('input[data-key="author"]').value).toBe('<svg onload=alert(2)>');
    expect(doc.querySelector('input[data-key="field_with_quote"]').value).toBe('value"with"quotes');
    // field keys render as text, never as markup
    expect(doc.querySelector('#sources-list-container').textContent).toContain('title :');
  });

  it('search filter and empty state stay inert', async () => {
    const { dom, doc, invoke } = setupDom();
    invoke.mockImplementation(async (cmd) => (cmd === 'parse_bib_file' ? [entry] : null));
    const { openSources } = await import('../src/js/bibliography/sources.js');
    await openSources('test.bib');

    const search = doc.querySelector('input[placeholder="source.search"]');
    type(search, dom, 'she said');
    assertNoExecutableMarkup();
    expect(doc.querySelector('.cite-key-input').value).toBe(entry.cite_key);

    type(search, dom, 'zzz-no-match');
    expect(doc.querySelector('.cite-key-input')).toBeNull(); // empty-state path
    assertNoExecutableMarkup();
  });
});

describe('XSS: history builder (history.js, real code)', () => {
  const entry = {
    id: 'abc',
    name: '<img src=x onerror=alert(1)>',
    path: '"><script>alert(1)</script>',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  };

  it('escapes name and path in the list (built via openHistory)', async () => {
    const { dom, doc, invoke } = setupDom();
    invoke.mockImplementation(async (cmd) => (cmd === 'get_history' ? [entry] : null));
    const { openHistory } = await import('../src/js/history.js');
    await openHistory();

    assertNoExecutableMarkup();
    expect(doc.querySelector('.history-entry-btn-title').textContent).toBe(entry.name);
    expect(doc.querySelector('.history-entry-btn-content').textContent).toBe(entry.path);

    const search = doc.querySelector('input[placeholder="history.search"]');
    type(search, dom, 'onerror');
    expect(doc.querySelector('.history-entry-btn-title').textContent).toBe(entry.name);
    type(search, dom, 'zzz-no-match');
    expect(doc.querySelector('.history-entry')).toBeNull();
    assertNoExecutableMarkup();
  });

  it('preview modal renders the project content as text (viewHistoryEntry)', async () => {
    const { dom, doc, invoke } = setupDom();
    const readFile = { content: '</textarea><script>alert(1)</script>' };
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'get_history') return [entry];
      if (cmd === 'open_project') return readFile;
      return null;
    });
    const { openHistory } = await import('../src/js/history.js');
    await openHistory();

    click(doc.querySelector('.view-history-entry-btn'), dom);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertNoExecutableMarkup();
    const preview = doc.querySelector('#note-preview-content');
    expect(preview.textContent).toBe(readFile.content);
    // the preview header is a static label; the hostile name/path never
    // surface as markup (asserted above)
    const titles = doc.querySelectorAll('.ide-modal-header h2');
    expect(titles[titles.length - 1].textContent).toBe('history.preview_title');
  });
});

describe('XSS: notepad viewNote preview (notepad.js, real code)', () => {
  it('renders note title and content as plain text', async () => {
    const { dom, doc } = setupDom();
    const { viewNote } = await import('../src/js/notepad.js');
    await viewNote({
      id: 'n1',
      title: '<b>title</b>',
      content: '</textarea><script>alert(1)</script>',
      scope: 'global',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    assertNoExecutableMarkup();
    expect(doc.querySelector('#note-preview-content').textContent)
      .toBe('</textarea><script>alert(1)</script>');
    // the hostile title never becomes HTML: openModal renders titles as text
    expect(doc.querySelector('.ide-modal-header h2').textContent).toBe('<b>title</b>');
    expect(doc.querySelector('b')).toBeNull();
  });
});

describe('XSS: STRUCT_ELEMENTS font-family interpolation (structures.js)', () => {
  it('builds every structure modal without executing the mocked font value', async () => {
    const { dom, doc } = setupDom();
    const { STRUCT_ELEMENTS } = await import('../src/js/structures.js');
    const { closeTopModal } = await import('../src/js/modal.js');

    const expectedPres = { table: 4, grid: 4, rect: 5, figure: 0 };
    for (const item of STRUCT_ELEMENTS) {
      item.openModal();
      // the overlay appended last belongs to this call
      const overlay = doc.body.lastElementChild;
      expect(overlay.className).toBe('ide-modal-overlay');
      assertNoExecutableMarkup();
      // the templated <pre> blocks must all be present (font loop intact)
      const pres = overlay.querySelectorAll('pre');
      expect(pres.length).toBe(expectedPres[item.id]);
      if (item.id === 'table') expect(pres[0].textContent).toBe('2 2');
      if (item.id === 'grid') expect(pres[0].textContent).toBe('1 1');
      if (item.id === 'rect') expect(pres[0].textContent).toBe('auto auto');
      closeTopModal();
    }
  });
});

describe('XSS: editor font family (config import)', () => {
  it('rejects font values that could break out of a style="..." attribute', async () => {
    const { isValidFontFamily } = await import('../src/js/font-family.js');
    // Payload from a malicious config file: breaks out of style="font-family: ...".
    expect(isValidFontFamily('"><img src=x onerror=alert(1)>')).toBe(false);
    expect(isValidFontFamily('<script>alert(1)</script>')).toBe(false);
    expect(isValidFontFamily('x"; } img { background:url(x) }')).toBe(false);
    expect(isValidFontFamily(42)).toBe(false);
    // Legitimate stacks must still pass (default + accented names).
    expect(isValidFontFamily("'Fira Code', 'Cascadia Code', 'Courier New', monospace")).toBe(true);
    expect(isValidFontFamily('IBM Plex Sans 3')).toBe(true);
    expect(isValidFontFamily('Source Serif é')).toBe(true);
  });
});

describe('XSS: modal.js title/body sinks', () => {
  it('openModal treats string body as textContent (no HTML execution)', async () => {
    // The module reads `window.__TAURI__`; jsdom doesn't have it, so we
    // mock the bits the module uses during construction (none for openModal, it's pure DOM).
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    // Polyfill what jsdom doesn't ship.
    dom.window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
    dom.window.cancelAnimationFrame = (id) => clearTimeout(id);
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
    const { openModal } = await import('../src/js/modal.js');

    const malicious = '<script>window.__pwned = true;</script>';
    openModal({
      title: '<img src=x onerror=alert(1)>',
      body: malicious,
    });
    // No active <script> tag should have been injected.
    expect(dom.window.document.body.querySelector('script')).toBeNull();
    expect(dom.window.document.body.innerHTML).not.toContain('<script>');
    expect(dom.window.__pwned).toBeUndefined();
    // Title attribute should not contain a runnable <img> tag.
    expect(dom.window.document.body.querySelector('img')).toBeNull();
  });
});
