/**
 * Monaco Editor wrapper
 *
 * Provides:
 * - `createEditor(container)` -> initialises Monaco and returns the editor instance
 * - `setEditorTheme(theme)`   -> switches between 'dark' and 'light' Monaco themes
 * - `zoomIn()` / `zoomOut()` / `zoomReset()` -> font-size zoom
 */

import * as monaco from 'monaco-editor';
import { readText as tauriReadText } from '@tauri-apps/plugin-clipboard-manager';
import { registerTypstLanguage, getThemeName } from './typst-syntax.js';

const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE     = 8;
const MAX_FONT_SIZE     = 32;
const ZOOM_STEP         = 2;

let _editor      = null;
let _currentSize = parseInt(localStorage.getItem('editor-font-size') ?? DEFAULT_FONT_SIZE, 10);
if (isNaN(_currentSize) || _currentSize < MIN_FONT_SIZE || _currentSize > MAX_FONT_SIZE) {
    _currentSize = DEFAULT_FONT_SIZE;
}

// ## Public API ####################################################

/**
 * Initialises Monaco inside `container` and returns the editor instance
 * @param {HTMLElement} container
 * @returns {Promise<import('monaco-editor').editor.IStandaloneCodeEditor>}
 */
export function createEditor(container) {
  registerTypstLanguage();
  const savedTheme = localStorage.getItem('theme') ?? 'light';
  const savedFamily = localStorage.getItem('editor-font-family');
    _editor = monaco.editor.create(container, {
        value: '',
        language: 'typst',
        theme: getThemeName(savedTheme),
        fontSize: _currentSize,
        fontFamily: savedFamily || "'Fira Code', 'Cascadia Code', 'Courier New', monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        automaticLayout: true,
        lineNumbersMinChars: 4,
        contextmenu: true,
        copyWithSyntaxHighlighting: false,
    });

    // In the AppImage (tauri:// protocol), WebKitGTK denies navigator.clipboard.readText()
    // because the context isn't considered "secure" (not HTTPS/localhost).
    // Without this patch, Monaco would receive a permission error and paste nothing.
    // We bridge to Tauri's native clipboard API so Monaco gets the real clipboard text.
    if (navigator.clipboard) {
        const originalReadText = navigator.clipboard.readText.bind(navigator.clipboard);
        navigator.clipboard.readText = async function() {
            try {
                return await originalReadText();
            } catch {
                if (window.__TAURI__) {
                    try {
                        return await tauriReadText();
                    } catch {
                        return tauriReadText();
                    }
                }
                return '';
            }
        };
    }

    return Promise.resolve(_editor);
}

export function insertImageAtCursor(dataUrl) {
  if (!_editor) return;

  const selection = _editor.getSelection();
  const position = selection ? selection.getStartPosition() : _editor.getModel()?.getFullModelRange().getEndPosition();

  if (!position) return;

  const typstSyntax = `#image("${dataUrl}", width: 100%)`;

  _editor.executeEdits('paste-image', [
    {
      range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
      text: typstSyntax,
    }
  ]);
}

/**
 * Switch Monaco between dark and light themes
 * @param {'dark'|'light'} theme
 */
export function setEditorTheme(theme) {
    if (!_editor) return;
    monaco.editor.setTheme(getThemeName(theme));
}

export function getEditor() {
    return _editor;
}

// ## Font family change #############################################
export function getCurrentFontFamily() {
    return _editor?.getOption(monaco.editor.EditorOption.fontFamily) ?? '';
}

export function setEditorFontFamily(fontFamily) {
    if (!_editor) return;
    _editor.updateOptions({ fontFamily });
    localStorage.setItem('editor-font-family', fontFamily);
}

// ## Zoom controls ##################################################
export function editorZoomIn() {
    if (_currentSize >= MAX_FONT_SIZE) return;
    _currentSize += ZOOM_STEP;
    _applySize();
}

export function editorZoomOut() {
    if (_currentSize <= MIN_FONT_SIZE) return;
    _currentSize -= ZOOM_STEP;
    _applySize();
}

export function editorZoomReset() {
    _currentSize = DEFAULT_FONT_SIZE;
    _applySize();
}

export function getCurrentZoomPct() {
    return Math.round((_currentSize / DEFAULT_FONT_SIZE) * 100);
}

// ## Internal ######################################################

function _applySize() {
    _editor?.updateOptions({ fontSize: _currentSize });
    localStorage.setItem('editor-font-size', String(_currentSize));
    const el = document.getElementById('status-zoom');
    if (el) el.textContent = `${getCurrentZoomPct()}%`;
}

// ## Typst language registration ####################################
// See typst-syntax.js for the highlight rules and colors.
