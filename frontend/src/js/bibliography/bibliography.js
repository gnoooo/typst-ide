

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
    const empty = document.createElement('p');
    empty.style.color = 'var(--text-muted)';
    empty.textContent = filterText ? t('bib.no_results') : t('bib.no_entries');
    container.replaceChildren(empty);
    return;
  }

  filtered.forEach(entry => {
    const entryEl = document.createElement('div');
    entryEl.className = 'bibliography-entry';

    const row = document.createElement('div');
    row.className = 'flex gap-2';

    const mainBtn = document.createElement('button');
    mainBtn.className = 'bibliography-entry-btn';
    mainBtn.id = `bibliography-${entry.title}`;
    const titleDiv = document.createElement('div');
    titleDiv.className = 'bibliography-entry-btn-title';
    titleDiv.textContent = String(entry.title ?? '');
    mainBtn.appendChild(titleDiv);
    row.appendChild(mainBtn);

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-1 ml-2';
    for (const [suffix, icon] of [
      ['delete-bibliography-entry-btn', 'delete'],
      ['edit-bibliography-entry-btn',   'edit'],
      ['raw-bibliography-entry-btn',   'code'],
    ]) {
      const btn = document.createElement('button');
      btn.className = `action-btn ${suffix} self-center`;
      btn.id = `${suffix.replace('-bibliography-entry-btn', '')}-${entry.title}`;
      const span = document.createElement('span');
      span.className = `material-symbols-outlined ${suffix}-icon`;
      span.textContent = icon;
      btn.appendChild(span);
      actions.appendChild(btn);
    }
    row.appendChild(actions);

    entryEl.appendChild(row);

    attachBibliographyListeners(entryEl, entry);
    container.appendChild(entryEl);
  });
}

async function createBibliography() {
  const body = document.createElement('div');
  body.className = 'bibliography-entry-form';

  const wrap = document.createElement('div');
  const titleP = document.createElement('p');
  titleP.id = 'bibliography-entry-title';
  titleP.textContent = t('bib.title_label');
  wrap.appendChild(titleP);

  const titleInput = document.createElement('input');
  titleInput.id = 'bibliography-entry-title-input';
  titleInput.type = 'text';
  titleInput.placeholder = t('bib.title_placeholder');
  titleInput.style.width = '100%';
  titleInput.required = true;
  wrap.appendChild(titleInput);
  body.appendChild(wrap);

  openModal({
    title: t('bib.add_title'),
    body: body,
    width: '50%',
    buttons: [
      { label: t('modal.cancel'), primary: false, onClick: (close) => close() },
      { label: t('modal.add'), primary: true, onClick: async (close) => {
        const title = titleInput.value;
        const projectPath = getCurrentProject()?.path;
        if (!projectPath) {
          showToast('error', t('bib.no_project'));
          return;
        }
        const filepath = `${projectPath}/${title}.bib`;

        try {
          const created = await invoke('create_bib_file_if_missing', { filepath });
          if (!created) {
            showToast('error', t('bib.create_file_error'));
          } else {
            showToast('success', t('bib.created'));
            close();
          }
        } catch (err) {
          showToast('error', t('bib.create_error', { error: err }));
        }
      }}
    ]
  });
}



function attachBibliographyListeners(entryEl, entry) {
  const mainBtn = entryEl.querySelector('.bibliography-entry-btn');
  mainBtn?.addEventListener("click", async () => {
    await openSources(entry.path);
  })

  const deleteBtn = entryEl.querySelector('.delete-bibliography-entry-btn');
  deleteBtn?.addEventListener('click', () => deleteBibliographyEntry(entry));

  const editBtn = entryEl.querySelector('.edit-bibliography-entry-btn');
  editBtn?.addEventListener('click', () => editBibliographyEntry(entry));

  const rawtBtn = entryEl.querySelector('.raw-bibliography-entry-btn');
  rawtBtn?.addEventListener('click', () => rawBibliographyEntry(entry));
}

async function fetchBibEntries() {
  const files = await invoke("get_project_bibliographies", { projectPath: getCurrentProject()?.path });
  _bibEntries = files.map(f => ({ title: f.title, path: f.path }));
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
    const body = document.createElement('div');
    body.className = 'bibliography-entry-form';

    const wrap = document.createElement('div');
    const titleP = document.createElement('p');
    titleP.id = 'bibliography-entry-title';
    titleP.textContent = t('bib.title_label');
    wrap.appendChild(titleP);

    const titleInput = document.createElement('input');
    titleInput.id = 'bibliography-entry-title-input';
    titleInput.type = 'text';
    titleInput.placeholder = t('bib.title_placeholder');
    titleInput.style.width = '100%';
    titleInput.value = String(entry.title ?? ''); // was: `value="${entry.title}"` — attribute injection vector
    titleInput.required = true;
    wrap.appendChild(titleInput);
    body.appendChild(wrap);

  openModal({
    title: t('bib.edit_title'),
    body: body,
    width: '50%',
    buttons: [
      { label: t('modal.cancel'), primary: false, onClick: (close) => close() },
      { label: t('modal.edit'), primary: true, onClick: async (close) => {
        const newTitle = titleInput.value;

        try {
          const projectPath = getCurrentProject()?.path;
          if (!projectPath) {
            showToast("error", t('bib.no_project'));
            return;
          }
          const oldPath = entry.path;
          const newPath = `${projectPath}/${newTitle}.bib`;

          if (newTitle !== entry.title) {
            await invoke("rename_file", { oldPath: oldPath, newPath: newPath, projectRoot: projectPath });
          }

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
    const projectRoot = getCurrentProject()?.path ?? null;
    const content = await invoke("read_file", { path: entry.path, projectRoot });
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
          await invoke("save_file", { path: entry.path, content: textarea.value, projectRoot: getCurrentProject()?.path ?? null });
          showToast("success", t('bib.file_saved'));
          close();
        } catch (err) {
          showToast("error", t('bib.file_save_error', { error: err }));
        }
      }}
    ],
  });
}

async function deleteBibliographyEntry(entry) {
    const confirmed = await showConfirm({
        title: t('bib.delete_title'),
        message: t('bib.delete_message'),
    });
    if (confirmed) {
        try {
            await invoke('delete_file_or_dir', { path: entry.path, projectRoot: getCurrentProject()?.path ?? null });
            showToast("success", t('bib.deleted'));
        } catch (err) {
            showToast("error", t('bib.delete_error', { error: err }));
            return;
        }
        closeBibliography();
        openBibliography();
    };
}
