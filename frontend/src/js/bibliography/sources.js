

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
    container.innerHTML = filterText
      ? `<p style="color:var(--text-muted)">${t('source.no_results')}</p>`
      : `<p style="color:var(--text-muted)">${t('source.no_entries')}</p>`;
    return;
  }

  filtered.forEach(entry => {
    let values = "";

    Object.entries(entry.data).forEach(([key, value]) => {
      values += `
        <span class="bibliography-entry-data-line flex items-center" style="margin-top:6px;width:75%;">
          <p>${key} :</p>
          <input class="flex-1" value="${value}" data-key="${key}" style="font-family: ${getCurrentFontFamily()};margin-left: 4pt;"/>
          <button class="action-btn delete-bibliography-source-value-btn" data-citekey="${entry.cite_key}" data-field="${key}">
              <span class="material-symbols-outlined delete-bibliography-source-value-icon">delete</span>
          </button>
        </span>
        `;
    });

    const entryEl = document.createElement("div");
    entryEl.className = "bibliography-file-entry";
    entryEl.dataset.citekey = entry.cite_key;
    entryEl.innerHTML = `
      <span class="flex gap-2">
        <div class="bibliography-source-entry-btn flex-1">
          <div class="bibliography-source-title flex items-center" style="margin-top:4px;width:100%;">
            <p style="min-width:80px;">${t('source.cite_key_label')}</p>
            <input class="flex-1 cite-key-input" value="${entry.cite_key}" style="font-family: ${getCurrentFontFamily()};margin-left:4pt;width:100%;"/>
          </div>
          <div class="bibliography-source-type flex items-center" style="margin-top:6px;width:100%;">
            <p style="min-width:80px;">${t('source.type_label')}</p>
            <input class="flex-1 entry-type-input" value="${entry.entry_type}" style="font-family: ${getCurrentFontFamily()};margin-left:4pt;width:100%;"/>
          </div>
          <div class="bibliography-source-content" style="margin-top:8px;">
            ${values}
          </div>
        </div>
        <div class="flex items-center gap-1">
            <button class="action-btn delete-bibliography-source-btn">
                <span class="material-symbols-outlined delete-bibliography-source-icon">delete</span>
            </button>
            <button class="action-btn save-bibliography-source-btn">
                <span class="material-symbols-outlined save-bibliography-source-icon">save</span>
            </button>
        </div>
      </span>
    `;

    const oldCiteKey = entry.cite_key;

    entryEl.querySelectorAll(".delete-bibliography-source-value-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const citeKey = btn.dataset.citekey;
        const field = btn.dataset.field;
        await invoke("delete_bib_source_value", {
          filepath: _sourceFilepath,
          citeKeyToEdit: citeKey,
          keyToDelete: field
        });
        closeBibliography();
        await openSources(_sourceFilepath);
      });
    });

    entryEl.querySelector(".delete-bibliography-source-btn").addEventListener("click", async () => {
      const confirmed = await showConfirm({
        title: t('source.delete_title'),
        message: t('source.delete_message', { key: oldCiteKey }),
      });
      if (!confirmed) return;
      await invoke("delete_whole_bib_source", {
        filepath: _sourceFilepath,
        citeKeyToDelete: oldCiteKey,
      });
      closeBibliography();
      await openSources(_sourceFilepath);
    });

    entryEl.querySelector(".save-bibliography-source-btn").addEventListener("click", async () => {
      let data = {};
      entryEl.querySelectorAll(".bibliography-entry-data-line").forEach(span => {
        const par = span.querySelector("p")?.textContent?.replace(":","").trim();
        const input = span.querySelector("input")?.value;
        if (par) data[par] = input;
      });

      const newCiteKey = entryEl.querySelector(".cite-key-input")?.value?.trim() || oldCiteKey;
      const newEntryType = entryEl.querySelector(".entry-type-input")?.value?.trim() || entry.entry_type;

      let new_entry = {
        "cite_key": newCiteKey,
        "entry_type": newEntryType,
        "data": data
      }

      await invoke("replace_whole_bib_source", { filepath: _sourceFilepath, oldCiteKey: oldCiteKey, entry: new_entry });
      closeBibliography();
      openSources(_sourceFilepath);
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

  let values = ""
  chosen_entry_type_data.forEach( field => {
    values += `
      <div class="bibliography-source-data-line flex items-center" style="margin-top:6px;width:75%;">
        <p>${field} :</p>
        <input class="flex-1" placeholder="${field}" id="input-${field}" style="font-family: ${getCurrentFontFamily()};margin-left: 4pt;"/>
      </div>
      `;
  });

  const body = document.createElement("div");
  body.innerHTML = `
    <div class="bibliography-source-entry-btn" id="bibliography-add-source">
      <div class="bibliography-source-add-btn">
        <div class="bibliography-source-data-name flex items-center" style="margin-top:6px;width:75%;">
          <p>${t('source.id_label')}</p>
          <input class="flex-1" placeholder="${t('source.id_placeholder')}" style="font-family: ${getCurrentFontFamily()};margin-left: 4pt;"/>
        </div>
        ${values}
      </div>
    </div>
  `;

  openModal({
    title: t('source.add_title'),
    body: body,
    width: window.innerWidth < 1000 ? "75%" : "50%",
    buttons: [
      { label: t('modal.cancel'), primary: false, onClick: (close) => close() },
      { label: t('source.add_title'), primary: true, onClick: async (close) => {
          const citeKeyInput = body.querySelector("input[placeholder='" + t('source.id_placeholder') + "']");
          const cite_key = citeKeyInput?.value?.trim();
          if (!cite_key) {
            showToast("error", t('source.empty_id'));
            return;
          }

          let data = {};
          chosen_entry_type_data.forEach(field => {
            const input = body.querySelector(`#input-${field}`);
            if (input?.value?.trim()) {
              data[field] = input.value.trim();
            }
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
