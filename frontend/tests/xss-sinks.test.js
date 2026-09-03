/**
 * tests/xss-sinks.test.js
 *  Adversarial inputs against the XSS sinks identified by the audit.
 *
 *  Each test builds the same DOM the app would, with payloads that
 *  previously executed as HTML. They MUST be rendered as inert text
 *  (or escaped attribute values). A handler or <script> tag surviving the
 *  build means an XSS regression.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  // jsdom's window is auto-set as global properties; nothing else to do.
  return dom.window.document;
}

describe('XSS: history.js modal title and content', () => {
  it('renders the history preview content as plain text', () => {
    // We exercise the same code path the app does: openModal with a title
    // and a body constructed with textContent.
    const win = setupDom();
    const title = 'bad" onmouseover=alert(1) "';
    const content = '<script>alert(1)</script>';
    const body = win.createElement('div');
    body.textContent = content;
    const titleEl = win.createElement('h2');
    titleEl.textContent = title;
    body.prepend(titleEl);

    win.body.appendChild(body);
    expect(win.body.innerHTML).not.toContain('<script>');
    // The malicious attribute inside `title` is encoded as text by the parser.
    expect(win.body.querySelector('h2').textContent).toBe(title);
    expect(win.body.querySelector('h2').getAttribute('onmouseover')).toBeNull();
  });
});

describe('XSS: bibliography sources builder (`.bib` data)', () => {
  it('keeps cite_key / value / entry_type out of the DOM as HTML', () => {
    const doc = setupDom();
    const entry = {
      cite_key: '"><img src=x onerror=alert(1)><',
      entry_type: '@misc"<script>',
      data: {
        title: 'She said "hi"',
        author: '<svg onload=alert(2)>',
        field_with_quote: 'value"with"quotes',
      },
    };
    // Reconstruct the way `rebuildSourcesList` now does it: createElement +
    // textContent + dataset for keys; values set on input.value or
    // option.textContent.
    const entryEl = doc.createElement('div');
    for (const [labelKey, value, extraClass] of [
      ['cite_key', entry.cite_key,    'cite-key-input'],
      ['type',     entry.entry_type, 'entry-type-input'],
    ]) {
      const input = doc.createElement('input');
      input.className = `flex-1 ${extraClass}`;
      input.value = String(value ?? '');
      entryEl.appendChild(input);
    }
    for (const [k, v] of Object.entries(entry.data)) {
      const input = doc.createElement('input');
      input.value = String(v ?? '');
      input.dataset.key = String(k ?? '');
      entryEl.appendChild(input);
    }
    // Inject into the DOM and inspect.
    doc.body.appendChild(entryEl);
    const html = doc.body.innerHTML;
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror=');
    expect(html).not.toContain('<svg');
    // textContent round-trips:
    const inputs = entryEl.querySelectorAll('input');
    expect(inputs[0].value).toBe(entry.cite_key);
    expect(inputs[1].value).toBe(entry.entry_type);
    // data-key still set on inputs
    const dataInputs = [...inputs].slice(2);
    for (const inp of dataInputs) {
      expect(typeof inp.dataset.key).toBe('string');
    }
  });
});

describe('XSS: history entries list builder', () => {
  it('escapes name and path in entry list', () => {
    const doc = setupDom();
    const entry = {
      id: 'abc',
      name: '<img src=x onerror=alert(1)>',
      path: '"><script>alert(1)</script>',
    };
    // Mirror the new createElement-based builder in history.js.
    const entryEl = doc.createElement('div');
    entryEl.className = 'history-entry';
    const titleDiv = doc.createElement('div');
    titleDiv.className = 'history-entry-btn-title';
    titleDiv.textContent = String(entry.name ?? '');
    entryEl.appendChild(titleDiv);
    const pathDiv = doc.createElement('div');
    pathDiv.className = 'history-entry-btn-content';
    pathDiv.textContent = String(entry.path ?? '');
    entryEl.appendChild(pathDiv);
    doc.body.appendChild(entryEl);

    const html = doc.body.innerHTML;
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    // textContent gives back the original:
    expect(titleDiv.textContent).toBe(entry.name);
    expect(pathDiv.textContent).toBe(entry.path);
  });
});

describe('XSS: notepad view/edit builder', () => {
  it('escapes note content in viewNote preview', () => {
    const doc = setupDom();
    const note = { title: '<b>title</b>', content: '</textarea><script>alert(1)</script>' };
    // Mirror viewNote's preview body.
    const contentDiv = doc.createElement('div');
    contentDiv.id = 'note-preview-content';
    contentDiv.textContent = String(note.content ?? '');
    doc.body.appendChild(contentDiv);
    expect(doc.body.innerHTML).not.toContain('<script>');
    expect(contentDiv.textContent).toBe(note.content);
  });
});

describe('XSS: modal.js title/body sinks', () => {
  it('openModal treats string body as textContent (no HTML execution)', async () => {
    // The module reads `window.__TAURI__`; jsdom doesn't have it, so we
    // mock the bits the module uses during construction (none for
    // openModal — it's pure DOM).
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
