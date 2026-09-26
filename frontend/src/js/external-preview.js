/**
 * external-preview.js
 *  "Preview in a separate window" mode (main window side).
 *
 *  Coordinates the transparent toggle between the classic embedded split and
 *  the external preview window:
 *   - opens/closes the Tauri "preview" window (Rust `preview_window` commands),
 *   - switches the main layout to editor-only (`body.preview-external`) and
 *     back when the preview window is destroyed,
 *   - forwards preview clicks to the editor (the preview window emits raw
 *     coordinates; resolution happens here where the live source lives).
 *
 *  The mode is transient: nothing is persisted, each launch starts embedded.
 */

import { getCurrentProject } from './project.js';

let _active = false;
let _onStateChange = null;
let _handlers = {};

/** Whether the external preview window is currently the render target. */
export function isExternalPreviewActive() {
    return _active;
}

/**
 * Registers event listeners and re-adopts the external layout on startup if
 * the preview window survived a main-window reload.
 * @param {(active: boolean) => void} onStateChange called whenever the mode
 *  changed (e.g. to trigger a fresh compile when it turns on).
 * @param {{ onCompile?: () => void, onSavePdf?: () => void }} [handlers]
 *  Actions forwarded from the preview window's toolbar (compile / save PDF).
 */
export function initExternalPreview(onStateChange, handlers = {}) {
    _handlers = handlers;
    const event = window.__TAURI__?.event;
    if (!event) return;

    event.listen('preview-window-closed', () => {
        if (!_active) return;
        applyLayout(false);
        _onStateChange?.(false);
    });

    // The preview window announced it is ready and listening for updates.
    event.listen('preview:ready', () => {
        if (_active) _onStateChange?.(true);
    });

    // Preview window click → source position (resolved here, on the main side).
    event.listen('preview:click', (e) => resolvePreviewClick(e.payload));

    // Toolbar actions duplicated in the preview window: same code paths as the
    // main toolbar's compile / save buttons.
    event.listen('preview:request-compile', () => _handlers.onCompile?.());
    event.listen('preview:request-save-pdf', () => _handlers.onSavePdf?.());

    // Main window may have been reloaded (e.g. config import) while the
    // preview window was still open: re-adopt the external layout.
    window.__TAURI__.core
        ?.invoke('preview_window_status')
        .then((open) => {
            if (open) {
                applyLayout(true);
                _onStateChange?.(true);
            }
        })
        .catch(() => {});
}

/**
 * Turns the external preview mode on or off.
 * @param {boolean} active
 */
export async function setExternalPreview(active) {
    if (active === _active) {
        if (active) await ensureOpen();
        return;
    }
    if (active) {
        applyLayout(true);
        const ok = await ensureOpen();
        if (!ok) {
            applyLayout(false);
            return;
        }
        _onStateChange?.(true);
    } else {
        applyLayout(false);
        await window.__TAURI__.core?.invoke('close_preview_window');
        _onStateChange?.(false);
    }
}

/** Toggles the mode to the opposite state. */
export async function toggleExternalPreview() {
    await setExternalPreview(!_active);
}

// ## Internals ##############################################################

function applyLayout(active) {
    _active = active;
    document.body.classList.toggle('preview-external', active);

    const checkbox = document.getElementById('external-preview-toggle');
    if (checkbox) checkbox.checked = active;

    const btn = document.getElementById('external-preview-btn');
    if (btn) btn.classList.toggle('active', active);
}

async function ensureOpen() {
    const ok = await window.__TAURI__.core?.invoke('ensure_preview_window');
    return ok === true;
}

async function resolvePreviewClick(payload) {
    if (!payload) return;
    const { page, x, y } = payload;
    const editor = window.__typstEditor;
    if (!editor) return;

    const source = editor.getValue();
    const root = getCurrentProject()?.path ?? null;
    let result;
    try {
        result = await window.__TAURI__.core.invoke('resolve_preview_click', {
            source,
            root,
            page,
            x,
            y,
        });
    } catch (_) {
        console.warn('[click] resolve_preview_click threw', _);
        return;
    }
    if (!result) return;
    editor.setPosition({ lineNumber: result.line, column: result.column });
    editor.revealPositionInCenter({ lineNumber: result.line, column: result.column });
    // Defer focus so the browser finishes processing the iframe click.
    setTimeout(() => editor.focus(), 0);
}