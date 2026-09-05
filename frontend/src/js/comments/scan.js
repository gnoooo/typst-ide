/**
 * scan.js
 *  Pure scanner that finds keytag comments in a Typst source string.
 *  No DOM, no Monaco, no storage — fully unit-testable.
 *
 *  Recognized syntax (v1, single-line):
 *    // TODO: message
 *    block comments: slash-star KEYTAG: message star-slash (same line)
 *  The keyword must start the comment content (leading whitespace allowed)
 *  and is matched case-insensitively. Multi-line block comments and string
 *  literals are NOT distinguished (a `//` inside a string is seen as a
 *  comment) — documented limitation, matching most of the same trade-offs as
 *  the Monarch tokenizer.
 *
 *  Columns are 1-based in UTF-16 code units — exactly Monaco's contract,
 *  and since JS string indices are UTF-16 code units, offsets map 1:1.
 */

/**
 * Extracts keytag comments from `text`.
 * @param {string} text           Editor content.
 * @param {Array}  keytags        Keytags from the registry (enabled/disabled).
 * @returns {Array<{
 *   keytag: object,              Resolved keytag (with color/label).
 *   message: string,             Text after the keyword (trimmed, may be "").
 *   line: number,                1-based line.
 *   startColumn: number,         1-based column of the comment marker.
 *   messageColumn: number,       1-based column of the first message char.
 *   endColumn: number,           1-based exclusive column of the comment.
 *   text: string                 Whole source line.
 * }>}
 */
export function findKeytagComments(text, keytags) {
  const out = [];
  if (!text || keytags.length === 0) return out;

  const enabled = keytags.filter((kt) => kt.enabled);
  if (enabled.length === 0) return out;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    scanLine(lines[i], i, enabled, out);
  }
  return out;
}

/** The closing marker of a block comment, split so it survives doc comments. */
const BLOCK_CLOSE = "*" + "/";

function scanLine(line, lineIdx, keytags, out) {
  const slashIdx = line.indexOf("//");
  const blockIdx = line.indexOf("/*");

  let start;
  let kind; // "//" | "/*"
  if (slashIdx !== -1 && (blockIdx === -1 || slashIdx < blockIdx)) {
    start = slashIdx;
    kind = "//";
  } else if (blockIdx !== -1) {
    start = blockIdx;
    kind = "/*";
  } else {
    return;
  }

  const contentStart = start + 2;
  let contentEnd;
  if (kind === "//") {
    contentEnd = line.length;
  } else {
    // Single-line block comment only. A multi-line opener is ignored.
    const close = line.indexOf(BLOCK_CLOSE, contentStart);
    if (close === -1) return;
    contentEnd = close;
  }

  const content = line.slice(contentStart, contentEnd);
  const trimmed = content.replace(/^\s+/, "");
  const leadingWs = content.length - trimmed.length;
  if (trimmed.length === 0) return;

  for (const kt of keytags) {
    const kw = kt.keyword;
    if (trimmed.length >= kw.length && trimmed.slice(0, kw.length).toLowerCase() === kw.toLowerCase()) {
      const msgStart = contentStart + leadingWs + kw.length;
      out.push({
        keytag: kt,
        message: line.slice(msgStart, contentEnd).trim(),
        line: lineIdx + 1,
        startColumn: start + 1,
        messageColumn: msgStart + 1,
        endColumn: contentEnd + 1,
        text: line,
      });
      return;
    }
  }
}