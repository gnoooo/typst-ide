

const { invoke } = window.__TAURI__.core;

import { getCurrentFontFamily } from '../editor.js';
import { openModal, showConfirm, showSelect } from "../modal.js"
import { showToast } from '../toast.js';
import { closeBibliography } from "./bibliography.js";
import { biblatex } from "../schema/biblatex-entries.js";


export async function addNewSource(filepath) {
  // get the type of source
  // show select prompt with values of biblatex-entries
  const biblatex_entry_types = Object.fromEntries(
    Object.entries(biblatex).map(([type, fields]) => [
      type,
      fields.map(f => ({ name: f, required: false }))
    ])
  );
  const entry_type = await showSelect({
    title: 'Choix du type de source',
    label: 'Type de la source (norme CSL)',
    optionsdata: biblatex_entry_types,

  })

  if (!entry_type) return;
  const chosen_entry_type_data = biblatex[entry_type]; // array

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
          <p>ID de la source :</p>
          <input class="flex-1" placeholder="nom de variable" style="font-family: ${getCurrentFontFamily()};margin-left: 4pt;"/>
        </div>
        ${values}
      </div>
    </div>
  `;

  openModal({
    title: "Ajout d'une source",
    body: body,
    width: window.innerWidth < 1000 ? "75%" : "50%",
    buttons: [
      { label: "Annuler", primary: false, onClick: (close) => close() },
      { label: "Ajouter la source", primary: true, onClick: async (close) => {
          const citeKeyInput = body.querySelector("input[placeholder='nom de variable']");
          const cite_key = citeKeyInput?.value?.trim();
          if (!cite_key) {
            showToast("error", "Veuillez saisir un ID de source.");
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
              showToast("success", "Source ajoutée !");
              close();
            } else {
              showToast("error", "Cette source existe déjà (même clé).");
            }
          } catch (err) {
            showToast("error", "Erreur lors de l'ajout : " + err);
          }
        }},
    ],
  });
}

export async function openSources(filepath) {
  let entries = await invoke("parse_bib_file", { filepath: filepath });

  const body = document.createElement('div');
  entries.forEach( async (entry, idx) => {
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
            <p style="min-width:80px;">Cite key :</p>
            <input class="flex-1 cite-key-input" value="${entry.cite_key}" style="font-family: ${getCurrentFontFamily()};margin-left:4pt;width:100%;"/>
          </div>
          <div class="bibliography-source-type flex items-center" style="margin-top:6px;width:100%;">
            <p style="min-width:80px;">Type :</p>
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

    // delete individual field values
    entryEl.querySelectorAll(".delete-bibliography-source-value-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const citeKey = btn.dataset.citekey;
        const field = btn.dataset.field;
        invoke("delete_bib_source_value", {
          filepath: filepath,
          citeKeyToEdit: citeKey,
          keyToDelete: field
        });
        closeBibliography();
        await openSources(filepath);
      });
    });

    // delete whole source
    entryEl.querySelector(".delete-bibliography-source-btn").addEventListener("click", async () => {
      const confirmed = await showConfirm({
        title: "Supprimer la source",
        message: `Êtes-vous sûr de vouloir supprimer la source "${oldCiteKey}" ? Cette action est irréversible.`,
      });
      if (!confirmed) return;
      await invoke("delete_whole_bib_source", {
        filepath: filepath,
        citeKeyToDelete: oldCiteKey,
      });
      closeBibliography();
      await openSources(filepath);
    });

    // save modifications
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

      await invoke("replace_whole_bib_source", { filepath: filepath, oldCiteKey: oldCiteKey, entry: new_entry });
      closeBibliography();
      openSources(filepath);
    });

    body.appendChild(entryEl);

  });
  openModal({
    title: `${filepath.split('/').pop()}`,
    body: body,
    width: window.innerWidth < 1000 ? "75%" : "50%",
    buttons: [
      { label: "Fermer", primary: true, onClick: (close) => close() },
      { label: "Ajouter une source", primary: false, onClick: async (close) => {
          await addNewSource(filepath);
          close();
        }},
    ],
  });
}
