

const { invoke } = window.__TAURI__.core;
import { t } from '../../i18n/index.js';

import { openModal, showConfirm } from "../modal.js";
import { showToast } from '../toast.js';
import { getCurrentProject } from "../project.js";
import { openSources, addNewSource } from "./sources.js";

let _bibEntries = [];
let _bibContainer = null;

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
  input.placeholder = t('bib.search');
  input.style.flex = "1";
  input.style.border = "none";
  input.style.background = "transparent";
  input.style.color = "var(--text)";
  input.style.outline = "none";
  input.style.fontSize = "13px";
  container.appendChild(input);

  input.addEventListener("input", () => {
    const text = input.value.trim().toLowerCase();
    rebuildBibList(text);
  });

  return container;
}

function rebuildBibList(filterText) {
  const container = _bibContainer;
  if (!container) return;

  container.innerHTML = "";
  const filtered = filterText
    ? _bibEntries.filter(e => e.title.toLowerCase().includes(filterText))
    : _bibEntries;

  if (filtered.length === 0) {
    container.innerHTML = filterText
      ? `<p style="color:var(--text-muted)">${t('bib.no_results')}</p>`
      : `<p style="color:var(--text-muted)">${t('bib.no_entries')}</p>`;
    return;
  }

  filtered.forEach(entry => {
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
}

async function createBibliography() {
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="bibliography-entry-form">
        <div>
          <p id="bibliography-entry-title">${t('bib.title_label')}</p>
          <input id="bibliography-entry-title-input" type="text" placeholder="${t('bib.title_placeholder')}" style="width:100%;" required/>
        </div>

        <div class="flex gap-2 items-center">
          <input id="bibliography-entry-full-input" type="checkbox" value="full" required/>
          <label id="bibliography-entry-full">${t('bib.full_checkbox')}</label>
        </div>

        <div>
          <p id="bibliography-entry-style">${t('bib.style_label')}</p>
          <select id="bibliography-entry-style-input" style="width:100%;" required>
            <option value="ieee" selected>IEEE</option>
          </select>
        </div>
    </div>
  `;
  openModal({
    title: t('bib.add_title'),
    body: body,
    width: "50%",
    buttons: [
      { label: t('modal.cancel'), primary: false, onclick: (close) => close() },
      { label: t('modal.add'), primary: true, onClick: async (close) => {
        const title = body.querySelector("#bibliography-entry-title-input").value;
        const projectPath = getCurrentProject().path;
        const filepath = `${projectPath}/${title}.bib`;
        const full = body.querySelector("#bibliography-entry-full-input").checked ? true : false;
        const style = body.querySelector("#bibliography-entry-style-input").value;

        try {
          const created = await invoke("create_bib_file_if_missing", { filepath });
          let inserted = false;
          if (!created) {
            showToast("error", t('bib.create_file_error'));
            return;
          } else {
            inserted = await invoke("add_bibliography_entry", { title, path: filepath, projectPath, full, style })
          }

          if (inserted) {
            showToast("success", t('bib.created'));
            close();
          } else {
            showToast("error", t('bib.exists'));
          }
        } catch (err) {
          showToast("error", t('bib.create_error', { error: err }));
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

async function fetchBibEntries() {
  await invoke("synchronize_bibliography_entries", { projectpath: getCurrentProject()?.path });
  _bibEntries = await invoke("get_bibliography", { projectPath: getCurrentProject()?.path });
}

export async function openBibliography() {
  if (!getCurrentProject()) {
    showToast("warning", t('bib.no_project'));
    return;
  }

  await fetchBibEntries();

  const body = document.createElement("div");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "8px";

  body.appendChild(createSearchBar());

  const listContainer = document.createElement("div");
  listContainer.id = "bib-list-container";
  _bibContainer = listContainer;
  body.appendChild(listContainer);

  rebuildBibList("");

  openModal({
    title: t('bib.title'),
    body: body,
    width: window.innerWidth < 1000 ? "75%" : "50%",
    buttons: [
      { label: t('modal.close_all'), primary: true, onClick: (close, closeAll) => closeAll() },
      { label: t('bib.add_title'), primary: false, onClick: async (close) => {
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
          <p id="bibliography-entry-title">${t('bib.title_label')}</p>
          <input id="bibliography-entry-title-input" type="text" placeholder="${t('bib.title_placeholder')}" style="width:100%;" value="${entry.title}" required/>
        </div>

        <div class="flex gap-2 items-center">
          <input id="bibliography-entry-full-input" type="checkbox" value="full" ${entry.full ? 'checked' : ''}/>
          <label id="bibliography-entry-full">${t('bib.full_checkbox')}</label>
        </div>

        <div>
          <p id="bibliography-entry-style">${t('bib.style_label')}</p>
          <input id="bibliography-entry-style-input" type="text" placeholder="${t('bib.style_placeholder')}" style="width:100%;" value="${entry.style}" required/>
        </div>
    </div>
  `;
  openModal({
    title: t('bib.edit_title'),
    body: body,
    width: "50%",
    buttons: [
      { label: t('modal.cancel'), primary: false, onClick: (close) => close() },
      { label: t('modal.edit'), primary: true, onClick: async (close) => {
        const newTitle = body.querySelector("#bibliography-entry-title-input").value;
        const full = body.querySelector("#bibliography-entry-full-input").checked ? true : false;
        const style = body.querySelector("#bibliography-entry-style-input").value;

        try {
          const projectPath = getCurrentProject().path;
          const oldPath = entry.path;
          const newPath = `${projectPath}/${newTitle}.bib`;

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

          showToast("success", t('bib.updated'));
          close();
        } catch (err) {
          showToast("error", t('bib.update_error', { error: err }));
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
  textarea.style.resize = "vertical";
  textarea.style.whiteSpace = "pre";
  textarea.style.tabSize = "2";

  try {
    const content = await invoke("read_file", { path: entry.path });
    textarea.value = content;
  } catch (err) {
    showToast("error", t('bib.read_error', { error: err }));
    return;
  }

  body.appendChild(textarea);

  openModal({
    title: t('bib.raw_edit_title', { name: entry.path.split('/').pop() }),
    body: body,
    width: "80%",
    buttons: [
      { label: t('modal.cancel'), primary: false, onClick: (close) => close() },
      { label: t('modal.save'), primary: true, onClick: async (close) => {
        try {
          await invoke("save_file", { path: entry.path, content: textarea.value });
          showToast("success", t('bib.file_saved'));
          close();
        } catch (err) {
          showToast("error", t('bib.file_save_error', { error: err }));
        }
      }}
    ],
  });
}

async function deleteBibliographyEntry(entryId) {
    const confirmed = await showConfirm({
        title: t('bib.delete_title'),
        message: t('bib.delete_message'),
    });
    if (confirmed) {
        await invoke('delete_bibliography_entry', { id: entryId });
        closeBibliography();
        showToast("success", t('bib.deleted'));
        openBibliography();
    };
}
