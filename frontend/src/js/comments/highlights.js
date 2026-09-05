/**
 * highlights.js
 *  Monaco decorations for keytag comments: each matching line gets a
 *  pastel background in its keytag's color.
 *
 *  One CSS class per keytag (`comments-kg-<id>`) is injected into a
 *  `<style>` element; colors are derived from the keytag hex with an alpha
 *  so they sit well on both light and dark themes. Passing a keytag list
 *  re-renders the stylesheet, which is enough for Monaco to repaint.
 */

import * as monaco from 'monaco-editor';

const STYLE_ID = "comments-keytags-styles";
const ALPHA = 0.22;

/** Decoration collections, one per editor. */
const _collections = new WeakMap();

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Renders the keytag CSS classes into the document.
 * @param {Array<{id: string, color: string}>} keytags
 */
export function refreshKeytagStyles(keytags) {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = keytags
    .map(
      (kt) =>
        // Background per keytag…
        `.comments-kg-${kt.id} { background-color: ${hexToRgba(kt.color, ALPHA)}; }` +
        // …and a band hugging the glyphs instead of filling the full row:
        // Monaco sizes each row as 1.35 × fontSize (~19px for a 14px font)
        // and WebKitGTK anchors the glyphs to the TOP of that row (the
        // leading stays below the text). A band centered on the row would
        // therefore leave the text in its upper part. Aligning the band to
        // the top of the row (height ≈ 1.1em = em box + descenders) makes
        // it wrap the text tightly.
        `.monaco-editor .lines-content .cdr.comments-kg-${kt.id} { ` +
        "height: 1.1em; top: 0; border-radius: 2px; }",
    )
    .join("\n");
}

/**
 * Applies (or replaces) the keytag highlight decorations on `editor`.
 * @param {import('monaco-editor').editor.IStandaloneCodeEditor} editor
 * @param {Array<{keytag: {id: string}, line: number}>} entries  From scan.js.
 */
export function applyHighlights(editor, entries) {
  if (!editor || !editor.getModel()) return;

  let collection = _collections.get(editor);
  if (!collection) {
    collection = editor.createDecorationsCollection([]);
    _collections.set(editor, collection);
  }

  const decorations = entries.map((entry) => ({
    range: new monaco.Range(entry.line, 1, entry.line, 1),
    options: {
      isWholeLine: true,
      className: `comments-kg-${entry.keytag.id}`,
    },
  }));
  collection.set(decorations);
}

/** Removes all keytag decorations and the stylesheet. */
export function clearHighlights(editor) {
  const collection = _collections.get(editor);
  collection?.clear();
  document.getElementById(STYLE_ID)?.remove();
}