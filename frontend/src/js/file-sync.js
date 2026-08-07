/**
 * External-change detection for the currently open file.
 *
 * Periodically compares the FNV-1a 64 hash of the file on disk (via the
 * `file_hash` Tauri command) with the hash of the editor's content. When the
 * disk content differs from both the editor and our last known saved state,
 * the file was modified outside this IDE (e.g. in VSCode) — two toolbar
 * buttons appear letting the user either save the editor content over the
 * external changes or reload the disk content.
 */

import { t } from '../i18n/index.js';
import { showConfirm } from './modal.js';
import { showToast } from './toast.js';
import { getEditor } from './editor.js';
import { getCurrentProject, onProjectChange, notifySaveIndicator } from './project.js';

const { invoke } = window.__TAURI__.core;

const POLL_INTERVAL_MS = 2000;

let _lastSavedHash = null;

/**
 * FNV-1a 64-bit hash over UTF-8 bytes of `text`.
 * Matches the Rust implementation in `commands::fs::file_hash`.
 */
function hashText(text) {
    const bytes = new TextEncoder().encode(text);
    let hash = 0xcbf29ce484222325n;
    for (const b of bytes) {
        hash ^= BigInt(b);
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, '0').toLowerCase();
}

function buttons() {
    return {
        group: document.getElementById('file-sync-group'),
        save: document.getElementById('file-sync-save-btn'),
        reload: document.getElementById('file-sync-reload-btn'),
    };
}

/** Toggle visibility of the conflict buttons and their tooltips */
function setButtonsVisible(visible) {
    const { group, save, reload } = buttons();
    if (!group || !save || !reload) return;
    group.hidden = !visible;
    if (visible) {
        save.title = t('filesync.save_title');
        reload.title = t('filesync.reload_title');
    } else {
        save.title = '';
        reload.title = '';
    }
}

function currentFilePath() {
    const project = getCurrentProject();
    return project ? `${project.path}/${project.typFile}` : null;
}

/**
 * Poll: compare disk hash with the editor content hash.
 * - no project            → hide buttons
 * - disk == editor        → saved up to date, update baseline, hide
 * - disk == lastSavedHash → only our own unsaved edits → hide
 * - otherwise             → external change → show buttons
 */
async function checkFileSync() {
    const path = currentFilePath();
    if (!path) {
        setButtonsVisible(false);
        return;
    }

    const editor = getEditor();
    if (!editor || !editor.getModel()) return;

    let diskHash;
    try {
        diskHash = await invoke('file_hash', { path });
    } catch (_) {
        // File missing/unreadable on disk → cannot detect, hide
        setButtonsVisible(false);
        return;
    }

    const editorHash = hashText(editor.getValue());
    _lastSavedHash ??= editorHash;

    if (diskHash === editorHash) {
        _lastSavedHash = diskHash;
        setButtonsVisible(false);
        return;
    }

    if (diskHash === _lastSavedHash) {
        // Only our own pending autosave — not an external change
        setButtonsVisible(false);
        return;
    }

    setButtonsVisible(true);
}

/** Save the editor content to disk, overwriting external changes */
async function handleSave() {
    const path = currentFilePath();
    const editor = getEditor();
    if (!path || !editor) return;

    const hasLocalChanges = hashText(editor.getValue()) !== _lastSavedHash;
    if (hasLocalChanges) {
        const confirmed = await showConfirm({
            title: t('filesync.save_confirm_title'),
            message: t('filesync.save_confirm_message'),
            confirmLabel: t('modal.confirm'),
            cancelLabel: t('modal.cancel'),
        });
        if (!confirmed) return;
    }

    try {
        await invoke('save_file', { path, content: editor.getValue() });
        _lastSavedHash = hashText(editor.getValue());
        notifySaveIndicator(false);
        showToast('success', t('filesync.saved'));
    } catch (err) {
        showToast('error', t('filesync.save_error', { error: err }));
    } finally {
        checkFileSync();
    }
}

/** Reload the editor from disk, discarding local unsaved changes */
async function handleReload() {
    const path = currentFilePath();
    const editor = getEditor();
    if (!path || !editor) return;

    const hasLocalChanges = hashText(editor.getValue()) !== _lastSavedHash;
    if (hasLocalChanges) {
        const confirmed = await showConfirm({
            title: t('filesync.reload_confirm_title'),
            message: t('filesync.reload_confirm_message'),
            confirmLabel: t('modal.confirm'),
            cancelLabel: t('modal.cancel'),
        });
        if (!confirmed) return;
    }

    try {
        const content = await invoke('read_file', { path });
        editor.setValue(content);
        _lastSavedHash = hashText(content);
        showToast('success', t('filesync.reloaded'));
    } catch (err) {
        showToast('error', t('filesync.reload_error', { error: err }));
    } finally {
        setButtonsVisible(false);
        checkFileSync();
    }
}

/**
 * Start the detection loop and register the buttons.
 * Call once after the editor has been created.
 */
export function initFileSync() {
    setButtonsVisible(false);

    onProjectChange(() => {
        _lastSavedHash = null;
        // Recompute after the editor content has been set (next tick)
        setTimeout(checkFileSync, 0);
    });

    const { save, reload } = buttons();
    save?.addEventListener('click', () => handleSave());
    reload?.addEventListener('click', () => handleReload());

    setInterval(checkFileSync, POLL_INTERVAL_MS);
    window.addEventListener('focus', checkFileSync);
    checkFileSync();
}