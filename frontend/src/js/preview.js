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

// ### Preview CSS (injected into the iframe on first load) #####################

const _PREVIEW_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
html { overflow-y: auto; }
body {
  background: #d8d8d8;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.5rem;
  gap: 1.5rem;
}
.page {
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.page svg { display: block; cursor: pointer; }
`;

/**
 * Builds a full preview HTML document from an array of RenderedPage objects.
 * Used for the initial iframe load only.
 * @param {Array<{svg: string, hash: string}>} pages
 * @returns {string}
 */
function _buildPreviewHtml(pages) {
    const body = pages.map(p => `<div class="page">${p.svg}\n</div>`).join('\n');
    return `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <style>${_PREVIEW_CSS}</style>\n</head>\n<body>\n${body}\n</body>\n</html>`;
}

/** Max time spent writing SVG innerHTML before yielding to the event loop (ms). */
const DOM_WRITE_BUDGET_MS = 8;

/** Resolves on the next macrotask. Lets the event loop process input (Monaco
 * keystrokes share this thread) between chunks of preview DOM work. */
function _yieldToEventLoop() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Applies an incremental DOM update to the preview iframe.
 * Only updates `<div class="page">` elements whose hash has changed.
 * Adds or removes page divs as needed when the page count changes.
 *
 * The update is chunked: after every ~8ms of synchronous DOM work the event
 * loop gets a chance to run, so keyboard input is processed between pages
 * instead of freezing for the whole update (large documents have hundreds
 * of KB of SVG markup per page).
 *
 * @param {HTMLIFrameElement} frame
 * @param {Array<{svg: string, hash: string}>} pages
 * @returns {Promise<void>}
 */
async function _applyIncrementalUpdate(frame, pages) {
    const doc = frame.contentDocument;
    if (!doc?.body) return;

    // Generation guard: if a new project was loaded while this chunked update
    // was yielding, abort and let the new preview take over.
    const generation = _frameGeneration;

    const existingDivs = Array.from(doc.querySelectorAll('.page'));
    let lastYield = performance.now();

    for (let i = 0; i < pages.length; i++) {
        if (generation !== _frameGeneration) return;
        const { svg, hash } = pages[i];
        if (i < existingDivs.length) {
            // Update only if the page content changed
            if (hash !== _pageHashes[i]) {
                existingDivs[i].innerHTML = svg + '\n';
            }
        } else {
            // New page (document grew)
            const div = doc.createElement('div');
            div.className = 'page';
            div.innerHTML = svg + '\n';
            doc.body.appendChild(div);
        }
        const now = performance.now();
        if (now - lastYield > DOM_WRITE_BUDGET_MS) {
            await _yieldToEventLoop();
            lastYield = performance.now();
            if (generation !== _frameGeneration) return;
        }
    }
    // Remove pages that no longer exist (document shrank)
    for (let i = pages.length; i < existingDivs.length; i++) {
        existingDivs[i].remove();
    }

    _pageHashes = pages.map(p => p.hash);
}

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
            if (e.data?.type === 'blobReady') {
                const cb = _blobCallbacks.get(e.data.id);
                if (cb) {
                    _blobCallbacks.delete(e.data.id);
                    cb(e.data.url);
                }
            } else if (e.data?.type === 'blobError') {
                const cb = _blobCallbacks.get(e.data.id);
                if (cb) {
                    _blobCallbacks.delete(e.data.id);
                    cb.__reject(new Error(e.data.error || 'Preview worker failed'));
                }
            }
        };
        _blobWorker.onerror = (e) => {
            // If the worker script itself fails to load (network, syntax),
            // every pending callback needs to reject or the scheduler
            // will hang forever waiting for `blobReady`.
            const err = new Error('Preview worker crashed: ' + (e.message || 'unknown'));
            _blobCallbacks.forEach((cb) => cb.__reject(err));
            _blobCallbacks.clear();
        };
    }
    return _blobWorker;
}

/**
 * Creates a Blob URL from HTML in a Web Worker, off the main thread.
 * Resolves with the URL or rejects if the worker reported an error.
 * @param {string} html
 * @returns {Promise<string>} blob URL
 */
function createBlobUrlAsync(html) {
    return new Promise((resolve, reject) => {
        const id = ++_blobIdCounter;
        // The worker uses `cb(url)` to resolve; we tag a `__reject` fn on
        // the same callback object so `onerror` / `blobError` can reject.
        const cb = (url) => resolve(url);
        cb.__reject = reject;
        _blobCallbacks.set(id, cb);
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
/** Minimum gap between end of one compile and start of the next (ms, small docs) */
const THROTTLE_GAP_MIN = 100;
/** Maximum gap between end of one compile and start of the next (ms, large docs) */
const THROTTLE_GAP_MAX = 400;

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
 * Returns a compile-to-compile throttle gap that scales with document size.
 *
 * On large documents each compile cycle (compile + IPC + DOM write) is heavy;
 * a longer gap lets the webview stay responsive while typing continuously.
 * Small docs keep the short gap so the preview stays snappy.
 */
function adaptiveThrottleGap(charCount) {
    if (charCount <= DEBOUNCE_THRESHOLD) return THROTTLE_GAP_MIN;
    if (charCount >= DEBOUNCE_CEIL) return THROTTLE_GAP_MAX;
    const ratio = (charCount - DEBOUNCE_THRESHOLD) / (DEBOUNCE_CEIL - DEBOUNCE_THRESHOLD);
    return Math.round(THROTTLE_GAP_MIN + ratio * (THROTTLE_GAP_MAX - THROTTLE_GAP_MIN));
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
 * @param {function}          [opts.onClickRegion] Called with ({ line, column }) when user clicks a text region
 */
export function initPreview(opts) {
    _opts = opts;
    _firstRender = true;
    _frameInitialized = false;
    _clickHandlerSetup = false;
    _pageHashes = [];
    _frameGeneration++;
    // Reset the scheduler flags too: if a previous `_runCompile` ever
    // got stuck (e.g. `loadHtml` hung because the Blob worker failed),
    // `_compileRunning` would stay `true` forever and block all future
    // compiles. Since `initPreview` is the only place that re-arms the
    // scheduler, doing it here fully resets the state.
    _compileRunning = false;
    _pendingRun = false;
    _debounceTimer = undefined;
    _lastCompileEnd = 0;
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

    // Auto-fit preview zoom to pane width when the pane is resized.
    // A debounce prevents loops when zoom changes slightly affect the pane width.
    // A 20px threshold filters out scrollbar-width changes (~15px) from zoom-induced scrollbar toggling.
    if (window.ResizeObserver) {
        let fitTimer;
        let lastFitWidth = 0;
        const fitObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect?.width;
            if (width && Math.abs(width - lastFitWidth) < 20) return;
            lastFitWidth = width;
            clearTimeout(fitTimer);
            fitTimer = setTimeout(() => {
                if (_frameInitialized) {
                    fitPreviewToWidth(opts.preview, opts.frame);
                    opts.onZoomChange?.();
                }
            }, 300);
        });
        fitObserver.observe(opts.preview);
    }
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

    // If a compile is already in flight, coalesce into a single pending
    // run. The throttled `_runCompile` reschedules itself via
    // `setTimeout` (in the throttle branch and in the `finally` below)
    // without ever checking whether a compile is running, so without this
    // gate two calls could end up running `_doCompile` concurrently.
    if (_compileRunning) {
        _pendingRun = true;
        return;
    }

    // Enforce a minimum gap between compiles so Monaco can breathe
    const gap = adaptiveThrottleGap(_lastSourceLength ?? 0);
    const sinceLast = performance.now() - _lastCompileEnd;
    if (_lastCompileEnd > 0 && sinceLast < gap) {
        setTimeout(_runCompile, gap - sinceLast);
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
/** Page hashes from the last successful compile, used for incremental DOM updates */
let _pageHashes = [];

/**
 * Bumped on every initPreview() (project change). Chunked DOM updates capture
 * it at start and abort early if it changed while they were yielding, so stale
 * writes from a previous project never touch the new preview's contentDocument.
 */
let _frameGeneration = 0;

/** Threshold (bytes) above which first-load Blob creation is delegated to the Web Worker */
const WORKER_BLOB_THRESHOLD = 512_000;

/** Whether the click-to-source handler has been set up on the iframe contentDocument */
let _clickHandlerSetup = false;

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
async function loadHtml(frame, html) {
    if (_currentBlobUrl) {
        URL.revokeObjectURL(_currentBlobUrl);
        _currentBlobUrl = null;
    }

    try {
        if (html.length > WORKER_BLOB_THRESHOLD) {
            _currentBlobUrl = await createBlobUrlAsync(html);
        } else {
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            _currentBlobUrl = URL.createObjectURL(blob);
        }
    } catch (err) {
        // The previous `new Promise(async (resolve) => …)` swallowed
        // async rejections and left this Promise pending forever. Now
        // a real rejection (e.g. Blob/worker failure) propagates and
        // `_doCompile` can surface the error instead of hanging the
        // scheduler.
        throw err;
    }

    // First load only: start at 100%/100% (no content to preserve)
    // On reloads, intentionally keep the existing px dimensions so the parent container's scrollTop is never clamped while the iframe is navigating to the new content
    if (!_frameInitialized) {
        frame.style.width  = '100%';
        frame.style.height = '100%';
    }

    return new Promise((resolve, reject) => {
        const onLoad = () => {
            frame.removeEventListener('load', onLoad);
            frame.removeEventListener('error', onError);
            _frameInitialized = true;
            requestAnimationFrame(() => {
                if (frame.contentDocument?.body) {
                    frame.contentDocument.body.style.zoom = previewZoom / 100;
                    const parent = frame.parentElement;
                    if (parent) frame.style.height = parent.clientHeight + 'px';
                    frame.style.overflow = 'hidden auto';
                    frame.style.width  = '';
                }
                // The previous code read `#zoom-input` here, but the
                // actual id in the DOM is `zoom-preview-input`
                // (see index.html). The lookup silently no-op'd; use the
                // correct id now so the zoom field reflects the rendered
                // zoom on first load.
                const zoomInput = document.getElementById('zoom-preview-input');
                if (zoomInput) zoomInput.value = previewZoom;
                resolve();
            });
        };
        const onError = () => {
            frame.removeEventListener('load', onLoad);
            frame.removeEventListener('error', onError);
            reject(new Error('iframe failed to load preview content'));
        };
        frame.addEventListener('load', onLoad);
        frame.addEventListener('error', onError);
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
    if (!pages || page < 1 || page > pages.length) {
        console.debug(`[scroll] page ${page} out of range`);
        return;
    }
    const pageEl = pages[page - 1];
    const PX_PER_PT = 96 / 72;
    const scale = previewZoom / 100;
    const yPx = y * PX_PER_PT * scale;
    const docEl = frame.contentDocument.documentElement;
    // offsetTop est en coordonnées LAYOUT (non zoomées), mais scrollTop
    // est dans le système du viewport qui tient compte du zoom CSS sur <body>.
    // Formule vérifiée : rect.top = offsetTop × scale − scrollTop.
    const target = pageEl.offsetTop * scale + yPx - previewContainer.clientHeight * 0.3;
    console.debug(
        `[scroll] page=${page} y=${y.toFixed(1)}pt ` +
        `offsetTop=${pageEl.offsetTop} yPx=${yPx.toFixed(1)} ` +
        `clientH=${previewContainer.clientHeight} ` +
        `docEl.scrollTop=${docEl.scrollTop} target=${target.toFixed(0)}`
    );
    docEl.scrollTop = Math.max(0, target);

    // Vérification fiable : après paint, rect.top devrait être ~0 si le scroll est correct
    requestAnimationFrame(() => {
        const d = frame.contentDocument;
        const rect = pageEl.getBoundingClientRect();
        console.debug(
            `[scroll-verify] rect.top=${rect.top.toFixed(0)} ` +
            `body.scrollTop=${d.body.scrollTop} ` +
            `html.scrollTop=${d.documentElement.scrollTop} ` +
            `html.scrollHeight=${d.documentElement.scrollHeight} ` +
            `scrollH=${d.documentElement.scrollHeight} ` +
            `clientH=${d.documentElement.clientHeight}`
        );
    });
}

/**
 * Sets up a click handler on the iframe contentDocument that maps click positions
 * to source cursor positions via the typst-ide `jump_from_click` function.
 * @param {HTMLIFrameElement} frame
 */
function setupClickHandler(frame) {
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.addEventListener('click', (event) => {
        // Prevent the iframe from claiming focus away from the parent editor.
        event.preventDefault();

        const svg = event.target.closest('svg');
        if (!svg) return;
        const pageDiv = svg.closest('.page');
        if (!pageDiv) return;
        const pages = doc.querySelectorAll('.page');
        const pageIndex = Array.from(pages).indexOf(pageDiv);
        if (pageIndex < 0) return;

        const rect = svg.getBoundingClientRect();
        const viewBox = svg.getAttribute('viewBox');
        if (!viewBox) return;
        const parts = viewBox.trim().split(/\s+/).map(Number);
        if (parts.length !== 4) return;
        const [, , vbW, vbH] = parts;

        const x = ((event.clientX - rect.left) / rect.width) * vbW;
        const y = ((event.clientY - rect.top) / rect.height) * vbH;

        const page = pageIndex + 1;
        const source = _opts.getSource();
        const root = getCurrentProject()?.path ?? null;

        console.debug(`[click] page=${page} x=${x.toFixed(1)} y=${y.toFixed(1)}`);
        // Defer so the browser finishes processing the iframe click before we
        // send the IPC and potentially move focus to the parent editor.
        setTimeout(async () => {
            try {
                const result = await invoke('resolve_preview_click', {
                    source,
                    root,
                    page,
                    x,
                    y,
                });
                console.debug('[click] result:', result);
                if (result) {
                    _opts.onClickRegion?.(result);
                }
            } catch (_) {
                console.warn('[click] resolve_preview_click threw', _);
            }
        }, 0);
    });
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
        const { pages, jump_pos: jumpPos, timings } = result;
        _lastJumpPos = jumpPos ?? null;
        console.debug('[compile] jumpPos:', jumpPos);
        clearError(preview, frame);

        const tWrite = performance.now();
        if (_frameInitialized && frame.contentDocument?.body) {
            // ## Incremental update ##########################################
            // Only touch page divs whose hash has changed.
            // No iframe navigation → no full SVG re-parse → much faster for
            // large documents where only a few pages actually changed.
            // Chunked: yields between pages so keystrokes are processed during
            // the write instead of freezing the UI for the whole update.
            await _applyIncrementalUpdate(frame, pages);
            // Resize the iframe shell to fit potentially new content height.
            // Must happen before scrollToJumpPos so the parent container's
            // scroll range reflects the new content height; otherwise the
            // scrollTop is clamped to the stale range and the preview appears
            // to jump to the end of the document.
            requestAnimationFrame(() => {
                const doc = frame.contentDocument;
                const beforeHeight = frame.style.height;
                const scrollH = doc.documentElement.scrollHeight;
                const beforeScroll = preview.scrollTop;
                const beforeClientH = preview.clientHeight;
                // Make iframe fit container height so it scrolls internally
                frame.style.height = beforeClientH + 'px';
                frame.style.overflow = 'hidden auto';
                if (jumpPos) scrollToJumpPos(frame, preview, jumpPos);
                console.debug(
                    `[rAF] beforeHeight=${beforeHeight} frameH=${frame.clientHeight} ` +
                    `scrollH=${scrollH} docEl.scrollTop=${doc.documentElement.scrollTop}`
                );
            });
        } else {
            // ## First load ##################################################
            // Assemble full HTML from page array and load via Blob URL.
            const html = _buildPreviewHtml(pages);
            _lastHtml = html;
            _pageHashes = pages.map(p => p.hash);
            await loadHtml(frame, html);
            if (jumpPos) scrollToJumpPos(frame, preview, jumpPos);
        }
        if (!_clickHandlerSetup && frame.contentDocument) {
            setupClickHandler(frame);
            _clickHandlerSetup = true;
        }
        const writeMs = Math.round(performance.now() - tWrite);
        onDiagnostics?.([]);
        onSuccess?.();
        // Profiling is gated behind a localStorage flag (default off) so
        // successful compiles stay silent in the console. Set
        // `preview-debug=true` in localStorage to enable.
        if (timings && typeof localStorage !== 'undefined' && localStorage.getItem('preview-debug') === 'true') {
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
    if (!frame || !preview || !_frameInitialized) return;

    // Measure the first page's rendered width inside the iframe.
    // This is the actual content width at the current zoom level.
    const firstPage = frame.contentDocument?.querySelector?.('.page');
    if (!firstPage) return;
    const pageWidth = firstPage.getBoundingClientRect().width;
    if (pageWidth === 0) return;

    // Divide by current zoom to get the natural (unzoomed) page width.
    const naturalWidth = pageWidth / (previewZoom / 100);
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
    frame.contentDocument.body.style.zoom = previewZoom / 100;
    frame.style.height = preview.clientHeight + 'px';
    frame.style.overflow = 'hidden auto';
    if (_lastJumpPos) scrollToJumpPos(frame, preview, _lastJumpPos);
}
