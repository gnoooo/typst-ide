

const { invoke } = window.__TAURI__.core;
const { join } = window.__TAURI__.path;

import { getCurrentFontFamily } from '../editor.js';
import { getCurrentProject } from "../project.js";
import { openModal, showConfirm, showSelect } from "../modal.js"
import { biblatex } from "../schema/biblatex-entries.js";


export async function addNewSource() {
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

  const chosen_entry_type_data = biblatex[entry_type]; // array

  let values = ""
  chosen_entry_type_data.forEach( field => {
    values += `
      <span class="bibliography-source-data-line flex items-center" style="margin-top:6px;width:75%;">
        <p>${field} :</p>
        <input class="flex-1" placeholder="${field}" id="input-${field}" style="font-family: ${getCurrentFontFamily()};margin-left: 4pt;"/>
      </span>
      `;
  });

  const body = document.createElement("div");
  body.innerHTML = `
    <span class="flex gap-2">
      <div class="bibliography-source-add-btn">
        <div class="bibliography-source-data-name flex items-center" style="margin-top:6px;width:75%";>
          <p>ID de la source :</p>
          <input class="flex-1" placeholder="nom de variable" style="font-family: ${getCurrentFontFamily()};margin-left: 4pt;"/>
        </div>
        ${values}
      </div>
    </span>
  `;

  openModal({
    title: "Ajout d'une source",
    body: body,
    width: window.innerWidth < 1000 ? "75%" : "50%",
    buttons: [
      { label: "Fermer", primary: true, onClick: (close) => close() },
      { label: "Ajouter la source", primary: false, onClick: async (close) => {
          // TODO: parser toutes les infos
          // puis faire appel à la fonction d'ajout dans le back Rust (à implémenter)
          close();
        }},
    ],
  });
}

export async function openSources(filename) {
  const fullpath = await join(getCurrentProject().path, filename);
  let entries = await invoke("parse_bib_file", { filepath: fullpath });

  const body = document.createElement('div');
  entries.forEach( async (entry) => {
    let values = "";

    Object.entries(entry.data).forEach(([key, value]) => {
      values += `
        <span class="bibliography-entry-data-line flex items-center" style="margin-top:6px;width:75%;">
          <p>${key} :</p>
          <input class="flex-1" value="${value}" data-key="${key}" style="font-family: ${getCurrentFontFamily()};margin-left: 4pt;"/>
          <button class="action-btn delete-bibliography-source-value-btn" id="delete-${entry.cite_key}-${key}">
              <span class="material-symbols-outlined delete-bibliography-source-value-icon">delete</span>
          </button>
        </span>
        `;
    });

    const entryEl = document.createElement("div");
    entryEl.className = "bibliography-file-entry";
    entryEl.innerHTML = `
      <span class="flex gap-2">
        <div class="bibliography-source-entry-btn" id="bibliography-${entry.cite_key}">
          <div class="bibliography-source-title">${entry.cite_key}</div>
          <div class="bibliography-source-content">
            ${values}
          </div>

        </div>
        <div class="flex items-center gap-1">
            <button class="action-btn delete-bibliography-source-btn" id="delete-${entry.cite_key}">
                <span class="material-symbols-outlined delete-bibliography-source-icon">delete</span>
            </button>
            <button class="action-btn save-bibliography-source-btn" id="save-${entry.cite_key}">
                <span class="material-symbols-outlined save-bibliography-source-icon">save</span>
            </button>
            <button class="action-btn add-bibliography-source-btn" id="add-${entry.cite_key}">
                <span class="material-symbols-outlined add-bibliography-source-icon">add_link</span>
            </button>
        </div>
      </span>
    `;

    const spans_data_line = entryEl.querySelectorAll(".bibliography-entry-data-line");
    const cite_key = entryEl.querySelector(".bibliography-source-title").textContent?.trim();
    const filepath = await join(getCurrentProject().path, filename);

    // buttons foreach lines
    // add even foreach delete buttons
    spans_data_line.forEach(async (span) => {
      const par = span.querySelector("p")?.textContent?.replace(":","").trim(); // key
      span.querySelector(`#delete-${cite_key}-${par}`).addEventListener("click", async () => {
        invoke("delete_bib_source_value", {
          filepath: filepath,
          citeKeyToEdit: cite_key,
          keyToDelete: par
        });

        closeBibliography();
        await openSources(filename);

      })
    })

    // attach listeners todo
    entryEl.querySelector(`#delete-${entry.cite_key}`).addEventListener("click", async () => {
      await invoke("delete_whole_bib_source", {
        filepath: filepath,
        citeKeyToDelete: entry.cite_key,
      });
      closeBibliography();
      await openSources(filename);
    });
    entryEl.querySelector(`#save-${entry.cite_key}`).addEventListener("click", async () => {
      // json creation
      // then call invoke replace_whole_bib_source(filepath, entry)
      // entry :
      // - cite_key (str)
      // - entry_type (str)
      // - data (json)

      // get all span .bibliography-entry-data-line
      let data = {};
      const spans_data_line = document.querySelectorAll(".bibliography-entry-data-line");
      spans_data_line.forEach(span => {
        const par = span.querySelector("p")?.textContent?.replace(":","").trim(); // key
        const input = span.querySelector("input").value; // value

        if (par) data[par] = input;

      });

      let new_entry = {
        "cite_key": entry.cite_key,
        "entry_type": entry.entry_type,
        "data": data
      }

      await invoke("replace_whole_bib_source", { filepath: filepath, entry: new_entry });
      closeBibliography();
      openSources(filename);
    });

    body.appendChild(entryEl);



  });
  openModal({
    title: `${filename}`,
    body: body,
    width: window.innerWidth < 1000 ? "75%" : "50%",
    buttons: [
      { label: "Fermer", primary: true, onClick: (close) => close() },
      { label: "Ajouter une source", primary: false, onClick: async (close) => {
          await addNewSource();
          close();
        }},
    ],
  });
}
