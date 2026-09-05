/**
 * keytag-manager.js
 *  Management window for keytags: list, add, edit, delete, re-enable and
 *  reset to defaults. Saved through keytags.saveKeytags(), which fires the
 *  registry's `onChange` listeners (the comment module re-scans and
 *  re-renders highlight styles accordingly).
 *
 *  All DOM is built with createElement/textContent (XSS-safe).
 */

import { t } from '../../i18n/index.js';
import { openModal, showConfirm } from '../modal.js';
import { getKeytags, saveKeytags, resetKeytags, isValidKeyword } from './keytags.js';

export function openKeytagManager() {
  let rows = getKeytags().map(cloneRow);

  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:8px;";

  const errorEl = document.createElement("div");
  errorEl.className = "ide-modal-error";
  body.appendChild(errorEl);

  const list = document.createElement("div");
  list.id = "keytags-manager-list";
  list.style.cssText = "display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow-y:auto;";
  body.appendChild(list);

  function render() {
    list.replaceChildren();
    for (const row of rows) list.appendChild(buildRow(row));
  }

  function buildRow(row) {
    const rowEl = document.createElement("div");
    rowEl.style.cssText =
      "display:flex;align-items:center;gap:6px;border:1px solid var(--border);" +
      "border-radius:var(--radius-sm);padding:6px 8px;";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = row.color;
    colorInput.addEventListener("input", () => { row.color = colorInput.value; });
    colorInput.title = t('comment.color');
    rowEl.appendChild(colorInput);

    const keywordInput = document.createElement("input");
    keywordInput.type = "text";
    keywordInput.className = "ide-modal-input";
    keywordInput.value = row.keyword;
    keywordInput.placeholder = "TODO:";
    keywordInput.title = t('comment.keyword');
    keywordInput.style.width = "110px";
    keywordInput.addEventListener("input", () => { row.keyword = keywordInput.value; });
    rowEl.appendChild(keywordInput);

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "ide-modal-input";
    labelInput.value = row.label;
    labelInput.title = t('comment.label');
    labelInput.style.flex = "1";
    labelInput.addEventListener("input", () => { row.label = labelInput.value; });
    rowEl.appendChild(labelInput);

    const enabledBox = document.createElement("input");
    enabledBox.type = "checkbox";
    enabledBox.checked = row.enabled;
    enabledBox.title = t('comment.enabled');
    enabledBox.addEventListener("change", () => { row.enabled = enabledBox.checked; });
    rowEl.appendChild(enabledBox);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "action-btn";
    const deleteIcon = document.createElement("span");
    deleteIcon.className = "material-symbols-outlined";
    deleteIcon.textContent = "delete";
    deleteBtn.appendChild(deleteIcon);
    deleteBtn.addEventListener("click", () => {
      rows = rows.filter((r) => r !== row);
      render();
    });
    rowEl.appendChild(deleteBtn);

    return rowEl;
  }

  function showError(msg) {
    errorEl.textContent = msg ?? "";
  }

  function validate() {
    const seen = new Map();
    for (const row of rows) {
      if (!isValidKeyword(row.keyword)) {
        return t('comment.invalid_keyword');
      }
      const key = row.keyword.toLowerCase();
      if (seen.has(key)) return t('comment.duplicate_keyword');
      seen.set(key, row);
    }
    return null;
  }

  function onSave(close) {
    const err = validate();
    if (err) { showError(err); return; }
    saveKeytags(rows);
    close();
  }

  const { close } = openModal({
    title: t('comment.manager_title'),
    body,
    width: window.innerWidth < 1000 ? '85%' : '60%',
    buttons: [
      { label: t('modal.cancel'), primary: false, onClick: (c) => c() },
      { label: t('comment.reset'), primary: false, onClick: async (c) => {
        const ok = await showConfirm({
          title: t('comment.reset_confirm_title'),
          message: t('comment.reset_confirm_message'),
          confirmLabel: t('modal.confirm'),
          cancelLabel: t('modal.cancel'),
        });
        if (!ok) return;
        rows = resetKeytags().map(cloneRow);
        render();
      }},
      { label: t('comment.save'), primary: true, onClick: (c) => onSave(c) },
    ],
  });

  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  addBtn.textContent = t('comment.add_tag');
  addBtn.addEventListener("click", () => {
    rows.push({ id: `custom-${Date.now()}`, keyword: "", label: "", color: "#888888", enabled: true });
    render();
  });
  list.after(addBtn);

  render();
}

function cloneRow(row) {
  return { ...row };
}