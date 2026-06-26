

const { invoke } = window.__TAURI__.core;

import { openModal, showConfirm } from "../modal.js";
import { showToast } from '../toast.js';
import { getCurrentProject } from "../project.js";
import { openSources, addNewSource } from "./sources.js";

async function createBibliography() {
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
        const projectPath = getCurrentProject().path;
        const filepath = `${projectPath}/${title}.bib`;
        const full = body.querySelector("#bibliography-entry-full-input").checked ? true : false;
        const style = body.querySelector("#bibliography-entry-style-input").value;

        try {
          const created = await invoke("create_bib_file_if_missing", { filepath });
          let inserted = false;
          if (!created) {
            showToast("error", "Erreur lors de la création du fichier .bib.");
            return;
          } else {
            inserted = await invoke("add_bibliography_entry", { title, path: filepath, projectPath, full, style })
          }

          if (inserted) {
            showToast("success", "Bibliothèque créée !");
            close();
          } else {
            showToast("error", "Cette bibliothèque existe déjà.");
          }
        } catch (err) {
          showToast("error", "Erreur lors de la création de la bibliothèque : " + err);
        }
      }}
    ]
  })
}



function attachBibliographyListeners(entryEl, entry) {
  const mainBtn = entryEl.querySelector('.bibliography-entry-btn');
  mainBtn?.addEventListener("click", async () => {
    await openSources(entry.path);
  })

  const deleteBtn = entryEl.querySelector('.delete-bibliography-entry-btn');
  deleteBtn?.addEventListener('click', () => deleteBibliographyEntry(entry.id));

  const editBtn = entryEl.querySelector('.edit-bibliography-entry-btn');
  editBtn?.addEventListener('click', () => editBibliographyEntry(entry));

  const rawtBtn = entryEl.querySelector('.raw-bibliography-entry-btn');
  rawtBtn?.addEventListener('click', () => rawBibliographyEntry(entry));
}

async function createBibliographyList() {
  //   // Call function to get all .bib files in the current project path
  // const entries = await invoke("get_all_bibs", { 
  //   projectPath: getCurrentProject()?.path 
  // });
  // console.log(entries);

  // First, synchronize the bibliography entries (files) with the database
  await invoke("synchronize_bibliography_entries", { projectpath: getCurrentProject()?.path });
  console.log("Bibliography entries synchronized with the database.");
  // Then, retrieve the bibliography entries from the database
  const entries = await invoke("get_bibliography", { projectPath: getCurrentProject()?.path });


  const container = document.createElement('div');

  // MODIFIER POUR BIEN PARSER LE JSON RECUPÉRÉ, NOTAMMENT DATA
  entries.forEach(entry => {
    const entryEl = document.createElement('div');
    entryEl.className = 'bibliography-entry';
    entryEl.innerHTML = `
      <div class="flex gap-2">
        <button class="bibliography-entry-btn" id="bibliography-${entry.title}">
            <div class="bibliography-entry-btn-title">${entry.title}</div>
        </button>
        <div class="flex items-center gap-1 ml-2">
          <button class="action-btn delete-bibliography-entry-btn self-center" id="delete-${entry.title}">
            <span class="material-symbols-outlined delete-bibliography-entry-icon">delete</span>
          </button>
          <button class="action-btn edit-bibliography-entry-btn self-center" id="edit-${entry.title}">
            <span class="material-symbols-outlined edit-bibliography-entry-icon">edit</span>
          </button>
          <button class="action-btn raw-bibliography-entry-btn self-center" id="raw-${entry.title}">
            <span class="material-symbols-outlined raw-bibliography-entry-icon">code</span>
          </button>
        </div>
      </div>
    `;

    attachBibliographyListeners(entryEl, entry);
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
          await createBibliography();
          close();
        }},
    ],
  });
}

export function closeBibliography() {
  const overlays = document.querySelectorAll(".ide-modal-overlay");
  const top = overlays[overlays.length - 1];
  if (top) {
    top.classList.remove("ide-modal-overlay--visible");
    top.addEventListener("transitionend", () => top.remove(), { once: true });
  }
}

async function editBibliographyEntry(entry) {
    const body = document.createElement("div");
  body.innerHTML = `
    <div class="bibliography-entry-form">
        <div>
          <p id="bibliography-entry-title">Titre de la bibliographie</p>
          <input id="bibliography-entry-title-input" type="text" placeholder="Nom de la bib" style="width:100%;" value="${entry.title}" required/>
        </div>

        <div class="flex gap-2 items-center">
          <input id="bibliography-entry-full-input" type="checkbox" value="full" ${entry.full ? 'checked' : ''}/>
          <label id="bibliography-entry-full">Afficher toute la bibliographie en entier</label>
        </div>

        <div>
          <p id="bibliography-entry-style">Style de la bibliographie</p>
          <input id="bibliography-entry-style-input" type="text" placeholder="Style" style="width:100%;" value="${entry.style}" required/>
        </div>
    </div>
  `;
  openModal({
    title: "Modifier une bibliographie",
    body: body,
    width: "50%",
    buttons: [
      { label: "Annuler", primary: false, onClick: (close) => close() },
      { label: "Modifier", primary: true, onClick: async (close) => {
        const newTitle = body.querySelector("#bibliography-entry-title-input").value;
        const full = body.querySelector("#bibliography-entry-full-input").checked ? true : false;
        const style = body.querySelector("#bibliography-entry-style-input").value;

        try {
          const projectPath = getCurrentProject().path;
          const oldPath = entry.path;
          const newPath = `${projectPath}/${newTitle}.bib`;

          // Rename the .bib file if the title changed
          if (newTitle !== entry.title) {
            await invoke("rename_file", { oldPath: oldPath, newPath: newPath });
          }

          await invoke("update_bibliography_entry", {
            id: entry.id,
            title: newTitle,
            style,
            path: newPath,
            full
          });

          showToast("success", "Bibliographie modifiée !");
          close();
        } catch (err) {
          showToast("error", "Erreur lors de la modification : " + err);
        }
      }}
    ]
  })
}

async function rawBibliographyEntry(entry) {
  const body = document.createElement("div");
  const textarea = document.createElement("textarea");
  textarea.style.width = "100%";
  textarea.style.height = "60vh";
  textarea.style.fontFamily = "monospace";
  textarea.style.fontSize = "13px";
  textarea.style.padding = "8px";
  textarea.style.border = "1px solid var(--border-color, #ddd)";
  textarea.style.borderRadius = "4px";
  // textarea.style.background = "var(--bg-color, #1e1e1e)";
  // textarea.style.color = "var(--text-color, #ddd)";
  textarea.style.resize = "vertical";
  textarea.style.whiteSpace = "pre";
  textarea.style.tabSize = "2";

  try {
    const content = await invoke("read_file", { path: entry.path });
    textarea.value = content;
  } catch (err) {
    showToast("error", "Erreur lors de la lecture du fichier : " + err);
    return;
  }

  body.appendChild(textarea);

  openModal({
    title: `Édition brute — ${entry.path.split('/').pop()}`,
    body: body,
    width: "80%",
    buttons: [
      { label: "Annuler", primary: false, onClick: (close) => close() },
      { label: "Enregistrer", primary: true, onClick: async (close) => {
        try {
          await invoke("save_file", { path: entry.path, content: textarea.value });
          showToast("success", "Fichier enregistré.");
          close();
        } catch (err) {
          showToast("error", "Erreur lors de l'enregistrement : " + err);
        }
      }}
    ],
  });
}

async function deleteBibliographyEntry(entryId) {
    const confirmed = await showConfirm({
        title: "Supprimer l'entrée",
        message: "Êtes-vous sûr de vouloir supprimer cette bibliographie ? Cette action est irréversible.",
    });
    if (confirmed) {
        await invoke('delete_bibliography_entry', { id: entryId });
        closeBibliography();
        showToast("success", "Bibliographie supprimée.");
        openBibliography();
    };
}