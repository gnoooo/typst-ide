/**
 * notepad.js
 *  notepad functionalities
 *
 * ## API
 *
 * createNote(scope) -> void
 *  * scope: 'global' | 'project'
 *  * Opens the note creation modal
 *  * If `scope` is provided, it will be the default scope for the new note
 *
 * insertNote(content) -> void
 *  * content: string of the note to insert
 *  * Inserts the given content at the current cursor position in the editor
 *
 * deleteNote(noteId) -> void
 *  * noteId: string ID of the note to delete
 *  * Deletes the note with the given ID after user confirmation
 *
 * editNote(note) -> void
 *  * note: { id, title, content, scope, created_at, updated_at }
 *  * Opens the note editing modal pre-filled with the note's current data
 *
 * viewNote(note) -> void
 *  * note: { id, title, content, scope, created_at, updated_at }
 *  * Opens a read-only modal to view the note's content and metadata
 *
 * openNotesList() -> HTMLElement
 *  * Returns a DOM element containing the list of all notes (both global and project-specific)
 *
 * openNotepad() -> void
 *  * Opens a modal displaying all notes with options to add, edit, delete, and insert them
 */
const { invoke } = window.__TAURI__.core;

import { t, getLang } from '../i18n/index.js'
import { openModal, showPrompt, showConfirm } from './modal.js';
import { getCurrentFontFamily, getEditor } from './editor.js';
import { getCurrentProject } from './project.js';

let _globalNotes = [];
let _projectNotes = [];
let _notesContainer = null;

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
  input.placeholder = t('notepad.search');
  input.style.flex = "1";
  input.style.border = "none";
  input.style.background = "transparent";
  input.style.color = "var(--text)";
  input.style.outline = "none";
  input.style.fontSize = "13px";
  container.appendChild(input);

  input.addEventListener("input", () => {
    const text = input.value.trim().toLowerCase();
    rebuildNotesList(text);
  });

  return container;
}

function rebuildNotesList(filterText) {
  const container = _notesContainer;
  if (!container) return;

  container.innerHTML = "";

  const filterNote = (note) => !filterText ||
    note.title.toLowerCase().includes(filterText) ||
    note.content.toLowerCase().includes(filterText);

  const hasGlobal = _globalNotes.some(filterNote);
  const hasProject = _projectNotes.some(filterNote);

  if (!hasGlobal && !hasProject) {
    container.innerHTML = filterText
      ? `<p style="color:var(--text-muted)">${t('notepad.no_results')}</p>`
      : `<p>${t('notepad.no_notes')}</p>`;
    return;
  }

  if (hasGlobal) {
    const globalTitle = document.createElement('h2');
    globalTitle.textContent = t('notepad.global_notes');
    globalTitle.style.fontSize = '1rem';
    globalTitle.style.fontWeight = 'bold';
    container.appendChild(globalTitle);
    _globalNotes.filter(filterNote).forEach(note => {
      const noteEl = buildNoteElement(note);
      attachNoteListeners(noteEl, note);
      container.appendChild(noteEl);
    });
  }

  if (hasProject) {
    const projectTitle = document.createElement('h2');
    projectTitle.textContent = t('notepad.project_notes');
    projectTitle.style.fontSize = '1rem';
    projectTitle.style.fontWeight = 'bold';
    container.appendChild(projectTitle);
    _projectNotes.filter(filterNote).forEach(note => {
      const noteEl = buildNoteElement(note);
      attachNoteListeners(noteEl, note);
      container.appendChild(noteEl);
    });
  }
}

function buildNoteElement(note) {
  const noteEl = document.createElement('div');
  noteEl.className = 'note-item';
  noteEl.innerHTML = `
<span class="flex gap-2">
    <button class="note-btn" id="note-${note.id}">
        <div class="note-btn-title">${note.title}</div>
        <div class="note-btn-content" style="font-family: ${getCurrentFontFamily()};">${note.content}</div>
    </button>
    <div class="flex items-center gap-1">
        <button class="action-btn delete-note-btn" id="delete-${note.id}">
            <span class="material-symbols-outlined delete-note-icon">delete</span>
        </button>
        <button class="action-btn edit-note-btn" id="edit-${note.id}">
            <span class="material-symbols-outlined edit-note-icon">edit</span>
        </button>
        <button class="action-btn view-note-btn" id="view-${note.id}">
            <span class="material-symbols-outlined view-note-icon">visibility</span>
        </button>
    </div>
</span>
  `;
  return noteEl;
}

/**
 * Open the note creation modal
 */
function createNote(scope='project') {
    const body = document.createElement('div');
    body.innerHTML = `
<input type="text" placeholder="${t('notepad.note_title')}" style="width:100%;margin-bottom:0.5rem;padding:0.5rem;font-size:1rem;" />
<label for="scope">${t('notepad.scope_label')}</label>
<select name="scope" style="width:100%;margin-bottom:0.5rem;padding:0.5rem;font-size:1rem;">
    <option value="global" ${scope === 'global' ? 'selected' : ''}>${t('notepad.scope_global')}</option>
    <option value="project" ${scope === 'project' ? 'selected' : ''}>${t('notepad.scope_project')}</option>
</select>
<textarea placeholder="${t('notepad.note_content')}" style="width:100%;height:150px;padding:0.5rem;font-size:1rem;"/>
    `;
    openModal({
        title: t('notepad.add_note'),
        body: body,
        width: '75%',
        buttons: [
            { label: t('modal.add'), primary: true, onClick: async (close) => {
                const title = body.querySelector('input')?.value.trim();
                const text = body.querySelector('textarea')?.value.trim();
                const scope = body.querySelector('select')?.value;

                if (title && text) {
                    let project_id;
                    if (scope == 'project'){
                        if (!getCurrentProject()) {
                            showToast("warning", t('notepad.no_project'));
                            return;
                        }
                        project_id = await invoke('get_current_project_id', { projectPath: getCurrentProject().path });
                    } else {
                        project_id = null;
                    }
                    invoke('add_note', { title, content: text, scope, projectId: project_id });
                    close();
                }
            }}
        ]
    });
}

function insertNote(content) {
    const editor = getEditor();
    if (editor) {
        const selection = editor.getSelection();
        if (selection) {
            editor.executeEdits(null, [
                {
                    range: selection,
                    text: content,
                    forceMoveMarkers: true
                }
            ]);
        }
    }
    closeNotepad();
}

async function deleteNote(noteId) {
    const confirmed = await showConfirm({
        title: t('notepad.delete_title'),
        message: t('notepad.delete_message'),
        confirmLabel: t('modal.delete'),
        cancelLabel: t('modal.cancel')
    });

    if (confirmed) {
        await invoke('delete_note', { noteId });
        closeNotepad();
        openNotepad(); // Refresh the notepad
    }
}

async function editNote(note) {
    const body = document.createElement('div');
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.height = '100%';
    body.innerHTML = `
<input type="text" placeholder="${t('notepad.note_title')}" value="${note.title}" style="width:100%;margin-bottom:0.5rem;padding:0.5rem;font-size:1rem;border:1px solid #cecece;border-radius:6px;" />
<label for="scope">${t('notepad.scope_label')}</label>
<select name="scope" style="width:100%;margin-bottom:0.5rem;padding:0.5rem;font-size:1rem;">
    <option value="global" ${note.scope === 'global' ? 'selected' : ''}>${t('notepad.scope_global')}</option>
    <option value="project" ${note.scope === 'project' ? 'selected' : ''}>${t('notepad.scope_project')}</option>
</select>
<textarea placeholder="${t('notepad.note_content')}" style="flex:1;width:100%;padding:0.5rem;font-size:1rem;border:1px solid #cecece;border-radius:6px;font-family:${getCurrentFontFamily()};">${note.content}</textarea>
    `;
    openModal({
        title: t('notepad.edit_note'),
        body: body,
        width: '75%',
        height: '75%',
        buttons: [
            { label: t('modal.save'), primary: true, onClick: async (close) => {
                const title = body.querySelector('input')?.value.trim();
                const text = body.querySelector('textarea')?.value.trim();
                const scope = body.querySelector('select')?.value;

                if (title && text) {
                    let project_id;
                    if (scope == 'project'){
                        project_id = await invoke('get_current_project_id', { projectPath: getCurrentProject()?.path });
                    } else {
                        project_id = null;
                    }
                    invoke('update_note', {
                        noteId: note.id,
                        title,
                        content: text,
                        scope,
                        projectId: project_id
                    });
                    close();
                    closeNotepad();
                    openNotepad(); // Refresh the notepad
                }
            }}
        ]
    });
}

function viewNote(note) {
    const locale = getLang() === 'fr' ? 'fr-FR' : 'en-US'
    const createdAt = new Date(note.created_at)
    const createdAtDate = createdAt.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    const createdAtTime = createdAt.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
    });
    const updatedAt = new Date(note.updated_at)
    const updatedAtDate = updatedAt.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    const updatedAtTime = updatedAt.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
    });
    const scopeLabel = note.scope === 'global' ? t('notepad.scope_global_label') : t('notepad.scope_project_label')

    const body = document.createElement('div');
    body.innerHTML = `
<div id="note-preview-metadata">
    <p>${t('notepad.created_at', { date: createdAtDate, time: createdAtTime })}</p>
    <p>${t('notepad.updated_at', { date: updatedAtDate, time: updatedAtTime })}</p>
    <p>${t('notepad.scope_info', { scope: scopeLabel })}</p>
</div>
<div id="note-preview-content" style="font-family:${getCurrentFontFamily()};">${note.content}</div>
    `;
    openModal({
        title: note.title,
        body,
        width: '75%',
        buttons: [],
    });
}

function attachNoteListeners(noteEl, note) {
    const noteBtn = noteEl.querySelector(`#note-${note.id}`);
    noteBtn.addEventListener('click', () => insertNote(note.content));

    const deleteBtn = noteEl.querySelector(`#delete-${note.id}`);
    deleteBtn.addEventListener('click', () => deleteNote(note.id));

    const editBtn = noteEl.querySelector(`#edit-${note.id}`);
    editBtn.addEventListener('click', () => editNote(note));

    const viewBtn = noteEl.querySelector(`#view-${note.id}`);
    viewBtn.addEventListener('click', () => viewNote(note));
}

/**
 * Open a modal to show all the notes
 */
export async function openNotepad() {
    _globalNotes = await invoke('get_global_notes');
    _projectNotes = [];
    const currentProject = getCurrentProject();
    if (currentProject !== null) {
        _projectNotes = await invoke('get_project_notes', { projectPath: currentProject.path });
    }

    const body = document.createElement('div');
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.gap = "8px";

    body.appendChild(createSearchBar());

    const listContainer = document.createElement('div');
    listContainer.id = "notes-list-container";
    _notesContainer = listContainer;
    body.appendChild(listContainer);

    rebuildNotesList("");

    openModal({
        title: t('notepad.title'),
        body: body,
        width: window.innerWidth < 1000 ? '75%' : '50%',
        buttons: [
            { label: t('notepad.add_note'), primary: true, onClick: (close) => {
                close();
                createNote();
            }}
        ]
    });
}

function closeNotepad() {
    const overlay = document.querySelector('.ide-modal-overlay');
    if (overlay) overlay.remove();
}
