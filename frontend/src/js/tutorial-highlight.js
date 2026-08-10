/**
 * tutorial-highlight.js
 *  Minimal Typst syntax highlighter for the tutorial code blocks.
 *
 *  Single-pass tokenizer: comments, strings, #functions, numbers,
 *  then markup strong / emphasis. The * and _ delimiters are kept
 *  inside the token so the markup that produces the formatting
 *  stays visible. Everything else is escaped HTML.
 *
 *  ## API
 *  highlightTypst(code) -> string   HTML with .tut-tok-* spans
 *  escapeHtml(text)     -> string   basic HTML escaping
 */

const TOKEN_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(#[a-zA-Z_][\w-]*)|(\b\d+(?:\.\d+)?(?:%|[a-zA-Z]+)?\b)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;

const TOKEN_CLASS = [
  "tut-tok-comment",
  "tut-tok-string",
  "tut-tok-function",
  "tut-tok-number",
  "tut-tok-strong",
  "tut-tok-emphasis",
];

export function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function highlightTypst(code) {
  let out = "";
  let last = 0;
  for (const match of code.matchAll(TOKEN_RE)) {
    out += escapeHtml(code.slice(last, match.index));
    const groups = match.slice(1);
    for (let i = 0; i < groups.length; i++) {
      if (groups[i] !== undefined) {
        out += `<span class="${TOKEN_CLASS[i]}">${escapeHtml(groups[i])}</span>`;
        break;
      }
    }
    last = match.index + match[0].length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}