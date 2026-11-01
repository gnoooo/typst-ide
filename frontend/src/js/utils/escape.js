/**
 * utils/escape.js
 *  Shared HTML / attribute escapers.
 *
 * Use these at every site that builds HTML or attribute strings from
 * dynamic (user-controlled / file-content / DB-content) input. The
 * translation helper `t()` does NOT escape its parameters, escaping
 * is the caller's responsibility so that textContent sinks keep
 * rendering raw text instead of HTML entities.
 */
export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Escape `text` for a Typst string literal: backslash first, then the quote.
export function escapeTypstString(text) {
  return String(text).replace(/[\\"]/g, "\\$&");
}

// Escape `text` for a Typst content block [...]: prefix every char that can
// open or close a different syntax group (# code, [ ] delims, * _ emphasis,
// $ math, ` raw, @ refs, \ escape).
export function escapeTypstContent(text) {
  return String(text).replace(/[#\[\]*_`$@\\]/g, "\\$&");
}
