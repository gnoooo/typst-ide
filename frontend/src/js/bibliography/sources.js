

const { invoke } = window.__TAURI__.core;
import { t } from '../../i18n/index.js';

import { getCurrentFontFamily } from '../editor.js';
import { openModal, showConfirm, showSelect } from "../modal.js"
import { showToast } from '../toast.js';
import { closeBibliography } from "./bibliography.js";
import { biblatex } from "../schema/biblatex-entries.js";

let _sourceEntries = [];
let _sourceFilepath = "";
let _sourcesContainer = null;

function createSearchBar() {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.alignItems = "center";
  container.style.gap = "6px";
  container.style.padding = "4px 6px";
  container.style.border = "1px solid var(--border)";
  container.style.borderRadius = "var(--radius-sm)";
  container.style.background = "var(--bg-input)";

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined";
  icon.textContent = "search";
  icon.style.fontSize = "18px";
  icon.style.color = "var(--text-muted)";
  container.appendChild(icon);

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = t('source.search');
  input.style.flex = "1";
  input.style.border = "none";
  input.style.background = "transparent";
  input.style.color = "var(--text)";
  input.style.outline = "none";
  input.style.fontSize = "13px";
  container.appendChild(input);

  input.addEventListener("input", () => {
    const text = input.value.trim().toLowerCase();
    rebuildSourcesList(text);
  });

  return container;
}

function rebuildSourcesList(filterText) {
  const container = _sourcesContainer;
  if (!container) return;

  container.innerHTML = "";
  const filtered = filterText
    ? _sourceEntries.filter(e => {
        if (e.cite_key.toLowerCase().includes(filterText)) return true;
        if (e.entry_type.toLowerCase().includes(filterText)) return true;
        for (const val of Object.values(e.data)) {
          if (String(val).toLowerCase().includes(filterText)) return true;
        }
        return false;
      })
    : _sourceEntries;

  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.style.color = 'var(--text-muted)';
    empty.textContent = filterText ? t('source.no_results') : t('source.no_entries');
    container.replaceChildren(empty);
    return;
  }

  filtered.forEach(entry => {
    const entryEl = document.createElement('div');
    entryEl.className = 'bibliography-file-entry';
    entryEl.dataset.citekey = entry.cite_key;

    const wrapper = document.createElement('span');
    wrapper.className = 'flex gap-2';

    const card = document.createElement('div');
    card.className = 'bibliography-source-entry-btn flex-1';

    // --- cite key + entry type inputs (field values are user-controlled) ---
    for (const [labelKey, value, extraClass, name] of [
      ['source.cite_key_label', entry.cite_key,    'cite-key-input',  'cite_key'],
      ['source.type_label',     entry.entry_type, 'entry-type-input', 'type'],
    ]) {
      const row = document.createElement('div');
      row.className = name === 'cite_key'
        ? 'bibliography-source-title flex items-center'
        : 'bibliography-source-type flex items-center';
      row.style.cssText = name === 'cite_key'
        ? 'margin-top:4px;width:100%;'
        : 'margin-top:6px;width:100%;';

      const lbl = document.createElement('p');
      lbl.style.minWidth = '80px';
      lbl.textContent = t(labelKey);
      row.appendChild(lbl);

      const input = document.createElement('input');
      input.className = `flex-1 ${extraClass}`;
      input.value = String(value ?? '');
      input.style.cssText = 'font-family: ' + getCurrentFontFamily() + ';margin-left:4pt;width:100%;';
      row.appendChild(input);

      card.appendChild(row);
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'bibliography-source-content';
    contentDiv.style.marginTop = '8px';

    // --- field values (each is a user-controlled piece of text) ---
    Object.entries(entry.data).forEach(([key, value]) => {
      const line = document.createElement('span');
      line.className = 'bibliography-entry-data-line flex items-center';
      line.style.cssText = 'margin-top:6px;width:75%;';

      const keyP = document.createElement('p');
      keyP.textContent = `${key} :`;
      line.appendChild(keyP);

      const fieldInput = document.createElement('input');
      fieldInput.className = 'flex-1';
      fieldInput.value = String(value ?? '');
      fieldInput.dataset.key = String(key ?? '');
      fieldInput.style.cssText = 'font-family: ' + getCurrentFontFamily() + ';margin-left: 4pt;';
      line.appendChild(fieldInput);

      const delBtn = document.createElement('button');
      delBtn.className = 'action-btn delete-bibliography-source-value-btn';
      delBtn.dataset.citekey = String(entry.cite_key ?? '');
      delBtn.dataset.field = String(key ?? '');
      const delSpan = document.createElement('span');
      delSpan.className = 'material-symbols-outlined delete-bibliography-source-value-icon';
      delSpan.textContent = 'delete';
      delBtn.appendChild(delSpan);
      line.appendChild(delBtn);

      contentDiv.appendChild(line);
    });

    card.appendChild(contentDiv);
    wrapper.appendChild(card);

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-1';
    for (const [suffix, icon] of [
      ['delete-bibliography-source-btn', 'delete'],
      ['save-bibliography-source-btn',   'save'],
    ]) {
      const btn = document.createElement('button');
      btn.className = `action-btn ${suffix}`;
      const span = document.createElement('span');
      span.className = `material-symbols-outlined ${suffix}-icon`;
      span.textContent = icon;
      btn.appendChild(span);
      actions.appendChild(btn);
    }
    wrapper.appendChild(actions);

    entryEl.appendChild(wrapper);

    const oldCiteKey = entry.cite_key;

    entryEl.querySelectorAll('.delete-bibliography-source-value-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const citeKey = btn.dataset.citekey;
        const field = btn.dataset.field;
        try {
          await invoke('delete_bib_source_value', {
            filepath: _sourceFilepath,
            citeKeyToEdit: citeKey,
            keyToDelete: field,
          });
        } catch (err) {
          showToast('error', t('source.delete_value_error', { error: err }));
          return;
        }
        closeBibliography();
        await openSources(_sourceFilepath);
      });
    });

    entryEl.querySelector('.delete-bibliography-source-btn').addEventListener('click', async () => {
      const confirmed = await showConfirm({
        title: t('source.delete_title'),
        message: t('source.delete_message', { key: oldCiteKey }),
      });
      if (!confirmed) return;
      try {
        await invoke('delete_whole_bib_source', {
          filepath: _sourceFilepath,
          citeKeyToDelete: oldCiteKey,
        });
        closeBibliography();
        await openSources(_sourceFilepath);
      } catch (err) {
        showToast('error', t('source.delete_error', { error: err }));
      }
    });

    entryEl.querySelector('.save-bibliography-source-btn').addEventListener('click', async () => {
      let data = {};
      entryEl.querySelectorAll('.bibliography-entry-data-line').forEach(span => {
        const input = span.querySelector('input');
        if (!input) return;
        const key = input.dataset.key;
        if (key) data[key] = input.value;
      });

      const newCiteKey = entryEl.querySelector(".cite-key-input")?.value?.trim() || oldCiteKey;
      const newEntryType = entryEl.querySelector(".entry-type-input")?.value?.trim() || entry.entry_type;

      let new_entry = {
        "cite_key": newCiteKey,
        "entry_type": newEntryType,
        "data": data
      }

      try {
        await invoke("replace_whole_bib_source", { filepath: _sourceFilepath, oldCiteKey: oldCiteKey, entry: new_entry });
        closeBibliography();
        openSources(_sourceFilepath);
      } catch (err) {
        showToast("error", t('source.save_error', { error: err }));
      }
    });

    container.appendChild(entryEl);
  });
}

export async function addNewSource(filepath) {
  const biblatex_entry_types = Object.fromEntries(
    Object.entries(biblatex).map(([type, fields]) => [
      type,
      fields.map(f => ({ name: f, required: false }))
    ])
  );
  const entry_type = await showSelect({
    title: t('source.select_type_title'),
    label: t('source.select_type_label'),
    optionsdata: biblatex_entry_types,

  })

  if (!entry_type) return;
  const chosen_entry_type_data = biblatex[entry_type];

  // `field` is from the hard-coded biblatex schema — not user input — so
  // direct string concatenation is acceptable here. We still use DOM
  // construction rather than innerHTML to keep the codepath uniform.
  const body = document.createElement('div');
  const card = document.createElement('div');
  card.className = 'bibliography-source-entry-btn';
  card.id = 'bibliography-add-source';
  const inner = document.createElement('div');
  inner.className = 'bibliography-source-add-btn';
  card.appendChild(inner);

  const nameRow = document.createElement('div');
  nameRow.className = 'bibliography-source-data-name flex items-center';
  nameRow.style.cssText = 'margin-top:6px;width:75%;';
  const nameLabel = document.createElement('p');
  nameLabel.textContent = t('source.id_label');
  nameRow.appendChild(nameLabel);
  const nameInput = document.createElement('input');
  nameInput.id = 'input-cite-key';
  nameInput.className = 'flex-1';
  nameInput.placeholder = t('source.id_placeholder');
  nameInput.style.cssText = 'font-family: ' + getCurrentFontFamily() + ';margin-left: 4pt;';
  nameRow.appendChild(nameInput);
  inner.appendChild(nameRow);

  // Map field-name → input element so we don't rely on a string-concat
  // CSS selector at the read-back site (avoids the placeholder-selector
  // XSS pattern that bit #sources.js:222).
  const fieldInputs = new Map();
  chosen_entry_type_data.forEach((field) => {
    const line = document.createElement('div');
    line.className = 'bibliography-source-data-line flex items-center';
    line.style.cssText = 'margin-top:6px;width:75%;';
    const label = document.createElement('p');
    label.textContent = String(field) + ' :';
    line.appendChild(label);
    const input = document.createElement('input');
    input.id = `input-${field}`;
    input.className = 'flex-1';
    input.placeholder = String(field);
    input.style.cssText = 'font-family: ' + getCurrentFontFamily() + ';margin-left: 4pt;';
    line.appendChild(input);
    inner.appendChild(line);
    fieldInputs.set(field, input);
  });

  body.appendChild(card);

  openModal({
    title: t('source.add_title'),
    body: body,
    width: window.innerWidth < 1000 ? "75%" : "50%",
    buttons: [
      { label: t('modal.cancel'), primary: false, onClick: (close) => close() },
      { label: t('source.add_title'), primary: true, onClick: async (close) => {
          const cite_key = nameInput.value?.trim();
          if (!cite_key) {
            showToast("error", t('source.empty_id'));
            return;
          }

          let data = {};
          fieldInputs.forEach((input, field) => {
            const value = input.value?.trim();
            if (value) data[field] = value;
          });

          try {
            const added = await invoke("add_entry_to_bib", {
              filepath: filepath,
              entryType: entry_type,
              citeKey: cite_key,
              json: data
            });

            if (added) {
              showToast("success", t('source.added'));
              close();
            } else {
              showToast("error", t('source.exists'));
            }
          } catch (err) {
            showToast("error", t('source.add_error', { error: err }));
          }
        }},
    ],
  });
}

export async function openSources(filepath) {
  _sourceFilepath = filepath;
  _sourceEntries = await invoke("parse_bib_file", { filepath: filepath });

  const body = document.createElement("div");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "8px";

  body.appendChild(createSearchBar());

  const listContainer = document.createElement("div");
  listContainer.id = "sources-list-container";
  _sourcesContainer = listContainer;
  body.appendChild(listContainer);

  rebuildSourcesList("");

  openModal({
    title: `${filepath.split('/').pop()}`,
    body: body,
    width: window.innerWidth < 1000 ? "75%" : "50%",
    buttons: [
      { label: t('modal.close_all'), primary: true, onClick: (close, closeAll) => closeAll() },
      { label: t('source.add_title'), primary: false, onClick: async (close) => {
          await addNewSource(filepath);
          close();
        }},
    ],
  });
}
