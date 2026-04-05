/**
 * Preview panel
 *  compiles Typst source and renders it in the iframe
 *
 * Exports a single `initPreview()` function that wires up the editor textarea
 * to the preview iframe via the Tauri `render_preview`
 *
 * ## API
 * initPreview(opts)
 *  * opts.getSource() -> string: returns the current editor content
 *  * opts.onChange(cb) -> void: registers `cb` to be called whenever the source changes
 *  * opts.preview: HTMLElement container for the preview (used to show error messages)
 *  * opts.frame: HTMLIFrameElement where the compiled HTML should be written
 *  * opts.debounceMs: number of milliseconds to wait after a change before recompiling (default: 100)
 *
 * showError(preview, frame, message) -> void
 *  * Displays the given error message in the preview panel, hiding the iframe
 *
 * clearError(preview, frame) -> void
 *  * Clears any visible error and restores the iframe
 *
 * compile(source, preview, frame) -> Promise<void>
 *  * Compiles the given source and writes the result into `frame`
 *  * Shows an error message on failure. Stale results (superseded by a newer call) are silently dropped.
 *
 * zoomPreviewIn/Out/Reset() -> void:
 *  * Adjust the zoom level of the preview iframe
 *
 * getPreviewZoom() -> number:
 *  * Returns the current zoom level as a percentage (e.g. 100)
 *
 * setPreviewZoom(value) -> void:
 *  * Sets the zoom level, clamped between 20 and 400
 */

const { invoke } = window.__TAURI__.core;
import { getCurrentProject } from './project.js';

// ### Web Worker for off-thread Blob creation ##################################

/** @type {Worker|null} */
let _blobWorker = null;
/** @type {Map<number, (url: string) => void>} */
const _blobCallbacks = new Map();
let _blobIdCounter = 0;

function getBlobWorker() {
    if (!_blobWorker) {
        _blobWorker = new Worker(
            new URL('./preview-worker.js', import.meta.url),
            { type: 'module' }
        );
        _blobWorker.onmessage = (e) => {
            if (e.data.type === 'blobReady') {
                const cb = _blobCallbacks.get(e.data.id);
                if (cb) {
                    _blobCallbacks.delete(e.data.id);
                    cb(e.data.url);
                }
            }
        };
    }
    return _blobWorker;
}

/**
 * Creates a Blob URL from HTML in a Web Worker, off the main thread
 * @param {string} html
 * @returns {Promise<string>} blob URL
 */
function createBlobUrlAsync(html) {
    return new Promise((resolve) => {
        const id = ++_blobIdCounter;
        _blobCallbacks.set(id, resolve);
        getBlobWorker().postMessage({ type: 'createBlob', html, id });
    });
}

// ### Adaptive debounce ########################################################

/** Base debounce in ms (small documents) */
const DEBOUNCE_MIN = 100;
/** Maximum debounce in ms (large documents) */
const DEBOUNCE_MAX = 500;
/** Characters threshold where debounce starts increasing */
const DEBOUNCE_THRESHOLD = 5_000;
/** Characters at which debounce reaches its max */
const DEBOUNCE_CEIL = 50_000;
/** Minimum gap between end of one compile and start of the next (ms) */
const THROTTLE_GAP = 80;

/**
 * Returns a debounce delay that scales with document size
 *
 * Small docs (< 5k chars) = 100ms\
 * Large docs (50k+) = 500ms
 */
function adaptiveDebounce(charCount) {
    if (charCount <= DEBOUNCE_THRESHOLD) return DEBOUNCE_MIN;
    if (charCount >= DEBOUNCE_CEIL) return DEBOUNCE_MAX;
    const ratio = (charCount - DEBOUNCE_THRESHOLD) / (DEBOUNCE_CEIL - DEBOUNCE_THRESHOLD);
    return Math.round(DEBOUNCE_MIN + ratio * (DEBOUNCE_MAX - DEBOUNCE_MIN));
}

/**
 * Initialises the preview panel
 * Stores opts so that forceCompile() can be called from outside without arguments
 *
 * @param {object} opts
 * @param {() => string}      opts.getSource      Current editor content
 * @param {(cb) => void}      opts.onChange       Called on every editor change
 * @param {HTMLElement}       opts.preview
 * @param {HTMLIFrameElement} opts.frame
 * @param {number}            [opts.debounceMs]   Base debounce (default: adaptive)
 * @param {function}          [opts.onDiagnostics] Monaco marker callback
 * @param {function}          [opts.getCursor]    Returns Monaco cursor position
 * @param {boolean}           [opts.autoFit=true] Fit zoom on first render
 * @param {function}          [opts.onZoomChange] Called after zoom changes
 * @param {function}          [opts.getSourceLength] Returns char count without full serialization
 * @param {function}          [opts.onSuccess]    Called after a successful compile
 * @param {function}          [opts.onError]      Called with (diagnostics, message) on error
 */
export function initPreview(opts) {
    _opts = opts;
    _firstRender = true;
    _frameInitialized = false;
    const { onChange, debounceMs } = opts;

    onChange(() => {
        const autoCompile = document.getElementById('auto-compile');
        if (autoCompile && !autoCompile.checked) return;
        clearTimeout(_debounceTimer);
        // Use explicit debounceMs if provided, otherwise adapt to document size
        // getSourceLength() avoids a full getValue() serialization for the length
        const delay = debounceMs ?? adaptiveDebounce(
            opts.getSourceLength ? opts.getSourceLength() : (_lastSourceLength ?? 0)
        );
        _debounceTimer = setTimeout(scheduleCompile, delay);
    });

    scheduleCompile();
}

/**
 * Schedules an immediate compile, bypassing the debounce
 * Safe to call at any time — deduplicated if a compile is already running
 */
export function forceCompile() {
    scheduleCompile();
}

// ### Module state #############################################################

/** Stored options from initPreview */
let _opts = null;

/** Whether a compile is currently in flight */
let _compileRunning = false;

/**
 * Whether a new compile request arrived while one was in flight\
 * All intermediate requests collapse into a single re-run, only the latest\
 * source is compiled, preventing CPU pile-ups on fast typing
 */
let _pendingRun = false;

/** Whether the first render has happened (for autoFit) */
let _firstRender = true;

/** Cached source length for adaptive debounce (avoids getValue on every keystroke) */
let _lastSourceLength = 0;

/**
 * True once the iframe has been loaded at least once via Blob URL\
 * After that, all subsequent updates go through direct DOM injection\
 * (no frame.src change = no navigation = no scroll reset)\
 * Reset to false when initPreview() is called (project change)\
 */
let _frameInitialized = false;

/** @type {ReturnType<typeof setTimeout>|undefined} */
let _debounceTimer;

/** Timestamp of the last compile completion (for throttle gap) */
let _lastCompileEnd = 0;

// ### Compile scheduler ########################################################

function scheduleCompile() {
    if (_compileRunning) {
        _pendingRun = true;
        return;
    }
    _runCompile();
}

async function _runCompile() {
    if (!_opts) return;

    // Enforce a minimum gap between compiles so Monaco can breathe
    const sinceLast = performance.now() - _lastCompileEnd;
    if (_lastCompileEnd > 0 && sinceLast < THROTTLE_GAP) {
        setTimeout(_runCompile, THROTTLE_GAP - sinceLast);
        return;
    }

    _compileRunning = true;
    _pendingRun = false;
    const { getSource, preview, frame, onDiagnostics, getCursor, autoFit = true, onZoomChange, onSuccess, onError } = _opts;

    // No yield needed: the debounce (100-500ms) already ensures Monaco has processed all keystrokes before we reach here.
    // Adding a requestAnimationFrame+setTimeout here was firing between GTK IME key events (e.g. between Shift keydown and a letter keydown),
    // corrupting WebKitGTK's input method state and causing the first Shift+Letter after a selection to be silently dropped
    const source = getSource();
    _lastSourceLength = source.length;
    try {
        await _doCompile(source, preview, frame, onDiagnostics, getCursor, onSuccess, onError);
        if (_firstRender && autoFit) {
            _firstRender = false;
            fitPreviewToWidth(preview, frame);
            onZoomChange?.();
        }
    } finally {
        _compileRunning = false;
        _lastCompileEnd = performance.now();
        if (_pendingRun) {
            _pendingRun = false;
            // Yield a frame so Monaco can render buffered keystrokes before next compile
            setTimeout(_runCompile, 0);
        }
    }
}

/**
 * Shows an error message in the preview panel
 * @param {HTMLElement} preview
 * @param {HTMLIFrameElement} frame
 * @param {string} message
 */
function showError(preview, frame, message) {
    frame.style.display = 'none';
    preview.querySelector('.error')?.remove();
    const div = document.createElement('div');
    div.className = 'error';
    div.textContent = message;
    preview.appendChild(div);
}

/**
 * Clears any visible error and restores the iframe
 * @param {HTMLElement} preview
 * @param {HTMLIFrameElement} frame
 */
function clearError(preview, frame) {
    preview.querySelector('.error')?.remove();
    frame.style.display = '';
}

/**
 * Compiles `source` and writes the result into `frame`
 * Stale results (superseded by a newer call) are silently dropped
 * @param {string} source
 * @param {HTMLElement} preview
 * @param {HTMLIFrameElement} frame
 */
let previewZoom = 100;
let _lastHtml = '';
let _lastJumpPos = null;
/** Active blob URL for the initial iframe load, revoked on first replace */
let _currentBlobUrl = null;

/** Threshold (bytes) above which first-load Blob creation is delegated to the Web Worker */
const WORKER_BLOB_THRESHOLD = 512_000;

/**
 * Writes compiled HTML into the preview iframe via a Blob URL.
 *
 * The key insight: the flash-to-page-1 bug was caused by resetting
 * `frame.style.height = '100%'` before each navigation. That shrank the iframe
 * from its full content height (e.g. 12 000 px) to the container height (600 px),
 * which made the browser clamp `preview.scrollTop` to 0, the flash.
 *
 * Fix: on reloads, the iframe dimensions are left at their current px values
 * throughout the navigation. The parent container's scrollTop is never touched,
 * so the preview stays exactly where the user was reading.
 *
 * Large payloads use the Web Worker to build the Blob off the main thread.
 *
 * @param {HTMLIFrameElement} frame
 * @param {string} html
 * @returns {Promise<void>} resolves once the new content is rendered
 */
function loadHtml(frame, html) {
    return new Promise(async (resolve) => {
        if (_currentBlobUrl) {
            URL.revokeObjectURL(_currentBlobUrl);
            _currentBlobUrl = null;
        }

        if (html.length > WORKER_BLOB_THRESHOLD) {
            _currentBlobUrl = await createBlobUrlAsync(html);
        } else {
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            _currentBlobUrl = URL.createObjectURL(blob);
        }

        // First load only: start at 100%/100% (no content to preserve)
        // On reloads, intentionally keep the existing px dimensions so the parent container's scrollTop is never clamped while the iframe is navigating to the new content
        if (!_frameInitialized) {
            frame.style.width  = '100%';
            frame.style.height = '100%';
        }

        const onLoad = () => {
            frame.removeEventListener('load', onLoad);
            _frameInitialized = true;
            requestAnimationFrame(() => {
                if (frame.contentDocument?.body) {
                    frame.contentDocument.body.style.zoom = previewZoom / 100;
                    const doc = frame.contentDocument;
                    frame.style.width  = doc.documentElement.scrollWidth  + 'px';
                    frame.style.height = doc.documentElement.scrollHeight + 'px';
                }
                const zoomInput = document.getElementById('zoom-input');
                if (zoomInput) zoomInput.value = previewZoom;
                resolve();
            });
        };
        frame.addEventListener('load', onLoad);
        frame.src = _currentBlobUrl;
    });
}

/**
 * Scrolls `previewContainer` so that the rendered preview position `jumpPos`
 * (returned by the Rust `jump_from_cursor` call) is visible near the top third.
 *
 * @param {HTMLIFrameElement} frame
 * @param {HTMLElement} previewContainer  The scrollable .preview-content div
 * @param {{ page: number, x: number, y: number }} jumpPos  Typst coordinates (pt, 1-based page)
 */
export function scrollToJumpPos(frame, previewContainer, jumpPos) {
    if (!jumpPos || !frame.contentDocument) return;
    const { page, y } = jumpPos;
    const pages = frame.contentDocument.querySelectorAll('.page');
    if (!pages || page < 1 || page > pages.length) return;
    const pageEl = pages[page - 1];
    // Standard CSS pt = px: 1pt = 96/72 CSS px. The zoom scale is applied on top.
    const PX_PER_PT = 96 / 72;
    const scale = previewZoom / 100;
    const yPx = y * PX_PER_PT * scale;
    const scrollTarget = pageEl.offsetTop + yPx - previewContainer.clientHeight * 0.3;
    previewContainer.scrollTop = Math.max(0, scrollTarget);
}

async function _doCompile(source, preview, frame, onDiagnostics, getCursor, onSuccess, onError) {
    const cursor = getCursor?.() ?? null;
    const t0 = performance.now();
    try {
        const result = await invoke('render_preview', {
            source,
            root:   getCurrentProject()?.path ?? null,
            cursor,
        });
        const ipcMs = Math.round(performance.now() - t0);
        const { html, jump_pos: jumpPos, timings } = result;
        _lastHtml = html;
        _lastJumpPos = jumpPos ?? null;
        clearError(preview, frame);
        const tWrite = performance.now();
        await loadHtml(frame, html);
        const writeMs = Math.round(performance.now() - tWrite);
        // Scroll sync: if Rust returned a cursor position, jump to it
        // Otherwise the parent scrollTop was never touched
        if (jumpPos) scrollToJumpPos(frame, preview, jumpPos);
        onDiagnostics?.([]);
        onSuccess?.();
        if (timings) {
            console.log(
                `[Profiling] monde: ${timings.world_ms}ms | compil: ${timings.compile_ms}ms` +
                ` | SVG: ${timings.svg_ms}ms | total Rust: ${timings.total_ms}ms` +
                ` | IPC: ${ipcMs}ms | écriture: ${writeMs}ms`
            );
        }
    } catch (error) {
        const diagnostics = Array.isArray(error) ? error : [];
        onDiagnostics?.(diagnostics);
        const msg = diagnostics.length > 0
            ? diagnostics.map(d => {
                const loc = d.line != null ? ` (ligne ${d.line}, col ${d.column})` : '';
                return `${d.message}${loc}`;
              }).join('\n')
            : String(error);
        showError(preview, frame, msg);
        onError?.(diagnostics, msg);
    }
}

export function zoomPreviewIn()    { setPreviewZoom(previewZoom + 10); }
export function zoomPreviewOut()   { setPreviewZoom(previewZoom - 10); }
export function zoomPreviewReset() { setPreviewZoom(100); }
export function getPreviewZoom() { return previewZoom; }

/**
 * Fits the preview zoom so the page fills the available pane width.
 * Safe to call any time after the first render.
 */
export function fitPreviewToWidth(previewEl, frameEl) {
    const preview = previewEl ?? document.getElementById('preview');
    const frame   = frameEl   ?? document.getElementById('preview-frame');
    if (!frame || !preview || !_lastHtml) return;

    // frame.offsetWidth is the content width at the current previewZoom.
    // Dividing back gives the natural (zoom=100) width in CSS px.
    const contentWidth = frame.offsetWidth;
    if (contentWidth === 0) return;

    const naturalWidth = contentWidth / (previewZoom / 100);
    // Leave a small margin so the page doesn't clip against the scrollbar
    const available = preview.clientWidth - 16;
    if (available <= 0) return;

    setPreviewZoom(Math.floor((available / naturalWidth) * 100));
}

export function setPreviewZoom(value) {
    previewZoom = Math.min(400, Math.max(20, value));
    const frame   = document.getElementById('preview-frame');
    const preview = document.getElementById('preview');
    if (!frame || !preview || !frame.contentDocument?.body) return;
    const savedScroll = preview.scrollTop;
    // Update CSS zoom only
    frame.contentDocument.body.style.zoom = previewZoom / 100;
    frame.style.width  = frame.contentDocument.documentElement.scrollWidth  + 'px';
    frame.style.height = frame.contentDocument.documentElement.scrollHeight + 'px';
    preview.scrollTop = savedScroll;
    if (_lastJumpPos) scrollToJumpPos(frame, preview, _lastJumpPos);
    const zoomInput = document.getElementById('zoom-input');
    if (zoomInput) zoomInput.value = previewZoom;
}
