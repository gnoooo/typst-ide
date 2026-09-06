/**
 * book.js
 *  "Comment book": a modal listing all keytag comments found in the current
 *  editor document. Searchable, filterable per keytag; clicking an entry
 *  jumps the editor cursor to it.
 *
 *  Also hosts the "add comment" flow: pick a keytag, insert
 *  `// KEYTAG: ` at the cursor — the book stays open and refreshes.
 */

import { t } from '../../i18n/index.js';
import { openModal } from '../modal.js';
import { getEditor } from '../editor.js';
import { findKeytagComments } from './scan.js';
import { commentSpansFromBuffer } from './tokens.js';
import { getKeytags } from './keytags.js';
import { openKeytagManager } from './keytag-manager.js';

export function openCommentBook() {
  const editor = getEditor();
  const model = editor?.getModel();
  if (!editor || !model) return;

  let entries = [];
  let filterTagId = null;
  let filterText = "";

  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:8px;";

  // ## Search bar ###################################################
  const search = document.createElement("input");
  search.type = "text";
  search.className = "ide-modal-input";
  search.placeholder = t('comment.search');
  search.addEventListener("input", () => {
    filterText = search.value.trim();
    rebuild();
  });
  body.appendChild(search);

  // ## Per-keytag filter chips #######################################
  const chips = document.createElement("div");
  chips.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
  body.appendChild(chips);

  // ## Entry list ####################################################
  const list = document.createElement("div");
  list.id = "comments-book-list";
  list.style.cssText = "display:flex;flex-direction:column;gap:4px;max-height:50vh;overflow-y:auto;";
  body.appendChild(list);

  function rebuildChips() {
    chips.replaceChildren();
    const mkChip = (label, color, tagId) => {
      const chip = document.createElement("button");
      chip.className = "btn";
      chip.textContent = label;
      chip.style.cssText = color
        ? `background:${color};color:#fff;border:none;`
        : "border:1px solid var(--border);";
      chip.addEventListener("click", () => {
        filterTagId = tagId === filterTagId ? null : tagId;
        rebuild();
      });
      return chip;
    };
    chips.appendChild(mkChip(t('comment.all'), null, null));
    const keytags = getKeytags().filter((kt) => kt.enabled);
    for (const kt of keytags) chips.appendChild(mkChip(kt.label, kt.color, kt.id));
  }

  function rebuild() {
    rebuildChips();
    list.replaceChildren();

    const visible = entries.filter((e) => {
      if (filterTagId && e.keytag.id !== filterTagId) return false;
      if (filterText) {
        const hay = `${e.message} ${e.text}`;
        if (!hay.toLowerCase().includes(filterText.toLowerCase())) return false;
      }
      return true;
    });

    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.style.cssText = "color:var(--text-muted);text-align:center;padding:1rem;";
      empty.textContent = filterTagId || filterText ? t('comment.no_results') : t('comment.no_comments');
      list.appendChild(empty);
      return;
    }

    for (const entry of visible) list.appendChild(buildEntryRow(entry));
  }

  function buildEntryRow(entry) {
    const row = document.createElement("button");
    row.className = "note-btn";
    row.style.cssText = "text-align:left;display:flex;align-items:center;gap:8px;";

    const chip = document.createElement("span");
    chip.textContent = entry.keytag.label;
    chip.style.cssText =
      `background:${entry.keytag.color};color:#fff;border-radius:var(--radius-sm);` +
      "flex:none;padding:1px 8px;font-size:11px;font-weight:600;";
    row.appendChild(chip);

    const msg = document.createElement("span");
    msg.className = "note-btn-content";
    msg.textContent = entry.message || t('comment.empty_message');
    msg.style.cssText = "color:var(--text);";
    row.appendChild(msg);

    const line = document.createElement("span");
    line.className = "note-btn-content";
    line.textContent = t('comment.line', { line: entry.line });
    line.style.cssText = "color:var(--text-muted);margin-left:auto;flex:none;";
    row.appendChild(line);

    row.addEventListener("click", () => {
      editor.setPosition({ lineNumber: entry.line, column: entry.messageColumn });
      editor.revealPositionInCenter({ lineNumber: entry.line, column: entry.messageColumn });
      setTimeout(() => editor.focus(), 0);
    });
    return row;
  }

  function refreshEntries() {
    const keytags = getKeytags().filter((kt) => kt.enabled);
    const text = model.getValue();
    entries = findKeytagComments(commentSpansFromBuffer(text), keytags);
    rebuild();
  }

  refreshEntries();

  openModal({
    title: t('comment.title'),
    body,
    width: window.innerWidth < 1000 ? '75%' : '55%',
    buttons: [
      { label: t('comment.add'), primary: true, onClick: async () => {
          await insertComment(editor);
          refreshEntries();
      }},
      { label: t('comment.manage'), primary: false, onClick: (close) => {
          close();
          openKeytagManager();
      }},
    ],
  });
}

/**
 * Asks for a keytag (when several are enabled) and inserts `// KEYTAG: `
 * at the cursor position.
 * @param {import('monaco-editor').editor.IStandaloneCodeEditor} [editor]
 * @returns {Promise<boolean>} true when a comment was inserted.
 */
export async function insertComment(editor = getEditor()) {
  const keytags = getKeytags().filter((kt) => kt.enabled);
  if (keytags.length === 0) {
    const toast = await import('../toast.js');
    toast.showToast("warning", t('comment.no_enabled'));
    return false;
  }
  if (!editor || !editor.getModel()) return false;

  const tag = keytags.length === 1 ? keytags[0] : await pickKeytag(keytags);
  if (!tag) return false;

  const selection = editor.getSelection();
  editor.executeEdits("comments", [
    { range: selection, text: `// ${tag.keyword} `, forceMoveMarkers: true },
  ]);
  editor.focus();
  return true;
}

/** Modal listing the enabled keytags; resolves with the chosen one (or null). */
function pickKeytag(keytags) {
  return new Promise((resolve) => {
    let resolved = false;
    function done(tag) {
      if (resolved) return;
      resolved = true;
      close();
      resolve(tag);
    }

    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:6px;";

    for (const kt of keytags) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.style.cssText = "text-align:left;display:flex;align-items:center;gap:8px;";
      const chip = document.createElement("span");
      chip.textContent = kt.keyword;
      chip.style.cssText =
        `background:${kt.color};color:#fff;border-radius:var(--radius-sm);` +
        "padding:1px 8px;font-size:12px;font-weight:600;";
      const label = document.createElement("span");
      label.textContent = kt.label;
      btn.appendChild(chip);
      btn.appendChild(label);
      btn.addEventListener("click", () => done(kt));
      body.appendChild(btn);
    }

    const cancel = document.createElement("button");
    cancel.className = "btn";
    cancel.textContent = t('modal.cancel');
    cancel.addEventListener("click", () => done(null));
    body.appendChild(cancel);

    const modal = openModal({
      title: t('comment.pick_tag'),
      body,
      width: "340px",
      buttons: [],
      onClose: () => done(null),
    });
    const { close } = modal;
  });
}