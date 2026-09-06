/**
 * highlights.js
 *  Monaco decorations for keytag comments:
 *    - a pastel band across the line, in the keytag color;
 *    - a round marker in the glyph margin (gutter) with the keytag color;
 *    - a stripe in the overview ruler (scrollbar track);
 *    - a hover tooltip showing the keytag keyword and the comment message.
 *
 *  One CSS class per keytag is injected into a `<style>` element. The band
 *  is aligned to the glyphs instead of the full row: Monaco sizes each row
 *  as 1.35 × fontSize (~19px for a 14px font) and WebKitGTK anchors the
 *  glyphs to the TOP of that row, so a center-aligned band would leave the
 *  text in its upper part. `height ≈ 1.1em` + `top: 0` wraps the text.
 */

import * as monaco from 'monaco-editor';
import { ALPHA, buildKeytagCss, buildHoverMessage, hexToRgba } from './styles.js';

const STYLE_ID = "comments-keytags-styles";

/** Decoration collections, one per editor. */
const _collections = new WeakMap();

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
  style.textContent = buildKeytagCss(keytags);
}

/**
 * Applies (or replaces) the keytag highlight decorations on `editor`.
 * @param {import('monaco-editor').editor.IStandaloneCodeEditor} editor
 * @param {Array<{keytag: {id: string, color: string}, line: number, message: string}>} entries  From scan.js.
 */
export function applyHighlights(editor, entries) {
  if (!editor || !editor.getModel()) return;

  let collection = _collections.get(editor);
  if (!collection) {
    collection = editor.createDecorationsCollection([]);
    _collections.set(editor, collection);
  }

  const decorations = [];
  for (const entry of entries) {
    // Whole-line band + gutter marker + ruler stripe + hover tooltip.
    decorations.push({
      range: new monaco.Range(entry.line, 1, entry.line, 1),
      options: {
        isWholeLine: true,
        className: `comments-kg-${entry.keytag.id}`,
        glyphMarginClassName: `comments-gm-${entry.keytag.id}`,
        overviewRuler: {
          color: hexToRgba(entry.keytag.color, 0.5),
          darkColor: hexToRgba(entry.keytag.color, 0.5),
          position: monaco.editor.OverviewRulerLane.Right,
        },
        hoverMessage: buildHoverMessage(entry),
      },
    });
    // Bold the keytag part of the comment ("// TODO:" up to the message).
    const kwEnd = entry.messageColumn - 1;
    if (kwEnd > entry.startColumn) {
      decorations.push({
        range: new monaco.Range(entry.line, entry.startColumn, entry.line, kwEnd),
        options: { inlineClassName: `comments-kw-${entry.keytag.id}` },
      });
    }
  }
  collection.set(decorations);
}

/** Removes all keytag decorations and the stylesheet. */
export function clearHighlights(editor) {
  const collection = _collections.get(editor);
  collection?.clear();
  document.getElementById(STYLE_ID)?.remove();
}