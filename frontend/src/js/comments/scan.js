/**
 * scan.js
 *  Matches keytags against comment spans produced by tokens.js
 *  (Monaco-token-aware in the app, regex fallback in tests).
 *
 *  Recognized syntax:
 *    // TODO: message
 *    block comments, single- or multi-line: slash-star KEYTAG: msg star-slash
 *  The keyword must start the comment content (leading whitespace allowed),
 *  and is matched case-insensitively.
 *
 *  Columns are 1-based in UTF-16 code units — exactly Monaco's contract,
 *  and since JS string indices are UTF-16 code units, offsets map 1:1.
 */

/**
 * @param {Array<{line: number, col: number, text: string}>} spans  From tokens.js.
 * @param {Array} keytags   Keytags from the registry (enabled/disabled).
 * @returns {Array<{
 *   keytag: object,       Resolved keytag (with color/label).
 *   message: string,      Text after the keyword (trimmed, may be "").
 *   line: number,         1-based line of the comment marker.
 *   startColumn: number,  1-based column of the comment marker.
 *   messageColumn: number, 1-based column of the first message char.
 *   endColumn: number,    1-based exclusive column of the comment.
 *   text: string          Full comment (markers included).
 * }>}
 */
export function findKeytagComments(spans, keytags) {
  const out = [];
  if (!spans || spans.length === 0 || !keytags) return out;

  const enabled = keytags.filter((kt) => kt.enabled);
  if (enabled.length === 0) return out;

  for (const span of spans) {
    const entry = matchSpan(span, enabled);
    if (entry) out.push(entry);
  }
  return out;
}

/** Marker length of "//" or the block-comment opener (2 UTF-16 units). */
const MARKER_LEN = 2;

/** Comment content: markers stripped, block closing pair dropped. */
function contentOf(span) {
  const s = span.text;
  let end = s.length;
  if (s.startsWith("/*") && s.endsWith("*" + "/")) end -= 2;
  return s.slice(MARKER_LEN, end);
}

/** Tries each enabled keytag against the comment content (first match wins). */
function matchSpan(span, keytags) {
  const content = contentOf(span);
  const trimmed = content.replace(/^\s+/, "");
  const leadingWs = content.length - trimmed.length;
  if (trimmed.length === 0) return null;

  for (const kt of keytags) {
    const kw = kt.keyword;
    if (trimmed.length >= kw.length && trimmed.slice(0, kw.length).toLowerCase() === kw.toLowerCase()) {
      let msg = span.text.slice(MARKER_LEN + leadingWs + kw.length);
      if (msg.endsWith("*" + "/")) msg = msg.slice(0, -2);
      return {
        keytag: kt,
        message: msg.trim(),
        line: span.line,
        startColumn: span.col,
        messageColumn: span.col + MARKER_LEN + leadingWs + kw.length,
        endColumn: span.col + span.text.length,
        text: span.text,
      };
    }
  }
  return null;
}