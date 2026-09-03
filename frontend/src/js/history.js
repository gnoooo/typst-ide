

const { invoke } = window.__TAURI__.core;


import { t, getLang } from '../i18n/index.js'
import { openModal, showConfirm } from './modal.js';
import { getCurrentFontFamily } from './editor.js';
import { showToast } from './toast.js';
import { openProjectFromPath } from './project.js';

let _historyEntries = [];
let _historyContainer = null;

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
  input.placeholder = t('history.search');
  input.style.flex = "1";
  input.style.border = "none";
  input.style.background = "transparent";
  input.style.color = "var(--text)";
  input.style.outline = "none";
  input.style.fontSize = "13px";
  container.appendChild(input);

  input.addEventListener("input", () => {
    const text = input.value.trim().toLowerCase();
    rebuildHistoryList(text);
  });

  return container;
}

function rebuildHistoryList(filterText) {
  const container = _historyContainer;
  if (!container) return;

  container.innerHTML = "";
  const filtered = filterText
    ? _historyEntries.filter(e =>
        e.name.toLowerCase().includes(filterText) ||
        e.path.toLowerCase().includes(filterText)
      )
    : _historyEntries;

  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.style.color = 'var(--text-muted)';
    empty.textContent = filterText ? t('history.no_results') : t('history.no_history');
    container.replaceChildren(empty);
    return;
  }

  filtered.forEach(entry => {
    const entryEl = document.createElement('div');
    entryEl.className = 'history-entry';

    const wrapper = document.createElement('span');
    wrapper.className = 'flex gap-2';

    const mainBtn = document.createElement('button');
    mainBtn.className = 'history-entry-btn';
    mainBtn.id = `history-${entry.id}`;

    const titleDiv = document.createElement('div');
    titleDiv.className = 'history-entry-btn-title';
    titleDiv.textContent = String(entry.name ?? '');
    mainBtn.appendChild(titleDiv);

    const pathDiv = document.createElement('div');
    pathDiv.className = 'history-entry-btn-content';
    pathDiv.style.fontFamily = getCurrentFontFamily();
    pathDiv.textContent = String(entry.path ?? '');
    mainBtn.appendChild(pathDiv);

    wrapper.appendChild(mainBtn);

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-1';
    for (const [suffix, icon] of [
      ['delete-history-entry-btn', 'delete'],
      ['edit-history-entry-btn',   'edit'],
      ['view-history-entry-btn',   'visibility'],
    ]) {
      const btn = document.createElement('button');
      btn.className = `action-btn ${suffix}`;
      // Keep `id` for backwards compatibility with anyone querying by ID.
      btn.id = `${suffix.replace('-history-entry-btn', '')}-${entry.id}`;
      const span = document.createElement('span');
      span.className = `material-symbols-outlined ${suffix}-icon`;
      span.textContent = icon;
      btn.appendChild(span);
      actions.appendChild(btn);
    }
    wrapper.appendChild(actions);

    entryEl.appendChild(wrapper);

    attachHistoryEntryListeners(entryEl, entry);
    container.appendChild(entryEl);
  });
}

async function createHistoryEntry() {
    const body = document.createElement('div');
    body.className = 'history-entry-form';

    const nameP = document.createElement('p');
    nameP.id = 'history-entry-name';
    nameP.textContent = t('history.select_path');
    body.appendChild(nameP);

    const folderBtn = document.createElement('button');
    folderBtn.id = 'history-entry-path-btn';
    folderBtn.className = 'ide-button tool-btn';
    folderBtn.textContent = t('modal.choose_folder');
    body.appendChild(folderBtn);

    const wrap = document.createElement('div');
    const sub = document.createElement('sub');
    sub.className = 'history-entry-path';
    const input = document.createElement('input');
    input.id = 'history-entry-path-input';
    input.type = 'text';
    input.placeholder = t('history.no_path');
    input.style.width = '100%';
    sub.appendChild(input);
    wrap.appendChild(sub);
    body.appendChild(wrap);

    let path;
    folderBtn.addEventListener('click', async () => {
        path = await invoke('open_folder_dialog');
        if (path) input.value = path;
    });

    openModal({
        title: t('history.add_title'),
        body: body,
        width: '50%',
        buttons: [
            { label: t('modal.cancel'),    primary: false, onClick: (c) => c() },
            { label: t('modal.add'), primary: true,  onClick: async (c) => {
                if (!path) return;

                const name = path.split(/[/\\]/).pop();
                if (!name || !path) {
                    showToast("error", t('history.invalid_path'));
                    return;
                }

                try {
                    const inserted = await invoke('add_history_entry', { name, path });
                    if (inserted) {
                        showToast("success", t('history.added'));
                        c();
                    } else {
                        showToast("error", t('history.exists'));
                    }
                } catch (err) {
                    showToast("error", t('history.add_error', { error: err }));
                }
            }}
        ],
    });
}

async function deleteHistoryEntry(entryId) {
    const confirmed = await showConfirm({
        title: t('history.delete_title'),
        message: t('history.delete_message'),
    });
    if (confirmed) {
        await invoke('delete_history_entry', { id: entryId });
        closeHistory();
        showToast("success", t('history.deleted'));
        openHistory();
    };
}

async function editHistoryEntry(entry) {
    const body = document.createElement('div');
    body.className = 'history-entry-form';

    const nameP = document.createElement('p');
    nameP.id = 'history-entry-name';
    nameP.textContent = t('history.select_path');
    body.appendChild(nameP);

    const folderBtn = document.createElement('button');
    folderBtn.id = 'history-entry-path-btn';
    folderBtn.className = 'ide-button tool-btn';
    folderBtn.textContent = t('modal.choose_folder');
    body.appendChild(folderBtn);

    const wrap = document.createElement('div');
    const sub = document.createElement('sub');
    sub.className = 'history-entry-path';
    const input = document.createElement('input');
    input.id = 'history-entry-path-input';
    input.type = 'text';
    input.value = String(entry.path ?? '');
    input.placeholder = t('history.no_path');
    input.style.width = '100%';
    sub.appendChild(input);
    wrap.appendChild(sub);
    body.appendChild(wrap);

    let newPath;
    folderBtn.addEventListener('click', async () => {
        newPath = await invoke('open_folder_dialog');
        if (newPath) input.value = newPath;
    });

    openModal({
        title: t('history.edit_title'),
        body: body,
        width: '50%',
        buttons: [
            { label: t('modal.cancel'),    primary: false, onClick: (c) => c() },
            { label: t('modal.save'), primary: true,  onClick: async (close) => {
                const newName = body.querySelector('#history-entry-path-input').value.trim();
                if (!newName || !newPath) {
                    showToast("error", t('history.empty_fields'));
                    return;
                }
                try {
                    await invoke('update_history_entry', {
                        id: entry.id,
                        name: newName,
                        path: newPath
                    });
                    showToast("success", t('history.updated'));
                    close();
                    closeHistory();
                    openHistory();
                } catch (err) {
                    showToast("error", t('history.update_error', { error: err }));
                }
            }}
        ],
    });
}

async function viewHistoryEntry(entry) {
    const locale = getLang() === 'fr' ? 'fr-FR' : 'en-US'
    const createdAt = new Date(entry.created_at);
    const createdAtDate = createdAt.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    const createdAtTime = createdAt.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
    });
    const updatedAt = new Date(entry.updated_at);
    const updatedAtDate = updatedAt.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    const updatedAtTime = updatedAt.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
    });

    let content;
    try {
      const info = await invoke('open_project', { dirPath: entry.path });
      content = info.content;
    } catch (err) {
      content = t('history.preview_unreadable', { error: err });
    }

    const meta = document.createElement('div');
    meta.id = 'note-preview-metadata';
    const pathLine = document.createElement('p');
    pathLine.textContent = t('history.path_label', { path: entry.path });
    const nameLine = document.createElement('p');
    nameLine.textContent = t('history.name_label', { name: entry.name });
    const createdLine = document.createElement('p');
    createdLine.textContent = t('notepad.created_at', { date: createdAtDate, time: createdAtTime });
    const updatedLine = document.createElement('p');
    updatedLine.textContent = t('notepad.updated_at', { date: updatedAtDate, time: updatedAtTime });
    meta.appendChild(pathLine);
    meta.appendChild(nameLine);
    meta.appendChild(createdLine);
    meta.appendChild(updatedLine);

    // PREVIEW: render the project main file content as PLAIN TEXT (escaped),
    // not as HTML. The previous innerHTML sink executed arbitrary `<script>`
    // inside a project file as soon as the user clicked the eye icon in the
    // history list (see SECURITY audit: S1).
    const contentDiv = document.createElement('div');
    contentDiv.id = 'note-preview-content';
    contentDiv.style.fontFamily = getCurrentFontFamily();
    contentDiv.textContent = String(content ?? '');

    const body = document.createElement('div');
    body.appendChild(meta);
    body.appendChild(contentDiv);

    openModal({
        title: t('history.preview_title'),
        body: body,
        width: '75%',
        buttons: [],
    });
}

async function openProject(entry) {
    await openProjectFromPath(entry.path, (content) => {
        const editor = window.__typstEditor;
        if (editor) editor.setValue(content);
    });
    closeHistory();
}

function attachHistoryEntryListeners(entryEl, entry) {
    const entryHistoryBtn = entryEl.querySelector(`#history-${entry.id}`);
    entryHistoryBtn?.addEventListener('click', async () => await openProject(entry));

    const deleteBtn = entryEl.querySelector('.delete-history-entry-btn');
    deleteBtn?.addEventListener('click', () => deleteHistoryEntry(entry.id));

    const editBtn = entryEl.querySelector('.edit-history-entry-btn');
    editBtn?.addEventListener('click', () => editHistoryEntry(entry));

    const viewBtn = entryEl.querySelector('.view-history-entry-btn');
    viewBtn?.addEventListener('click', () => viewHistoryEntry(entry));
}

export async function openHistory() {
    _historyEntries = await invoke('get_history');

    const body = document.createElement('div');
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.gap = "8px";

    body.appendChild(createSearchBar());

    const listContainer = document.createElement('div');
    listContainer.id = "history-list-container";
    _historyContainer = listContainer;
    body.appendChild(listContainer);

    rebuildHistoryList("");

    openModal({
        title: t('history.title'),
        body: body,
        width: window.innerWidth < 1000 ? '75%' : '50%',
        buttons: [
            { label: t('modal.close_all'), primary: true, onClick: (close, closeAll) => closeAll() },
            { label: t('history.add_title'), primary: false, onClick: async (c) => {
                await createHistoryEntry();
                c();
            }},
        ],
    });
}

function closeHistory() {
    const overlay = document.querySelector('.ide-modal-overlay');
    if (overlay) overlay.remove();
}
