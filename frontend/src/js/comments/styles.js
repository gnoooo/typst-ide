/**
 * styles.js
 *  Pure style/hover generators for the marker feature — no Monaco, no DOM,
 *  so they are directly unit-testable.
 *
 *  The line band is aligned to the glyphs instead of the full row: Monaco
 *  sizes each row as 1.35 × fontSize (~19px for a 14px font) and WebKitGTK
 *  anchors the glyphs to the TOP of that row, so a center-aligned band
 *  would leave the text in its upper part. `height ≈ 1.1em` + `top: 0`
 *  wraps the text.
 */

/** Alpha of the line band (both themes). */
export const ALPHA = 0.22;

export function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Escapes markdown-significant characters for Monaco hover messages. */
export function escapeMarkdown(text) {
  return String(text).replace(/([*_`[\]\\<>])/g, "\\$1");
}

/**
 * CSS for all keytag styles (line band, gutter dot, bold tag).
 * `refreshKeytagStyles` (highlights.js) injects the result.
 * @param {Array<{id: string, color: string}>} keytags
 * @returns {string}
 */
export function buildKeytagCss(keytags) {
  return keytags
    .flatMap((kt) => [
      `.comments-kg-${kt.id} { background-color: ${hexToRgba(kt.color, ALPHA)}; }`,
      // Band hugging the glyphs (see module doc for the WebKitGTK rationale).
      `.monaco-editor .lines-content .cdr.comments-kg-${kt.id} { ` +
        "height: 1.1em; top: 0; border-radius: 2px; }",
      // Round marker in the glyph margin. Monaco renders the decoration as a
      // flex container sized to the LINE HEIGHT (inline height wins over CSS),
      // so the dot is drawn as a centered ::before pseudo-element: it stays a
      // circle that never overflows the row, whatever the font/line height.
      `.comments-gm-${kt.id}::before { content: ""; width: 0.8em; height: 0.8em; ` +
        `border-radius: 50%; background: ${kt.color}; }`,
      // The keytag part of the line ("// TODO:") rendered in bold.
      `.comments-kw-${kt.id} { font-weight: bold; }`,
    ])
    .join("\n");
}

/** Hover tooltip content for a comment entry (markdown, escaped). */
export function buildHoverMessage(entry) {
  const kw = `**${escapeMarkdown(entry.keytag.keyword)}**`;
  const msg = entry.message ? `\n\n${escapeMarkdown(entry.message)}` : "";
  return { value: kw + msg };
}