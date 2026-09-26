/**
 * preview-window.js
 *  Entry point for the dedicated preview window (`preview.html`).
 *
 *  This window has no editor: it listens for `preview:update` events emitted by
 *  the main window and renders the compiled pages into its own iframe (shared
 *  render functions from `preview.js`). Its toolbar reuses the *exact* classes
 *  and ids of the main editor toolbar (zoom cluster + compile + save), and the
 *  same persisted webview zoom, so everything looks identical. Compile and save
 *  are forwarded to the main window as events. Closing the window (X or the
 *  "re-embed" button) is what restores the split layout in the main window.
 */

import "../style.css";

import { initI18n } from "../i18n/index.js";
import { initWebviewZoom } from "./webview-zoom.js";
import {
  renderUpdate,
  showPreviewError,
  fitPreviewToWidth,
  setPreviewZoom,
  getPreviewZoom,
  zoomPreviewIn,
  zoomPreviewOut,
} from "./preview.js";

async function main() {
  // Follow the editor theme for the window chrome.
  document.documentElement.setAttribute(
    "data-theme",
    localStorage.getItem("theme") || "light",
  );
  initI18n();

  // Apply the same persisted webview zoom as the main window so the toolbar
  // buttons have the exact same size on screen.
  try {
    await initWebviewZoom();
  } catch (_) {
    // Zoom is cosmetic; ignore failures.
  }

  const preview = document.querySelector(".preview-content-wrapper");
  const frame = document.getElementById("preview-wide-frame");
  const zoomInput = document.getElementById("zoom-preview-input");

  function syncZoomInput() {
    if (zoomInput) zoomInput.value = getPreviewZoom();
  }

  // Fit-to-width when the window/content is resized (same debounce + 20px
  // threshold pattern as the embedded panel).
  if (window.ResizeObserver) {
    let fitTimer = undefined;
    let lastFitWidth = 0;
    const fitObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      const width = entry?.contentBoxSize?.[0]?.inlineSize ?? entry?.contentRect?.width;
      if (width && Math.abs(width - lastFitWidth) < 20) return;
      lastFitWidth = width;
      clearTimeout(fitTimer);
      fitTimer = setTimeout(() => {
        fitPreviewToWidth(preview, frame);
        syncZoomInput();
      }, 300);
    });
    fitObserver.observe(preview);
  }

  // Zoom controls (same ids/classes as the main toolbar).
  document.getElementById("zoom-preview-out-btn")?.addEventListener("click", () => {
    zoomPreviewOut(frame, preview);
    syncZoomInput();
  });
  document.getElementById("zoom-preview-in-btn")?.addEventListener("click", () => {
    zoomPreviewIn(frame, preview);
    syncZoomInput();
  });
  zoomInput?.addEventListener("change", () => {
    const value = parseInt(zoomInput.value, 10);
    if (Number.isFinite(value)) {
      setPreviewZoom(value, frame, preview);
    }
  });

  // Compile / save are owned by the main window (it holds the editor); ask it
  // to perform the same actions as its own toolbar buttons.
  document.getElementById("preview-window-compile")?.addEventListener("click", () => {
    window.__TAURI__.event.emit("preview:request-compile", {});
  });
  document.getElementById("preview-window-save")?.addEventListener("click", () => {
    window.__TAURI__.event.emit("preview:request-save-pdf", {});
  });

  // Re-embed: closing the window is what tells the main window to restore the
  // split layout (Rust watches the window destruction).
  document.getElementById("preview-window-embed")?.addEventListener("click", () => {
    window.__TAURI__.window.getCurrentWindow().close();
  });

  (async () => {
    await window.__TAURI__.event.listen("preview:update", (event) => {
      const { pages = [], jumpPos = null, hasError = false, message = "" } =
        event.payload ?? {};
      if (hasError) {
        showPreviewError(preview, frame, message);
        return;
      }
      renderUpdate(frame, preview, pages, {
        jumpPos,
        autoFit: true,
        onZoomChange: syncZoomInput,
        onClickRegion: (page, x, y) => {
          window.__TAURI__.event.emit("preview:click", { page, x, y });
        },
      });
    });
    // Only announce readiness once the listener above is registered, so the
    // main window's forced recompile cannot be lost.
    await window.__TAURI__.event.emit("preview:ready", {});
  })();
}

main();