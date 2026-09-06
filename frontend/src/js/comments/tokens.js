/**
 * tokens.js
 *  Builds the comment spans consumed by scan.findKeytagComments, either
 *  from Monaco tokens (`monaco.editor.tokenize`) or from a plain regex.
 *
 *  ## Why tokens?
 *  Relying on the Monarch tokenizer makes the scanner context-aware:
 *  `//` inside a string literal, an URL or raw code is a STRING/TEXT token,
 *  not a COMMENT token, so those false positives disappear. Multi-line
 *  block comments (slash-star … star-slash spanning lines) come out as
 *  consecutive comment tokens (see the `blockComment` state in
 *  typst-syntax.js) and are merged here. The regex path
 *  (`commentSpansFromText`) is the fallback for environments where Monaco
 *  tokenization is unavailable (unit tests).
 *
 *  Positions are expressed in UTF-16 code units (Monaco's contract) —
 *  JS string indices are UTF-16, so they map 1:1.
 */

/** The closing marker of a block comment, split so it survives doc comments. */
const BLOCK_CLOSE = "*" + "/";

/**
 * True when a Monarch token type denotes a Typst comment.
 * Monarch yields "<token>.<languageId>" (here "comment.typst"); matching by
 * prefix keeps this robust when the language id is absent (synthetic tokens
 * in tests).
 */
export function isCommentToken(type) {
  return type === "comment" || type.startsWith("comment.");
}

/**
 * Converts Monaco `Token[][]` into comment spans.
 *
 * @param {Array<Array<{offset: number, type: string}>>} tokens  Per-line token arrays.
 * @param {string} text Source text (needed to recover token contents).
 * @returns {Array<{line: number, col: number, text: string}>}
 *   One span per comment. `line`/`col` (1-based) point at the opening
 *   marker; `text` is the full comment (markers included, multi-line
 *   blocks joined with "\n").
 */
export function commentSpansFromTokens(tokens, text) {
  const spans = [];
  const lines = text.split("\n");

  // An unclosed `/*` block carried over from the previous line.
  let pending = null;

  for (let i = 0; i < tokens.length; i++) {
    const lineTokens = tokens[i] ?? [];
    const lineText = lines[i] ?? "";
    const n = lineTokens.length;

    let unit = null; // span being accumulated on this line
    const closeUnit = () => {
      if (unit) {
        spans.push(unit);
        unit = null;
      }
    };

    for (let j = 0; j < n; j++) {
      const tok = lineTokens[j];
      if (!isCommentToken(tok.type)) {
        closeUnit();
        if (pending) {
          // A `/*` opened on a previous line but the tokenizer left the
          // comment state: flush the unclosed block as-is.
          spans.push(pending);
          pending = null;
        }
        continue;
      }

      const start = tok.offset;
      const end = j + 1 < n ? lineTokens[j + 1].offset : lineText.length;
      const slice = lineText.slice(start, end);

      if (!unit) {
        unit = pending
          ? { line: pending.line, col: pending.col, text: pending.text + "\n" }
          : { line: i + 1, col: start + 1, text: "" };
        pending = null;
      }
      unit.text += slice;

      if (unit.text.startsWith("/*")) {
        // Block comment: closes when a token ends with `*/`.
        if (slice.endsWith(BLOCK_CLOSE)) closeUnit();
      } else {
        // Line comment: always ends with its line.
        closeUnit();
      }
    }

    if (unit) pending = unit;
  }

  if (pending) spans.push(pending);
  return spans;
}

/**
 * Regex fallback for extracting comment spans (no Monaco required).
 * Handles `//` line comments and block comments (single- or multi-line).
 * An unclosed block opener is ignored (the token path covers that case).
 */
export function commentSpansFromText(text) {
  const spans = [];
  if (!text) return spans;

  const lineStarts = [];
  {
    let acc = 0;
    for (const l of text.split("\n")) {
      lineStarts.push(acc);
      acc += l.length + 1;
    }
  }

  const re = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
  let m;
  let lineIdx = 0;
  while ((m = re.exec(text))) {
    const idx = m.index;
    while (lineIdx + 1 < lineStarts.length && lineStarts[lineIdx + 1] <= idx) {
      lineIdx++;
    }
    spans.push({ line: lineIdx + 1, col: idx - lineStarts[lineIdx] + 1, text: m[0] });
  }
  return spans;
}

/**
 * Best-effort extraction for the app: Monaco tokens when available
 * (no false positives, multi-line blocks), regex otherwise.
 *
 * `globalThis.monaco` is set by main.js (`window.monaco = monaco`): using
 * the global instead of a static import keeps this module importable in
 * vitest (the monaco-editor package does not resolve in the node runner).
 */
export function commentSpansFromBuffer(text) {
  const monacoApi = globalThis.monaco;
  try {
    if (monacoApi?.editor?.tokenize) {
      return commentSpansFromTokens(monacoApi.editor.tokenize(text, "typst"), text);
    }
  } catch {
    // Fall through to the regex path.
  }
  return commentSpansFromText(text);
}