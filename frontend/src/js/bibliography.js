

const { invoke } = window.__TAURI__.core;
const { join } = window.__TAURI__.path;

import { openModal, showConfirm } from "./modal.js";
import { getCurrentFontFamily } from './editor.js';
import { showToast } from './toast.js';
import { getCurrentProject } from "./project";

async function createBibliographyEntry() {
  const body = document.createElement("div");
  body.innerHTML = `
<div class="bibliography-entry-form">
    <div>
      <p id="bibliography-entry-title">Titre de la bibliographie</p>
      <input id="bibliography-entry-title-input" type="text" placeholder="Nom de la bib" style="width:100%;" required/>
    </div>

    <div class="flex gap-2 items-center">
      <input id="bibliography-entry-full-input" type="checkbox" value="full" required/>
      <label id="bibliography-entry-full">Afficher toute la bibliographie en entier</label>
    </div>

    <div>
      <p id="bibliography-entry-style">Style de la bibliographie</p>
      <select id="bibliography-entry-style-input" style="width:100%;" required>
        <option value="ieee" selected>IEEE</option>
      </select>
    </div>
</div>
  `;
  openModal({
    title: "Ajouter une bibliographie",
    body: body,
    width: "50%",
    buttons: [
      { label: "Annuler", primary: false, onclick: (close) => close() },
      { label: "Ajouter", primary: true, onClick: async (close) => {
        const title = body.querySelector("#bibliography-entry-title-input").value;
        const path = getCurrentProject().path;
        const full = body.querySelector("#bibliography-entry-full-input").checked ? true : false;
        const style = body.querySelector("#bibliography-entry-style-input").value;


        showToast("info", `Path: ${path}`);

        // AJOUTER LA NOUVELLE LOGIQUE DE CREATION
        // IL FAUDRA CREER LE JSON DE DATA

        // try {
        //   const inserted = await invoke("add_bibliography_entry", { title, path, full, style })

        //   if (inserted) {
        //     showToast("success", "Bibliothèque créée !");
        //     close();
        //   } else {
        //     showToast("error", "Cette bibliothèque existe déjà.");
        //   }
        // } catch (err) {
        //   showToast("error", "Erreur lors de la création de la bibliothèque : " + err);
        // }
      }}
    ]
  })
}

function attachBibliographyEntryListeners(entryEl, entry) {
    const deleteBtn = entryEl.querySelector('.delete-bibliography-entry-btn');
    // deleteBtn?.addEventListener('click', () => deleteBibliographyEntry(entry.id));

    const editBtn = entryEl.querySelector('.edit-bibliography-entry-btn');
    // editBtn?.addEventListener('click', () => editBibliographyEntry(entry));
}

async function createBibliographyList() {
    // Call function to get all .bib files in the current project path
  const entries = await invoke('get_all_bibs', { projectpath: getCurrentProject()?.path });
  console.log(entries);

  const container = document.createElement('div');

  // MODIFIER POUR BIEN PARSER LE JSON RECUPÉRÉ, NOTAMMENT DATA
  entries.forEach(entry => {
    const entryEl = document.createElement('div');
    entryEl.className = 'bibliography-entry';
    entryEl.innerHTML = `
<div class="flex gap-2">
  <button class="bibliography-entry-btn" id="history-${entry}">
      <div class="bibliography-entry-btn-title">${entry}</div>
  </button>
  <div class="flex items-center gap-1 ml-2">
    <button class="action-btn delete-bibliography-entry-btn self-center" id="delete-${entry}">
      <span class="material-symbols-outlined delete-bibliography-entry-icon">delete</span>
    </button>
    <button class="action-btn edit-bibliography-entry-btn self-center" id="edit-${entry}">
      <span class="material-symbols-outlined edit-bibliography-entry-icon">edit</span>
    </button>
    <button class="action-btn raw-bibliography-entry-btn self-center" id="raw-${entry}">
      <span class="material-symbols-outlined raw-bibliography-entry-icon">code</span>
    </button>
  </div>
</div>
    `;

/*

entryEl.innerHTML = `
<span class="flex gap-2">
<div class="bibliography-entry-btn" id="bibliography-${entry.cite_key}">
    <div class="bibliography-entry-title">${entry.cite_key}</div>
    <div class="bibliography-entry-content" style="font-family: ${getCurrentFontFamily()};">
      <p>path = ${entry.data}</p>
    </div>
</div>
<div class="flex items-center gap-1">
    <button class="delete-bibliography-entry-btn" id="delete-${entry.cite_key}">
        <span class="material-symbols-outlined delete-bibliography-entry-icon">delete</span>
    </button>
    <button class="edit-bibliography-entry-btn" id="edit-${entry.cite_key}">
        <span class="material-symbols-outlined edit-bibliography-entry-icon">edit</span>
    </button>
</div>
</span>
`;
*/

    attachBibliographyEntryListeners(entryEl, entry);
    container.appendChild(entryEl);
  });
  return container;
}

export async function openBibliography() {
  const body = document.createElement("div");
  body.appendChild(await createBibliographyList());

  openModal({
    title: "Bibliothèques du projet",
    body: body,
    width: window.innerWidth < 1000 ? "75%" : "50%",
    buttons: [
      { label: "Fermer", primary: true, onClick: (close) => close() },
      { label: "Ajouter une bibliothèque", primary: false, onClick: async (close) => {
          await createBibliographyEntry();
          close();
        }},
    ],
  });
}

function closeBibliography() {
  const overlay = document.querySelector(".ide-modal-overlay");
  if (overlay) overlay.remove();
}
