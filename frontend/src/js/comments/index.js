/**
 * comments/index.js
 *  Comment feature entry point (modular keytag system).
 *
 *  - Scans the editor for keytag comments (`// TODO: …`, …) on change
 *    (debounced) and highlights the matching lines in Monaco.
 *  - Exposes the comment book (modal listing + navigation), the "insert
 *    comment" action and the keytag manager.
 *
 *  Highlight colors come from the keytag registry; any change to the
 *  registry (manager save/reset) re-scans and re-renders the styles.
 */

import { getKeytags, onChange } from './keytags.js';
import { findKeytagComments } from './scan.js';
import { applyHighlights, refreshKeytagStyles } from './highlights.js';

const RESCAN_DEBOUNCE_MS = 200;

/**
 * Wires the comment feature to `editor`.
 * @param {import('monaco-editor').editor.IStandaloneCodeEditor} editor
 */
export function initComments(editor) {
  if (!editor) return;

  let timer = null;

  function rescan() {
    timer = null;
    const model = editor.getModel();
    if (!model) return;
    const entries = findKeytagComments(model.getValue(), getKeytags());
    applyHighlights(editor, entries);
  }

  function scheduleRescan() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(rescan, RESCAN_DEBOUNCE_MS);
  }

  refreshKeytagStyles(getKeytags());
  editor.onDidChangeModelContent(scheduleRescan);
  onChange(() => {
    refreshKeytagStyles(getKeytags());
    rescan();
  });
  rescan();
}

export { openCommentBook, insertComment } from './book.js';
export { openKeytagManager } from './keytag-manager.js';