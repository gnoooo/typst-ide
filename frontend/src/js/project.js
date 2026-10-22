/**
 * Project management module
 *
 * Handles creating and opening Typst projects via Tauri commands,
 * saving to disk, and exposing the current project state to the app
 */

import { t } from '../i18n/index.js'
import { showToast } from './toast.js';
import { showPrompt } from './modal.js';

const { invoke } = window.__TAURI__.core;

// ## Current project state ########################################

/** @type {{ name: string, path: string, typFile: string } | null} */
let currentProject = null;

/** Listeners called when a project is loaded/changed */
const onChangeListeners = [];

export function onProjectChange(fn) {
    onChangeListeners.push(fn);
}

function notifyChange() {
    onChangeListeners.forEach(fn => fn(currentProject));
}

export function getCurrentProject() {
    return currentProject;
}

/** Content autosaved while no project was open, or null when there is none. */
export async function readDraft() {
    try {
        return await invoke('read_file', { path: await draftFilePath() });
    } catch {
        return null; // read_file rejects while the draft file doesn't exist yet
    }
}

// ## History #######################################################

// function addToHistory(project) {
//     projectHistory = projectHistory.filter(p => p.path !== project.path);
//     projectHistory.unshift({ name: project.name, path: project.path, lastOpened: new Date().toISOString() });
//     if (projectHistory.length > 20) projectHistory.length = 20;
//     localStorage.setItem('project-history', JSON.stringify(projectHistory));
// }

// export function getProjectHistory() {
//     return projectHistory;
// }

// ## Save ##########################################################

let saveTimer = null;
let pendingSave = false;
/** @type {(() => string)|null} */
let _pendingContentGetter = null;

/**
 * Schedule an autosave (debounced, 800 ms).
 * Accepts a getter function instead of the content string so that
 * editor.getValue() is deferred to when the debounce actually fires.
 * This prevents a full-buffer serialization on every keystroke.
 * @param {(() => string)|string} contentOrGetter - Content getter or content string
 */
export function scheduleAutosave(contentOrGetter) {
    pendingSave = true;
    _pendingContentGetter = typeof contentOrGetter === 'function'
        ? contentOrGetter
        : () => contentOrGetter;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const content = _pendingContentGetter?.();
        _pendingContentGetter = null;
        if (content != null) flushSave(content);
    }, 800);
}

/**
 * Save immediately whatever the debounce hasn't written yet.
 * Used before switching project, before a page reload and on pagehide,
 * so the last ~800 ms of typing always reach the disk.
 */
export async function flushPendingSave() {
    if (!pendingSave) return;
    clearTimeout(saveTimer);
    const content = _pendingContentGetter?.();
    _pendingContentGetter = null;
    if (content != null) await flushSave(content);
}

// Best-effort save when the window is closed/reloaded: the invoke races the
// webview teardown and may not complete, but it's free to try.
window.addEventListener('pagehide', () => { flushPendingSave(); });

/**
 * Path of the persistent scratch draft, written by the autosave while no project is open (restored by readDraft at startup).
 * app-data is already a whitelisted FS root (allowed_roots), so save_file/read_file accept it.
 */
async function draftFilePath() {
    // No caching: one path call per flush (~800 ms apart) is negligible, and a
    // failure must not become a poisoned cached promise.
    const dir = await window.__TAURI__.path.appDataDir();
    return `${dir}/draft.typ`;
}

async function flushSave(content) {
    const proj = currentProject;
    if (!pendingSave) return;
    // Without a project the scratch content goes to {app-data}/draft.typ instead.
    const filePath = proj ? `${proj.path}/${proj.typFile}` : await draftFilePath();
    try {
        await invoke('save_file', { path: filePath, content });
        // Don't clear a pendingSave scheduled by a newer project while this stale save for the previous one was in flight.
        if (proj ? currentProject === proj : currentProject === null) {
            pendingSave = false;
            notifySaveIndicator(false);
        }
    } catch (err) {
        if (proj) showToast('error', t('project.save_error', { error: err }));
        // Retry on next keystroke via scheduleAutosave (which restarts the debounce).
        // The unsaved indicator stays "unsaved" because pendingSave is still true.
        // A failed draft save stays silent: the content is still in the editor buffer.
    }
}

// ## Save-indicator ################################################
export function unsavedBtnUpdate() {
    // Blink unsaved indicator if the project isn't saved yet
    if (getCurrentProject() === null){
        document.getElementById('unsaved-btn')?.classList.remove('_unsaved-btn-none');
    } else {
        document.getElementById('unsaved-btn')?.classList.add('_unsaved-btn-none');
    }
}


// ## Open indicator ################################################
export function openProjectBtnUpdate() {
    // Blink unsaved indicator if the project isn't saved yet
    const btn = document.getElementById('open-project-btn');
    if (!btn) return;
    if (getCurrentProject() === null){
        // document.getElementById('open-project-btn')?.classList.remove('_open-project-btn-none');
        btn.classList.add("_open-project-blinking");
        btn.classList.add("_open-project-blinking:hover");
    } else {
        // document.getElementById('open-project-btn')?.classList.add('_open-project-btn-none');
        btn.classList.remove("_open-project-blinking");
        btn.classList.remove("_open-project-blinking:hover");
    }
}



let _indicator = null;

function getSaveIndicator() {
    if (!_indicator) _indicator = document.getElementById('save-indicator');
    return _indicator;
}

export function notifySaveIndicator(unsaved) {
    const el = getSaveIndicator();
    if (!el) return;
    if (unsaved) {
        el.textContent = '●';
        el.classList.add('unsaved');
        el.title = t('toolbar.unsaved');
    } else {
        el.textContent = '✓';
        el.classList.remove('unsaved');
        el.title = t('toolbar.saved');
    }
}

// ## Internal: load a project into the app ########################

/**
 * @param {{ name, path, typ_file, content }} info
 * @param {(content: string) => void} setEditorContent
 */
async function loadProject(info, setEditorContent) {
    // Write the previous project's pending autosave first: the editor still
    // holds its content and `flushSave` must capture the old `currentProject`.
    await flushPendingSave();
    // Previous state was project-less: drop the scratch draft once its content has either moved into the
    // new project (createNewProject seeds it with the editor content) or been replaced by opening one,
    // otherwise it would resurrect on the next project-less startup. Awaited right after flushPendingSave(),
    // so the clear cannot race the flush already completed above.
    if (!currentProject) {
        try {
            await invoke('save_file', { path: await draftFilePath(), content: '' });
        } catch {
            /* best-effort: a leftover draft would only resurface as the next startup's restore */
        }
    }
    currentProject = { name: info.name, path: info.path, typFile: info.typ_file };
    sessionStorage.removeItem("pdf-export-path");
    // addToHistory(currentProject);

    // Update UI
    const nameEl = document.getElementById('project-name');
    if (nameEl) nameEl.textContent = info.name;
    const pathEl = document.getElementById('status-project-path');
    if (pathEl) pathEl.textContent = `${info.path}/${info.typ_file}`;
    notifySaveIndicator(false);

    setEditorContent(info.content);
    notifyChange();
    unsavedBtnUpdate();
    openProjectBtnUpdate();
}

// ## Public API ####################################################

const INVALID_NAME = /[<>:"/\\|?*]/;
function validateName(v) {
    return INVALID_NAME.test(v)
        ? t('project.name_invalid')
        : true;
}

/**
 * Create a new project: ask for a name, pick a folder, create dir + main.typ
 * @param {(content: string) => void} setEditorContent
 * @param {string} content
 */
export async function createNewProject(setEditorContent, content = '') {
    const name = await showPrompt({
        title: t('project.new_title'),
        label: t('project.name_label'),
        placeholder: t('project.name_placeholder'),
        validate: validateName,
    });
    if (!name) return;

    const basePath = await invoke('open_folder_dialog');
    if (!basePath) return;

    try {
        const projectPath = await invoke('create_project', { name, basePath, content });
        await loadProject(
            { name, path: projectPath, typ_file: 'main.typ', content: content },
            setEditorContent,
        );
        showToast('success', t('project.created', { name }));
    } catch (err) {
        showToast('error', t('project.create_error', { error: err }));
    }
}

/**
 * Open an existing project by picking a folder
 * @param {(content: string) => void} setEditorContent
 */
export async function openProject(setEditorContent) {
    const dirPath = await invoke('open_folder_dialog');
    if (!dirPath) return;

    try {
        const info = await invoke('open_project', { dirPath });
        await loadProject(info, setEditorContent);
        showToast('success', t('project.opened', { name: info.name }));
    } catch (err) {
        showToast('error', t('project.open_error', { error: err }));
    }
}

export async function openProjectFromPath(dirPath, setEditorContent) {
    try {
        const info = await invoke('open_project', { dirPath });
        await loadProject(info, setEditorContent);
        showToast('success', t('project.opened', { name: info.name }));
        return true;
    } catch (err) {
        showToast('error', t('project.open_error_path', { path: dirPath, error: err }));
        return false;
    }
}
