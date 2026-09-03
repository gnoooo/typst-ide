/**
 * utils/escape.js
 *  Shared HTML / attribute escapers.
 *
 * Use these at every site that builds HTML or attribute strings from
 * dynamic (user-controlled / file-content / DB-content) input. The
 * translation helper `t()` does NOT escape its parameters — escaping
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

/** Attribute-safe escaper. Double-quote is escaped so it can be used inside
 * `attr="..."`. The single-quote escape is included for completeness. */
export function escapeAttr(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;");
}
