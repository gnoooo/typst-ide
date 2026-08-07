/**
 * Application entry point
 *  wires all modules together
 */

import "../style.css";

import * as monaco from 'monaco-editor';
window.monaco = monaco;

import { createEditor, setEditorTheme, editorZoomIn, editorZoomOut, editorZoomReset, getCurrentZoomPct, getCurrentFontFamily, setEditorFontFamily, getEditor, insertImageAtCursor } from "./editor.js";
import { initPreview, zoomPreviewIn, zoomPreviewOut, zoomPreviewReset, setPreviewZoom, getPreviewZoom, scrollToJumpPos, fitPreviewToWidth, forceCompile } from "./preview.js";
import { initWebviewZoom, webviewZoomIn, webviewZoomOut, webviewZoomReset } from "./webview-zoom.js";
import {
  initToolbar,
  initTheme,
  writeToConsole,
  showConsole,
  markConsoleErrorUnread,
  clearConsoleErrorUnread,
} from "./toolbar.js";
import { registerShortcuts } from "./shortcuts.js";
import { unsavedBtnUpdate, openProjectBtnUpdate, createNewProject, openProject, exportPDF, scheduleAutosave, notifySaveIndicator, getCurrentProject } from "./project.js";
import { openModal, showPrompt } from "./modal.js";
import { openNotepad } from "./notepad.js";
import { openHistory } from "./history.js";
import { openBibliography } from './bibliography/bibliography.js';
import { updateBtn, toggleBtnIcon, populateStructureDropdown } from "./structures.js";
import { initFileSync } from "./file-sync.js";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";
import { t, initI18n, setLang } from '../i18n/index.js'

async function main() {
  initI18n()

  document.querySelectorAll('.submenu .menu-trigger').forEach(btn => {
    btn.addEventListener('click', (e) => e.stopPropagation())
  })

  document.querySelectorAll('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang))
  })

  if (!window.__TAURI__) {
    document.body.innerHTML =
      `<p style="color:red;padding:1rem">${t('error.tauri_api_unavailable')}</p>`;
    return;
  }

  // ## Bootstrap UI #############################################
  initToolbar();
  await initWebviewZoom();

  // ## Monaco editor #############################################
  const container = document.getElementById("typst-editor");
  const editor = await createEditor(container);
  window.__typstEditor = editor;
  const { invoke } = window.__TAURI__.core;
  const editorDomNode = editor.getDomNode();
  const editorTextarea = editorDomNode?.querySelector("textarea");

  // Image paste support: detect data:image/...;base64,... or binary clipboard images,
  // then store file in project images/
  //
  // Guard against re-entrant execution: onImagePaste is async, so if it were
  // registered on multiple nested nodes (all capture), all handlers would start
  // before any of them calls event.preventDefault(), causing double/triple paste
  // and multiple editor.focus() calls that corrupt Monaco's GTK selection state
  // A single synchronous flag is the reliable fix
  let _pasteInFlight = false;
  const onImagePaste = async (event) => {
    if (_pasteInFlight) return;
    _pasteInFlight = true;
    try {

      console.debug("[paste-image] paste event captured");

      let payload = await extractImagePayload(event);
      if (!payload) {
        console.debug("[paste-image] no web payload, trying native clipboard fallback");
        payload = await readNativeImagePayload();
      }
      if (!payload) {
        console.debug("[paste-image] no image payload found in clipboard");
        // No image, let Monaco handle text paste natively
        // Monaco uses navigator.clipboard.readText() internally, which is patched in editor.js to fall back to Tauri on AppImage/WebKitGTK
        return;
      }

      // console.debug(`[paste-image] image payload detected (${payload.source})`);

      const project = getCurrentProject();
      if (!project?.path) {
        event.preventDefault();
        writeToConsole("error", t('toast.image_paste_no_project'));
        showConsole();
        return;
      }

      try {
        if (payload.preventDefault) event.preventDefault();
        const relativePath = await invoke("save_data_image", {
          projectPath: project.path,
          dataUrl: payload.dataUrl,
        });

        insertImageAtCursor(relativePath);
        writeToConsole("info", t('toast.image_saved', { path: relativePath }));
        // console.info(`[paste-image] saved to ${project.path}/${relativePath}`);
      } catch (error) {
        // console.error("[paste-image] save_data_image failed", error);
        writeToConsole("error", t('toast.image_paste_error', { error: String(error) }));
        showConsole();
      } finally {
        _pasteInFlight = false;
      }

    } finally {
      _pasteInFlight = false;
    }
  };

  // Single capture-phase listener on the document
  document.addEventListener(
    "paste",
    (event) => {
      if (editor.hasTextFocus()) onImagePaste(event);
    },
    true,
  );

  initTheme((theme) => setEditorTheme(theme));

  // ## External file change detection ################################
  initFileSync();

  // Update status-bar zoom on load
  updateZoomPreview();

  // ## Preview ####################################################
  const preview = document.getElementById("preview");
  const frame = document.getElementById("preview-frame");

  initPreview({
    getSource: () => editor.getValue(),
    getSourceLength: () => editor.getModel()?.getValueLength() ?? 0,
    onChange: (cb) => editor.onDidChangeModelContent(cb),
    getCursor: () => editor.getPosition(),
    preview,
    frame,
    onDiagnostics: (diagnostics) => applyMonacoMarkers(editor, diagnostics),
    autoFit: true,
    onZoomChange: updateZoomPreview,
    onSuccess: () => { writeToConsole("success", t('toast.compile_success')); clearConsoleErrorUnread(); },
    onError: (diagnostics, msg) => {
      writeToConsole("error", msg);
      const autoShow = document.getElementById("show-console-on-error")?.checked ?? false;
      const ignored  = isConsoleIgnoredError(diagnostics, msg);
      if (autoShow && !ignored) showConsole();
      else markConsoleErrorUnread();
    },
    onClickRegion: (region) => {
      editor.setPosition({ lineNumber: region.line, column: region.column });
      editor.revealPositionInCenter({ lineNumber: region.line, column: region.column });
      // Defer focus to let the browser finish processing the iframe click
      setTimeout(() => editor.focus(), 0);
    },
  });

  // ## Autosave ###################################################
  // Only mark as unsaved on keystroke, defer getValue() until the debounce fires
  // to avoid blocking the input pipeline with a full-buffer serialization
  editor.onDidChangeModelContent(() => {
    notifySaveIndicator(true);
    scheduleAutosave(() => editor.getValue());
  });

  // ## Shortcuts ##################################################
  registerShortcuts({
    editor,
    onCompile: forceCompile,
    onEditorZoomIn: () => editorZoomIn(),
    onEditorZoomOut: () => editorZoomOut(),
    onEditorZoomReset: () => editorZoomReset(),
    onNewProject: () => createNewProject((content) => editor.setValue(content)),
    onOpenProject: () => openProject((content) => editor.setValue(content)),
    onExportPDF: () => exportPDF(editor.getValue()),
  });

  // ## Toolbar menu actions #######################################
  bindMenuAction("new-project", () => createNewProject((content) => editor.setValue(content)));
  bindMenuAction("open-project", () => openProject((content) => editor.setValue(content)));
  bindMenuAction("action-undo", () => editor.trigger("", "undo", null));
  bindMenuAction("action-redo", () => editor.trigger("", "redo", null));
  bindMenuAction("action-search", () => editor.getAction("actions.find")?.run());
  bindMenuAction("action-replace", () =>editor.getAction("editor.action.startFindReplaceAction")?.run());
  bindMenuAction("action-goto", () => editor.getAction("editor.action.gotoLine")?.run());
  bindMenuAction("action-comment", () => editor.getAction("editor.action.commentLine")?.run());

  bindMenuAction("manage-bibliography", () => openBibliography());
  bindMenuAction("console-ignore-btn", () => openConsoleIgnoreEditor());

  // Zoom buttons in toolbar (zoom the entire WebView)
  bindMenuAction("webview-zoom-in", () => webviewZoomIn());
  bindMenuAction("webview-zoom-out", () => webviewZoomOut());
  bindMenuAction("webview-zoom-reset", () => webviewZoomReset());

  // Zoom buttons in toolbar (zoom the entire editor)
  bindMenuAction("editor-zoom-in", () => editorZoomIn());
  bindMenuAction("editor-zoom-out", () => editorZoomOut());
  bindMenuAction("editor-zoom-reset", () => editorZoomReset());

  // Save project
  bindMenuAction("unsaved-btn", () =>
    createNewProject((content) => editor.setValue(content), editor.getValue()),
  );

  // Open history modal
  bindMenuAction("open-project-btn", () => openHistory());

  // Notepad buttons
  bindMenuAction("open-notepad", () => openNotepad());
  bindMenuAction("notepad-btn", () => openNotepad());

  // File manager buttons
  const openFileManager = () => import('./manage_files/index.js').then((m) => m.openFileManager());
  bindMenuAction("manage-files-btn", () => openFileManager());
  bindMenuAction("manage-project-files", () => openFileManager());

  // Change style of text
  bindMenuAction("bold-btn", () => getEditor().getAction("typst-bold")?.run());
  bindMenuAction("italic-btn", () =>
    getEditor().getAction("typst-italic")?.run(),
  );
  bindMenuAction("underline-btn", () =>
    getEditor().getAction("typst-underline")?.run(),
  );

  // Structure button...
  updateBtn();
  // bindMenuAction("structures-btn", () => toggleBtnIcon()); // géré dans toolbar (partie des dropdowns)
  populateStructureDropdown();

  // Zoom input fields
  bindMenuAction("zoom-preview-in-btn", () => {
    zoomPreviewIn();
    updateZoomPreview();
  });
  bindMenuAction("zoom-preview-out-btn", () => {
    zoomPreviewOut();
    updateZoomPreview();
  });
  bindMenuAction("zoom-preview-reset-btn", () => {
    fitPreviewToWidth(preview, frame);
    updateZoomPreview();
  });

  document.getElementById("zoom-preview-input")?.addEventListener("change", (e) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val)) {
      setPreviewZoom(val);
      updateZoomPreview();
    }
  });

  // Compile button
  document.getElementById("compile-btn")?.addEventListener("click", () => {
    forceCompile();
  });

  // Save PDF button
  document.getElementById("save-btn")?.addEventListener("click", () => {
    savePdf(editor);
  });

  // Auto-compile checkbox
  const autoCompile = document.getElementById("auto-compile");
  if (autoCompile) {
    autoCompile.checked = localStorage.getItem("auto-compile") !== "false";
    autoCompile.addEventListener("change", () => {
      localStorage.setItem("auto-compile", String(autoCompile.checked));
    });
  }

  // Auto-show console on compile error checkbox
  const showConsoleOnError = document.getElementById("show-console-on-error");
  if (showConsoleOnError) {
    showConsoleOnError.checked = localStorage.getItem("show-console-on-error") === "true";
    showConsoleOnError.addEventListener("change", () => {
      localStorage.setItem("show-console-on-error", String(showConsoleOnError.checked));
    });
  }

  // Change editor font family
  document.getElementById("editor-fontfamily-btn")?.addEventListener("click", async () => {
    const { invoke } = window.__TAURI__.core;
    const current = getCurrentFontFamily();
    const newFont = await showPrompt({
      title: t('font.change_title'),
      label: t('font.prompt_label'),
      placeholder: current || t('font.placeholder'),
      validate: async (v) => {
        const exists = await invoke("font_exists", { name: v });
        if (exists) return true;
        const suggestion = await invoke("suggest_font", { name: v });
        if (suggestion) {
          return t('font.not_found_suggestion', { name: v, suggestion });
        }
        return t('font.not_found', { name: v });
      },
    });
    if (newFont !== null) {
      setEditorFontFamily(newFont);
      updateBtn();
    }
  });

  unsavedBtnUpdate();
  openProjectBtnUpdate();
}

// ## Helpers #######################################################
function bindMenuAction(id, fn) {
  document.getElementById(id)?.addEventListener("click", (e) => {
    e.preventDefault();
    fn();
  });
}

// ## Console error ignore list ######################################

const CONSOLE_IGNORE_KEY = "console-ignore-terms";

function getConsoleIgnoreTerms() {
  return (localStorage.getItem(CONSOLE_IGNORE_KEY) ?? "")
    .split("\n")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** True when any ignore term is a substring of an error message */
function isConsoleIgnoredError(diagnostics, msg) {
  const terms = getConsoleIgnoreTerms();
  if (terms.length === 0) return false;
  const haystacks = [String(msg ?? "")];
  for (const d of Array.isArray(diagnostics) ? diagnostics : []) {
    if (d?.message) haystacks.push(String(d.message));
  }
  const lowered = haystacks.join("\n").toLowerCase();
  return terms.some((term) => lowered.includes(term));
}

function openConsoleIgnoreEditor() {
  const textareaId = "console-ignore-textarea-" + Date.now();
  const body = `
    <p class="ide-modal-message">${t("console.ignore_hint")}</p>
    <label class="ide-modal-label" for="${textareaId}">
      ${t("console.ignore_label")}
    </label>
    <textarea
      id="${textareaId}"
      class="ide-modal-textarea"
      placeholder="${t("console.ignore_placeholder")}"
      spellcheck="false"
    ></textarea>
  `;

  const { close, overlay } = openModal({
    title: t("console.ignore_title"),
    body,
    width: "480px",
    buttons: [
      { label: t("modal.cancel"), primary: false, onClick: (c) => c() },
      {
        label: t("modal.confirm"),
        primary: true,
        onClick: (c) => {
          const value = overlay.querySelector(`#${textareaId}`)?.value ?? "";
          localStorage.setItem(
            CONSOLE_IGNORE_KEY,
            value
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
              .join("\n"),
          );
          c();
        },
      },
    ],
  });

  const textarea = overlay.querySelector(`#${textareaId}`);
  if (textarea) {
    textarea.value = getConsoleIgnoreTerms().join("\n");
    textarea.focus();
  }
}

function updateZoomPreview() {
  const zoomEl = document.getElementById("zoom-preview-input");
  if (zoomEl) zoomEl.value = getPreviewZoom();
}

function extractDataImageUrl(event) {
  const clipboard = event.clipboardData;
  if (!clipboard) return null;

  const dataImageRegex = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/i;

  const text = clipboard.getData("text/plain") ?? "";
  const textMatch = text.match(dataImageRegex);
  if (textMatch) return textMatch[0].replace(/\s+/g, "");

  const html = clipboard.getData("text/html") ?? "";
  const htmlMatch = html.match(dataImageRegex);
  if (htmlMatch) return htmlMatch[0].replace(/\s+/g, "");

  return null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

async function extractImagePayload(event) {
  const clipboard = event.clipboardData;
  if (!clipboard) return null;

  const fromTextOrHtml = extractDataImageUrl(event);
  if (fromTextOrHtml) {
    return { dataUrl: fromTextOrHtml, source: "text/html", preventDefault: true };
  }

  const items = clipboard.items;
  if (items?.length) {
    for (const item of items) {
      if (item.type?.startsWith("image/")) {
        const blob = item.getAsFile();
        if (!blob) continue;
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl.startsWith("data:image/")) {
          return { dataUrl, source: "clipboard item", preventDefault: true };
        }
      }
    }
  }

  const files = clipboard.files;
  if (files?.length) {
    for (const file of files) {
      if (!file.type?.startsWith("image/")) continue;
      const dataUrl = await blobToDataUrl(file);
      if (dataUrl.startsWith("data:image/")) {
        return { dataUrl, source: "clipboard file", preventDefault: true };
      }
    }
  }

  return null;
}

async function readNativeImagePayload() {
  try {
    const img = await readImage();
    if (!img) return null;

    const [{ width, height }, rgba] = await Promise.all([img.size(), img.rgba()]);
    if (!width || !height || !rgba) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
    ctx.putImageData(imageData, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");

    if (!dataUrl.startsWith("data:image/")) return null;
    return { dataUrl, source: "native clipboard", preventDefault: true };
  } catch (error) {
    const msg = String(error?.message ?? error ?? "");
    const expected = msg.includes("requested format") || msg.includes("clipboard is empty");
    if (expected) {
      console.debug("[paste-image] native fallback: no image format available");
    } else {
      console.warn("[paste-image] native fallback failed", error);
    }
    return null;
  }
}

// Sets Monaco editor markers (squiggly underlines) from Typst DiagnosticInfo[]
function applyMonacoMarkers(editor, diagnostics) {
  const model = editor.getModel();
  if (!model) return;
  const markers = diagnostics.map((d) => ({
    severity:
      d.severity === "error"
        ? monaco.MarkerSeverity.Error
        : monaco.MarkerSeverity.Warning,
    message: d.hints?.length
      ? `${d.message}\nHint: ${d.hints.join("\n")}`
      : d.message,
    startLineNumber: d.line ?? 1,
    startColumn: d.column ?? 1,
    endLineNumber: d.end_line ?? d.line ?? 1,
    endColumn: d.end_column ?? (d.column != null ? d.column + 1 : 2),
  }));
    monaco.editor.setModelMarkers(model, "typst", markers);
}

// Export current source to PDF, asking for a path on first save
async function savePdf(editor) {
  const { invoke } = window.__TAURI__.core;
  try {
    let path = sessionStorage.getItem("pdf-export-path");
    if (!path) {
      path = await invoke("pick_pdf_path");
      if (!path) return; // user cancelled
      sessionStorage.setItem("pdf-export-path", path);
    }
    await invoke("export_pdf", {
      source: editor.getValue(),
      path,
      root: getCurrentProject()?.path ?? null,
    });
    writeToConsole("success", t('project.pdf_exported', { path }));
  } catch (err) {
    writeToConsole("error", String(err));
    showConsole();
  }
}

main();

// ## Debug helpers (dev only) ####################################
// window.__debug = { getCurrentProject };
