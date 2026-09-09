/**
 * config.js
 *  Config export / import.
 *
 *  Exports the whole user configuration (editor/UI preferences, markers,
 *  notes, history, local templates) into a single JSON file, and re-imports
 *  it into another installation. Both flows open a picker modal where each
 *  section can be included or excluded; sections with nothing to share are
 *  greyed out (disabled).
 *
 *  Only the keys listed in SETTINGS_KEYS are ever read (export) or written
 *  (import); unknown settings coming from a future version are ignored, so
 *  an import can never corrupt this version's state.
 */

import { t } from '../i18n/index.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

const FORMAT_ID = 'typst-ide-config';
const FORMAT_VERSION = 1;

// The localStorage keys that belong to the user configuration. Deliberately
// excludes `preview-debug` (developer flag) and any transient state.
export const SETTINGS_KEYS = [
  'theme',
  'lang',
  'auto-compile',
  'show-console-on-error',
  'console-ignore-terms',
  'editor-font-size',
  'editor-font-family',
  'webview-zoom',
  'comments.keytags.v1',
];

export const KEYTAG_KEY = 'comments.keytags.v1';

// Settings without the marker/keytag section, which is managed separately in
// the export/import picker.
export const SETTINGS_KEYS_NO_KEYTAGS = SETTINGS_KEYS.filter((key) => key !== KEYTAG_KEY);

// The pickable sections, in display order.
const SECTION_IDS = ['settings', 'keytags', 'notes', 'history', 'templates'];

// ## Pure helpers (unit-testable) ###########################################

/**
 * Builds the export document from the current localStorage state.
 * `data` is the Rust-side payload ({ notes, history, templates }),
 * `extra` may carry { appVersion }, and `selection` picks which sections
 * ({ settings, keytags, notes, history, templates }) are exported. Unselected
 * sections are omitted (empty) instead of exported as nulls.
 */
export function buildExportPayload(data = {}, extra = {}, selection = {}) {
  const sel = normalizeSelection(selection);
  const settings = {};
  for (const key of SETTINGS_KEYS) {
    if (!(key === KEYTAG_KEY ? sel.keytags : sel.settings)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) settings[key] = value;
  }

  return {
    format: FORMAT_ID,
    formatVersion: FORMAT_VERSION,
    appVersion: extra.appVersion ?? '',
    exportedAt: new Date().toISOString(),
    settings,
    notes: sel.notes ? (data.notes ?? []) : [],
    history: sel.history ? (data.history ?? []) : [],
    templates: sel.templates ? (data.templates ?? {}) : {},
  };
}

/**
 * Parses and validates a raw export file. Throws on invalid JSON or when the
 * document is not a known Typst IDE config (or comes from a newer format).
 */
export function parseConfigDocument(raw) {
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new Error('not JSON');
  }
  if (!doc || typeof doc !== 'object' || doc.format !== FORMAT_ID) {
    throw new Error('wrong format');
  }
  const version = Number(doc.formatVersion);
  if (!Number.isInteger(version) || version < 1 || version > FORMAT_VERSION) {
    throw new Error('unsupported version');
  }
  return doc;
}

/**
 * Applies exported settings to localStorage. Only the given `keys` (default:
 * all whitelisted keys) are written, unknown ones are ignored. Objects/arrays
 * are stored back as JSON strings (the format the rest of the app expects).
 */
export function applySettings(settings, keys = SETTINGS_KEYS) {
  if (!settings || typeof settings !== 'object') return;
  for (const key of keys) {
    if (!(key in settings)) continue;
    const value = settings[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      localStorage.setItem(key, value);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }
}

/**
 * Which sections have something to export, given the Rust-side `data`
 * ({ notes, history, templates }) and the current localStorage state.
 */
export function exportAvailability(data = {}) {
  const settings = {};
  for (const key of SETTINGS_KEYS_NO_KEYTAGS) {
    if (localStorage.getItem(key) !== null) settings[key] = true;
  }
  return {
    settings: Object.keys(settings).length > 0,
    keytags: localStorage.getItem(KEYTAG_KEY) !== null,
    notes: Array.isArray(data.notes) && data.notes.length > 0,
    history: Array.isArray(data.history) && data.history.length > 0,
    templates: isNonEmptyObject(data.templates),
  };
}

/**
 * Which sections are available for import in a parsed document. A section is
 * unavailable when the file does not contain it (missing or empty).
 */
export function importAvailability(doc = {}) {
  const settings = doc.settings && typeof doc.settings === 'object' ? doc.settings : {};
  let settingsCount = 0;
  for (const key of SETTINGS_KEYS_NO_KEYTAGS) {
    if (key in settings && settings[key] !== null && settings[key] !== undefined) settingsCount += 1;
  }
  return {
    settings: settingsCount > 0,
    keytags: KEYTAG_KEY in settings && settings[KEYTAG_KEY] !== null && settings[KEYTAG_KEY] !== undefined,
    notes: Array.isArray(doc.notes) && doc.notes.length > 0,
    history: Array.isArray(doc.history) && doc.history.length > 0,
    templates: isNonEmptyObject(doc.templates),
  };
}

// ## Selection picker modal ##################################################

/**
 * Opens the section picker modal. Rows for unavailable sections (nothing to
 * export / not present in the file) are greyed out, their checkbox is
 * disabled and a short red explanation (`note`) is shown. Resolves with
 * `{ settings, keytags, notes, history, templates }` or `null` when cancelled.
 *
 * @param {{ title: string, confirmLabel: string, options: Array<{id: string, label: string, available: boolean, note?: string, defaultChecked?: boolean, count?: number}> }} opts
 * @returns {Promise<object|null>}
 */
function showConfigPicker({ title, confirmLabel, options }) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

    const rows = options.map((opt) => {
      const row = document.createElement('label');
      row.className = 'config-option-row' + (opt.available ? '' : ' config-option-row--disabled');

      const boxWrap = document.createElement('span');
      boxWrap.className = 'checkbox-box';

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!(opt.available && (opt.defaultChecked ?? true));
      box.disabled = !opt.available;
      boxWrap.appendChild(box);

      const check = document.createElement('span');
      check.className = 'material-symbols-outlined checkbox-check';
      check.textContent = 'check';
      boxWrap.appendChild(check);

      row.appendChild(boxWrap);

      const textWrap = document.createElement('span');
      textWrap.className = 'config-option-text';

      const text = document.createElement('span');
      text.className = 'config-option-label';
      text.textContent =
        opt.label + (opt.count != null && opt.count > 0 ? ` · ${opt.count}` : '');
      textWrap.appendChild(text);

      if (!opt.available) {
        const note = document.createElement('span');
        note.className = 'config-option-note';
        note.textContent = opt.note ?? t('config.not_in_file');
        textWrap.appendChild(note);
        row.title = note.textContent;
      }

      row.appendChild(textWrap);
      body.appendChild(row);
      return { id: opt.id, checkbox: box };
    });

    const anyAvailable = rows.some((r) => !r.checkbox.disabled);

    let resolved = false;
    function done(value) {
      if (resolved) return;
      resolved = true;
      close();
      resolve(value);
    }

    function currentSelection() {
      const sel = {};
      for (const id of SECTION_IDS) sel[id] = false;
      for (const row of rows) {
        if (!row.checkbox.disabled) sel[row.id] = row.checkbox.checked;
      }
      return sel;
    }

    function anyChecked() {
      return rows.some((r) => !r.checkbox.disabled && r.checkbox.checked);
    }

    const { close, overlay } = openModal({
      title,
      body,
      buttons: [
        { label: t('modal.cancel'), primary: false, onClick: () => done(null) },
        { label: confirmLabel, primary: true, onClick: () => done(currentSelection()) },
      ],
      onClose: () => done(null),
    });

    const confirmBtn = overlay.querySelector('.ide-modal-actions button:last-child');
    const syncConfirm = () => {
      if (confirmBtn) confirmBtn.disabled = !anyAvailable || !anyChecked();
    };
    for (const row of rows) row.checkbox.addEventListener('change', syncConfirm);
    if (confirmBtn) confirmBtn.addEventListener('click', syncConfirm);
    syncConfirm();
  });
}

// ## Tauri flows ############################################################

/** Exports the configuration to a user-chosen JSON file. */
export async function exportConfig() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return;

  let data;
  try {
    data = await invoke('collect_export_data');
  } catch (error) {
    showToast('error', t('config.export_error', { error: String(error) }));
    return;
  }

  const availability = exportAvailability(data);
  const nothing = t('config.nothing_to_export');
  const selection = await showConfigPicker({
    title: t('config.pick_export_title'),
    confirmLabel: t('config.export'),
    options: [
      { id: 'settings', label: t('config.section_settings'), available: availability.settings, count: countLocalSettings(), note: nothing },
      { id: 'keytags', label: t('config.section_keytags'), available: availability.keytags, note: nothing },
      { id: 'notes', label: t('config.section_notes'), available: availability.notes, count: data.notes?.length ?? 0, note: nothing },
      { id: 'history', label: t('config.section_history'), available: availability.history, count: data.history?.length ?? 0, note: nothing },
      { id: 'templates', label: t('config.section_templates'), available: availability.templates, count: Object.keys(data.templates ?? {}).length, note: nothing },
    ],
  });
  if (!selection) return;

  let appVersion = '';
  try {
    appVersion = (await window.__TAURI__?.app?.getVersion?.()) ?? '';
  } catch {
    // Version is only informational.
  }

  const payload = JSON.stringify(buildExportPayload(data, { appVersion }, selection), null, 2);
  try {
    const path = await invoke('export_config', { payload });
    if (path) showToast('success', t('config.export_ok', { path }));
  } catch (error) {
    showToast('error', t('config.export_error', { error: String(error) }));
  }
}

/** Imports a configuration file: settings/markers, then notes/history/templates. */
export async function importConfig() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return;

  let raw;
  try {
    raw = await invoke('import_config');
  } catch (error) {
    showToast('error', t('config.import_error', { error: String(error) }));
    return;
  }
  if (raw === null || raw === undefined) return; // cancelled

  let doc;
  try {
    doc = parseConfigDocument(raw);
  } catch {
    showToast('error', t('config.invalid_format'));
    return;
  }

  const availability = importAvailability(doc);
  const notInFile = t('config.not_in_file');
  const selection = await showConfigPicker({
    title: t('config.pick_import_title'),
    confirmLabel: t('config.import'),
    options: [
      { id: 'settings', label: t('config.section_settings'), available: availability.settings, count: countSettingsIn(doc.settings), note: notInFile },
      { id: 'keytags', label: t('config.section_keytags'), available: availability.keytags, note: notInFile },
      { id: 'notes', label: t('config.section_notes'), available: availability.notes, count: doc.notes?.length ?? 0, note: notInFile },
      { id: 'history', label: t('config.section_history'), available: availability.history, count: doc.history?.length ?? 0, note: notInFile },
      { id: 'templates', label: t('config.section_templates'), available: availability.templates, count: Object.keys(doc.templates ?? {}).length, note: notInFile },
    ],
  });
  if (!selection) return;

  applySettings(doc.settings, settingsKeysForSelection(selection));

  let summary;
  try {
    const calls = [];
    if (selection.notes) calls.push(invoke('import_notes_data', { notes: doc.notes ?? [] }));
    if (selection.history) calls.push(invoke('import_history_data', { entries: doc.history ?? [] }));
    if (selection.templates) calls.push(invoke('import_templates_data', { templates: doc.templates ?? {} }));
    const results = await Promise.all(calls);

    let i = 0;
    summary = { notes: 0, history: 0, templates: null };
    if (selection.notes) summary.notes = results[i++] ?? 0;
    if (selection.history) summary.history = results[i++] ?? 0;
    if (selection.templates) summary.templates = results[i++] ?? null;
  } catch (error) {
    showToast('error', t('config.import_error', { error: String(error) }));
    return;
  }

  const files = summary.templates?.files_written ?? 0;
  const skipped = summary.templates?.files_skipped ?? 0;
  showToast(
    'success',
    t('config.import_ok', {
      notes: summary.notes ?? 0,
      history: summary.history ?? 0,
      templates: summary.templates?.templates_created ?? 0,
      files,
      skipped,
    }),
  );

  // Reload to apply theme, fonts, zoom, language and marker highlights in
  // one go (same mechanism as the language switch).
  setTimeout(() => window.location.reload(), 1200);
}

// ## Internal helpers ########################################################

/** Defaults every section to "selected" (backwards-compatible behavior). */
function normalizeSelection(selection) {
  const sel = {};
  for (const id of SECTION_IDS) sel[id] = selection[id] ?? true;
  return sel;
}

/** The settings keys to write on import, based on the picker selection. */
function settingsKeysForSelection(selection) {
  const keys = [];
  if (selection.settings) keys.push(...SETTINGS_KEYS_NO_KEYTAGS);
  if (selection.keytags) keys.push(KEYTAG_KEY);
  return keys;
}

/** Number of (non-keytag) settings currently present in localStorage. */
function countLocalSettings() {
  let count = 0;
  for (const key of SETTINGS_KEYS_NO_KEYTAGS) {
    if (localStorage.getItem(key) !== null) count += 1;
  }
  return count;
}

/** Number of (non-keytag) settings present in an imported document. */
function countSettingsIn(settings) {
  if (!settings || typeof settings !== 'object') return 0;
  let count = 0;
  for (const key of SETTINGS_KEYS_NO_KEYTAGS) {
    if (key in settings && settings[key] !== null && settings[key] !== undefined) count += 1;
  }
  return count;
}

function isNonEmptyObject(value) {
  return value != null && typeof value === 'object' && Object.keys(value).length > 0;
}