import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';

// modal.js is pure DOM for openModal; `window.__TAURI__` is only touched by
// the URL-opening click handler. Same setup pattern as xss-sinks.test.js.
function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  dom.window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
  dom.window.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Event = dom.window.Event;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
  return dom;
}

// Query param busts the module cache: each test gets a fresh modal stack.
async function importModal() {
  return import('../src/js/modal.js?' + Math.random());
}

// Flushes the double-rAF that adds the `--visible` class.
const flush = () => new Promise(r => setTimeout(r, 5));

function escKey() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function overlays() {
  return document.querySelectorAll('.ide-modal-overlay');
}

describe('modal.js Escape / stack behaviour', () => {
  it('Escape closes only the top-most of two stacked modals', async () => {
    setupDom();
    const { openModal } = await importModal();
    openModal({ title: 'bottom' });
    openModal({ title: 'top' });
    await flush();

    escKey();

    // Bottom still visible, only the top is being torn down.
    expect(overlays().length).toBe(2);
    expect(overlays()[0].classList.contains('ide-modal-overlay--visible')).toBe(true);
    expect(overlays()[1].classList.contains('ide-modal-overlay--visible')).toBe(false);
  });

  it('closeTopModal closes only the top-most modal', async () => {
    setupDom();
    const { openModal, closeTopModal } = await importModal();
    openModal({ title: 'bottom' });
    openModal({ title: 'top' });
    await flush();

    closeTopModal();

    expect(overlays().length).toBe(2);
    expect(overlays()[0].classList.contains('ide-modal-overlay--visible')).toBe(true);
    expect(overlays()[1].classList.contains('ide-modal-overlay--visible')).toBe(false);
  });

  it('open→close cycles leak nothing: overlays drained, Escape inert', async () => {
    setupDom();
    const { openModal } = await importModal();
    for (let i = 0; i < 5; i++) {
      openModal({ title: `m${i}`, onClose: () => {} }).close();
    }
    expect(overlays().length).toBe(5); // all mid-fade-out

    escKey(); // stale listeners (pre-fix) would fire close() again; must be inert
    escKey();

    await new Promise(r => setTimeout(r, 250)); // remove-fallback timer
    expect(overlays().length).toBe(0);
  });

  it('closeAll tears down the whole stack and fires below-modals onClose', async () => {
    setupDom();
    const { openModal } = await importModal();
    const p = new Promise((resolve) => {
      openModal({
        title: 'bottom',
        buttons: [{ label: 'close all', onClick: (close, closeAll) => closeAll() }],
        onClose: () => resolve('fired'),
      });
    });
    const c = openModal({ title: 'top' });
    c.close();
    await flush();

    overlays()[0].querySelector('button').click();
    expect(await p).toBe('fired');
    expect(overlays().length).toBe(2); // both mid-fade-out, listeners gone
    expect(overlays()[0].classList.contains('ide-modal-overlay--visible')).toBe(false);

    await new Promise(r => setTimeout(r, 250));
    expect(overlays().length).toBe(0);
  });
});
