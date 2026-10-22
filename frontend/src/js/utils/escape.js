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
