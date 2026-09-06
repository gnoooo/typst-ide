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
import { commentSpansFromBuffer } from './tokens.js';
import { applyHighlights, clearHighlights, refreshKeytagStyles } from './highlights.js';

const RESCAN_DEBOUNCE_MS = 200;

/**
 * Scans an editor model for keytag comments, using Monaco tokenization
 * (context-aware: no false positives on `//` inside strings/URLs, and
 * multi-line block comments supported).
 */
export function getCommentEntries(model) {
  if (!model) return [];
  const text = model.getValue();
  return findKeytagComments(commentSpansFromBuffer(text), getKeytags());
}

/**
 * Wires the comment feature to `editor`.
 *
 * Lifecycle: decorations follow the editor. When the model is replaced
 * (`onDidChangeModel`, e.g. switching files via setModel) the old
 * decorations are purged and the new model is scanned; when the editor is
 * disposed, everything (decorations, stylesheet, listeners) is cleaned up.
 *
 * @param {import('monaco-editor').editor.IStandaloneCodeEditor} editor
 */
export function initComments(editor) {
  if (!editor) return;

  let timer = null;

  function rescan() {
    timer = null;
    applyHighlights(editor, getCommentEntries(editor.getModel()));
  }

  function scheduleRescan() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(rescan, RESCAN_DEBOUNCE_MS);
  }

  function dispose() {
    if (timer) clearTimeout(timer);
    timer = null;
    clearHighlights(editor);
    unsubKeytags();
    contentSub.dispose();
    modelSub.dispose();
    disposeSub.dispose();
  }

  refreshKeytagStyles(getKeytags());
  const unsubKeytags = onChange(() => {
    refreshKeytagStyles(getKeytags());
    rescan();
  });
  const contentSub = editor.onDidChangeModelContent(scheduleRescan);
  const modelSub = editor.onDidChangeModel(() => {
    // A new model invalidates the previous decorations (they were tied to
    // the old one): purge and rescan the new content.
    clearHighlights(editor);
    rescan();
  });
  const disposeSub = editor.onDidDispose(dispose);

  rescan();
}

export { openCommentBook, insertComment } from './book.js';
export { openKeytagManager } from './keytag-manager.js';