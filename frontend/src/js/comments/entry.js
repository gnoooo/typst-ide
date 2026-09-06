/**
 * entry.js
 *  Pure DOM builder for a marker-book row. No Monaco, no editor, no i18n
 *  module — labels and the jump callback are injected, so the builder is
 *  directly unit-testable (jsdom) and reused by the book.
 *
 *  All user-controlled text goes through textContent (XSS-safe).
 */

import { getContrastTextColor } from './keytags.js';

/**
 * Builds a clickable row: colored chip (label), message, line number.
 *
 * @param {object} entry  Scan entry: { keytag, message, line, messageColumn }.
 * @param {{ emptyMessage: string, lineLabel: (line: number) => string }} l10n
 *   Display strings (already translated by the caller).
 * @param {(entry: object) => void} [onJump]  Called when the row is clicked.
 * @returns {HTMLButtonElement}
 */
export function buildEntryRow(entry, l10n, onJump) {
  const row = document.createElement("button");
  row.className = "note-btn";
  row.style.cssText = "text-align:left;display:flex;align-items:center;gap:8px;";

  const chip = document.createElement("span");
  chip.textContent = entry.keytag.label;
  chip.style.cssText =
    `background:${entry.keytag.color};color:${getContrastTextColor(entry.keytag.color)};` +
    "border-radius:var(--radius-sm);flex:none;padding:1px 8px;font-size:11px;font-weight:600;";
  row.appendChild(chip);

  const msg = document.createElement("span");
  msg.className = "note-btn-content";
  msg.textContent = entry.message || l10n.emptyMessage;
  msg.style.cssText = "color:var(--text);";
  row.appendChild(msg);

  const line = document.createElement("span");
  line.className = "note-btn-content";
  line.textContent = l10n.lineLabel(entry.line);
  line.style.cssText = "color:var(--text-muted);margin-left:auto;flex:none;";
  row.appendChild(line);

  if (onJump) {
    row.addEventListener("click", () => onJump(entry));
  }
  return row;
}