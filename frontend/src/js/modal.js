/**
 * modal.js
 *  popup modal manager
 *
 * ## API
 *
 * openModal(opts) -> { close, overlay }
 *   opts.title      (string) : header text
 *   opts.body       (string|HTMLElement) : content (HTML string or DOM node)
 *   opts.buttons    (array, optional) : [{ label, primary?, onClick(close) }]
 *   opts.width      (string, optional) : CSS width, e.g. "600px" (default: "480px")
 *   opts.onClose    (function, optional) : called when the modal is dismissed
 *   opts.closable   (boolean, optional) : whether backdrop-click / Escape closes it (default: true)
 *
 * closeTopModal() -> void
 *   Closes the top-most open modal through its own close() (no leaked keydown listener, onClose runs).
 *   Used as teardown by notepad/history/bibliography.
 *
 * showConfirm(opts) -> Promise<boolean>
 *   opts.title, opts.message, opts.confirmLabel, opts.cancelLabel
 *
 * showPrompt(opts) -> Promise<string|null>
 *   opts.title, opts.label, opts.placeholder, opts.validate(v) = string|true
 */

import { t } from '../i18n/index.js'
import { escapeHtml } from './utils/escape.js'

// ## Core ####################################################################

// Stack of currently open modals: Escape closes only the top-most one, and
// every teardown goes through close() so no document-level listener leaks.
const _openStack = [];

/**
 * Close the top-most open modal. For callers that kept a parameter-less
 * "close my modal" helper (notepad, history, bibliography): their modal is
 * always on top of the stack when they call it.
 */
export function closeTopModal() {
    const top = _openStack[_openStack.length - 1];
    top?.close();
}

/**
 * Open a modal with arbitrary content.
 *
 * `body` may be either a string (interpreted as plain text and escaped)
 * or an HTMLElement (used as-is, caller is responsible for safely
 * building it, e.g. via `createElement`/`textContent`). This avoids the
 * historical XSS where backend-controlled content was interpolated into
 * `innerHTML` strings.
 *
 * @param {{
 *   title: string,
 *   body: string | HTMLElement,
 *   buttons?: Array<{ label: string, primary?: boolean, onClick?: (close: () => void) => void }>,
 *   width?: string,
 *   onClose?: () => void,
 *   closable?: boolean,
 * }} opts
 * @returns {{ close: () => void, overlay: HTMLElement }}
 */
export function openModal({ title, body, buttons = [], width = '480px', height = 'auto', onClose, closable = true }) {
    const overlay = document.createElement('div');
    overlay.className = 'ide-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'ide-modal';
    modal.style.width = width;
    modal.style.height = height;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    // Header (title is auto-escaped via textContent, no innerHTML).
    const header = document.createElement('div');
    header.className = 'ide-modal-header';
    const titleEl = document.createElement('h2');
    titleEl.textContent = String(title ?? '');
    header.appendChild(titleEl);
    if (closable) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ide-modal-close-btn';
        closeBtn.textContent = '\u00D7';
        closeBtn.addEventListener('click', () => close());
        header.appendChild(closeBtn);
    }

    // Delegate clicks on `data-tauri-open-url` elements inside the modal
    // to the Tauri opener plugin. This replaces the old `onclick="…"`
    // inline handlers that lived in modal bodies (`structures.js`, ...)
    // and would break a future strict CSP.
    modal.addEventListener('click', (ev) => {
        const target = ev.target.closest('[data-tauri-open-url]');
        if (!target || !modal.contains(target)) return;
        ev.preventDefault();
        const url = target.getAttribute('data-tauri-open-url');
        if (url && window.__TAURI__?.opener?.openUrl) {
            window.__TAURI__.opener.openUrl(url);
        }
    });
    modal.appendChild(header);

    // Body — `string` bodies are treated as plain text (auto-escaped,
    // never interpreted as HTML). Use an HTMLElement to pass pre-built DOM.
    const bodyEl = document.createElement('div');
    bodyEl.className = 'ide-modal-body';
    if (typeof body === 'string') {
        bodyEl.textContent = body;
    } else if (body instanceof HTMLElement) {
        bodyEl.appendChild(body);
    }
    modal.appendChild(bodyEl);

    // Footer (buttons)
    if (buttons.length > 0) {
        const footer = document.createElement('div');
        footer.className = 'ide-modal-actions';
        buttons.forEach(({ label, primary = false, onClick }) => {
            const btn = document.createElement('button');
            btn.className = primary ? 'btn' : 'btn';
            btn.textContent = label;
            btn.addEventListener('click', () => onClick?.(close, closeAll));
            footer.appendChild(btn);
        });
        modal.appendChild(footer);
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function close() {
        if (closed) return;
        closed = true;
        const i = _openStack.indexOf(self);
        if (i !== -1) _openStack.splice(i, 1);
        overlay.classList.remove('ide-modal-overlay--visible');
        // Fallback: transitionend may never fire (e.g. display:none ancestor).
        setTimeout(() => overlay.remove(), 200);
        onClose?.();
        document.removeEventListener('keydown', onKeyDown);
    }

    function closeAll() {
        // Teardown every modal through its own close() so each document-level
        // Escape listener is removed and below-promises (showConfirm/...) resolve.
        [..._openStack].forEach(m => m.close());
    }

    const self = { close, overlay };
    _openStack.push(self);
    let closed = false;

    // Double requestAnimationFrame ensures the element is painted before the transition starts
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('ide-modal-overlay--visible')));

    if (closable) {
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        document.addEventListener('keydown', onKeyDown);
    }

    // Escape closes only the top-most modal, not the whole stack.
    function onKeyDown(e) {
        if (e.key === 'Escape' && _openStack[_openStack.length - 1] === self) close();
    }

    return { close, overlay };
}

// ## Helpers #################################################################

/**
 * Show a confirmation dialog.
 *
 * `message` is rendered as plain text (safe against XSS), pass composed
 * DOM via `bodyElement` instead if you need formatting. Filenames and
 * other user-controlled input should be passed via `t()`-substituted
 * translations here too; this helper never interprets the string as HTML.
 *
 * @param {{ title: string, message: string, confirmLabel?: string, cancelLabel?: string }} opts
 * @returns {Promise<boolean>}
 */
export function showConfirm({ title, message, confirmLabel, cancelLabel }) {
    if (confirmLabel === undefined) confirmLabel = t('modal.confirm')
    if (cancelLabel === undefined) cancelLabel = t('modal.cancel')
    return new Promise((resolve) => {
        const messageEl = document.createElement('p');
        messageEl.className = 'ide-modal-message';
        messageEl.textContent = String(message ?? '');

        const { close } = openModal({
            title,
            body: messageEl,
            buttons: [
                { label: cancelLabel,  primary: false, onClick: (c) => { resolve(false); c(); } },
                { label: confirmLabel, primary: true,  onClick: (c) => { resolve(true);  c(); } },
            ],
            onClose: () => resolve(false),
        });
    });
}

/**
 * Show a text-input prompt modal.
 * @param {{ title: string, label: string, placeholder: string, defaultValue?: string, validate?: (v: string) => string | true }} opts
 * @returns {Promise<string|null>}
 */
export function showPrompt({ title, label, placeholder, defaultValue = '', validate }) {
    return new Promise((resolve) => {
        const inputId = 'modal-prompt-input-' + Date.now();
        const errorId = 'modal-prompt-error-' + Date.now();

        // Build the body with createElement / textContent so user-controlled
        // `label` and `placeholder` strings are escaped on insertion.
        const bodyEl = document.createElement('div');
        const labelEl = document.createElement('label');
        labelEl.className = 'ide-modal-label';
        labelEl.setAttribute('for', inputId);
        labelEl.textContent = String(label ?? '');
        const inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.id = inputId;
        inputEl.className = 'ide-modal-input';
        inputEl.placeholder = String(placeholder ?? '');
        inputEl.maxLength = 80;
        inputEl.autocomplete = 'off';
        labelEl.appendChild(inputEl);
        const errorEl = document.createElement('div');
        errorEl.className = 'ide-modal-error';
        errorEl.id = errorId;
        bodyEl.appendChild(labelEl);
        bodyEl.appendChild(errorEl);

        let resolved = false;
        function done(value) {
            if (!resolved) { resolved = true; close(); resolve(value); }
        }

        const { close, overlay } = openModal({
            title,
            body: bodyEl,
            buttons: [
                { label: t('modal.cancel'),    primary: false, onClick: () => done(null) },
                { label: t('modal.confirm'), primary: true,  onClick: () => tryConfirm() },
            ],
            onClose: () => done(null),
        });

        const input   = overlay.querySelector(`#${inputId}`);
        const errEl   = overlay.querySelector(`#${errorId}`);
        if (input) {
            input.value = defaultValue;
            input.focus();
            // Select the name without the extension so the user can type a new name
            const dotIdx = defaultValue.lastIndexOf('.');
            input.setSelectionRange(0, dotIdx > 0 ? dotIdx : defaultValue.length);
        }

        async function tryConfirm() {
            const value = input?.value.trim() ?? '';
            if (!value) { errEl.textContent = t('modal.required'); return; }
            if (validate) {
                const result = await validate(value);
                if (result !== true) { errEl.textContent = result; return; }
            }
            done(value);
        }

        input?.addEventListener('keydown', e => {
            if (e.key === 'Enter')  tryConfirm();
            if (e.key === 'Escape') done(null);
        });
    });
}

/**
 * Show a text-input prompt modal.
 * @param {{ title: string, label: string, optionsdata: JSON, validate?: (v: string) => string | true }} opts
 * @returns {Promise<string|null>}
 */
export function showSelect({ title, label, optionsdata, validate }) {
  return new Promise((resolve) => {
    const selectId = 'modal-prompt-input-' + Date.now();
    const errorId = 'modal-prompt-error-' + Date.now();

    // Build the body with createElement / textContent, option `value` and
    // display name are escaped automatically, regardless of what keys the
    // caller passes in `optionsdata`.
    const bodyEl = document.createElement('div');
    const labelEl = document.createElement('label');
    labelEl.className = 'ide-modal-label';
    labelEl.setAttribute('for', selectId);
    labelEl.textContent = String(label ?? '');
    const selectEl = document.createElement('select');
    selectEl.id = selectId;
    Object.entries(optionsdata).forEach(([name, required]) => {
      const opt = document.createElement('option');
      opt.value = String(name).toLowerCase();
      opt.textContent = String(name);
      if (required) opt.setAttribute('required', '');
      selectEl.appendChild(opt);
    });
    labelEl.appendChild(selectEl);
    const errorEl = document.createElement('div');
    errorEl.className = 'ide-modal-error';
    errorEl.id = errorId;
    bodyEl.appendChild(labelEl);
    bodyEl.appendChild(errorEl);

    let resolved = false;
    function done(value) {
      if (!resolved) { resolved = true; close(); resolve(value); }
    }

    const { close, overlay } = openModal({
      title,
      body: bodyEl,
      buttons: [
        { label: t('modal.cancel'),    primary: false, onClick: () => done(null) },
        { label: t('modal.confirm'), primary: true,  onClick: () => tryConfirm() },
      ],
      onClose: () => done(null),
    });

    const input   = overlay.querySelector(`#${selectId}`);
    const errEl   = overlay.querySelector(`#${errorId}`);
    input?.focus();

    async function tryConfirm() {
      const value = input?.value.trim() ?? '';
      if (!value) { errEl.textContent = t('modal.required'); return; }
      if (validate) {
        const result = await validate(value);
        if (result !== true) { errEl.textContent = result; return; }
      }
      done(value);
    }

    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter')  tryConfirm();
      if (e.key === 'Escape') done(null);
    });
  });
}
