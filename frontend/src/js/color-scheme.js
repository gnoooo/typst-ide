/**
 * Theme files
 *
 * Themes live in `<app config dir>/themes/`.
 * Each `*.json` file contains one theme with optional `light` and `dark` palettes.
 * The active theme is stored as a relative path in localStorage (`theme-path`), the active variant is stored in `theme` (`light` or `dark`).
 *
 * Only existing theme variables are accepted, and only color values, so a theme can recolor the UI but never inject arbitrary CSS (e.g. url(...)).
 */

import { t } from '../i18n/index.js';
import { showToast } from './toast.js';

const FORMAT_ID = 'typst-ide-color-scheme';
const FORMAT_VERSION = 1;
const THEME_PATH_KEY = 'theme-path';
const THEME_MODE_KEY = 'theme';
export const DEFAULT_THEME_FILE = 'default.json';

/** Scheme currently loaded (null when none). */
export let currentScheme = null;

// Keys this scheme has set inline, so a theme switch can remove them.
const _appliedKeys = new Set();

let _allowedKeys = null;

// ## Helpers ######################################################

/** Walk the custom properties of the root element (empty on Chromium). */
function forEachCustomProperty(fn) {
    const style = getComputedStyle(document.documentElement);
    for (let i = 0; i < style.length; i++) {
        const prop = style[i];
        if (prop.startsWith('--')) fn(prop, style.getPropertyValue(prop));
    }
}

function collectFromRules(rules, out) {
    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        for (let j = 0; rule.style && j < rule.style.length; j++) {
            const prop = rule.style[j];
            if (prop.startsWith('--')) out.add(prop);
        }
        if (rule.cssRules) collectFromRules(rule.cssRules, out);
    }
}

/**
 * The custom properties declared by the built-in theme, read once (no second hardcoded list to keep in sync with tokens.css).
 */
function getAllowedKeys() {
    if (!_allowedKeys) {
        _allowedKeys = new Set();
        forEachCustomProperty((prop) => _allowedKeys.add(prop));
        // Chromium does not list custom properties on computed styles: fall back to the declarations of the loaded stylesheets.
        if (_allowedKeys.size === 0) {
            for (const sheet of document.styleSheets) {
                try {
                    collectFromRules(sheet.cssRules, _allowedKeys);
                } catch (_) {
                    // Cross-origin stylesheet: ignore.
                }
            }
        }
    }
    return _allowedKeys;
}

function isColor(value) {
    return typeof value === 'string'
        && !/url\(/i.test(value)
        && typeof CSS !== 'undefined'
        && CSS.supports('color', value);
}

function pickColors(section, allowed) {
    const colors = {};
    if (!section || typeof section !== 'object' || Array.isArray(section)) return colors;
    for (const [key, value] of Object.entries(section)) {
        if (!key.startsWith('--') || !allowed.has(key) || !isColor(value)) continue;
        colors[key] = value;
    }
    return colors;
}

/** Read the color-valued custom properties of the theme currently applied. */
function readPalette() {
    const colors = {};
    const style = getComputedStyle(document.documentElement);
    let enumerated = false;

    for (let i = 0; i < style.length; i++) {
        const key = style[i];
        if (!key.startsWith('--')) continue;
        enumerated = true;
        const value = style.getPropertyValue(key).trim();
        if (isColor(value)) colors[key] = value;
    }

    // Chromium does not enumerate custom properties: read the known keys directly instead, so the built-in Default theme can still be dumped.
    if (!enumerated) {
        for (const key of getAllowedKeys()) {
            const value = style.getPropertyValue(key).trim();
            if (isColor(value)) colors[key] = value;
        }
    }
    return colors;
}

/**
 * Snapshot the built-in palette as a theme document.
 * Both palettes are read by toggling data-theme and restored in the same task, so nothing is painted in between.
 */
function dumpColorScheme() {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    const scheme = {
        format: FORMAT_ID,
        formatVersion: FORMAT_VERSION,
        name: 'Default',
    };
    for (const theme of ['light', 'dark']) {
        root.setAttribute('data-theme', theme);
        scheme[theme] = readPalette();
    }
    if (previous === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', previous);

    if (Object.keys(scheme.light).length === 0 && Object.keys(scheme.dark).length === 0) {
        return null;
    }
    return JSON.stringify(scheme, null, 2) + '\n';
}

// ## Active theme state ###########################################

export function getThemeMode() {
    return localStorage.getItem(THEME_MODE_KEY) === 'dark' ? 'dark' : 'light';
}

export function getActiveThemePath() {
    return localStorage.getItem(THEME_PATH_KEY) || DEFAULT_THEME_FILE;
}

function setThemeMode(mode) {
    if (mode === 'light' || mode === 'dark') {
        localStorage.setItem(THEME_MODE_KEY, mode);
    }
}

function setActiveThemePath(file) {
    localStorage.setItem(THEME_PATH_KEY, file);
}

/** True when the theme actually provides colors for this variant. */
export function hasPalette(scheme, mode) {
    return Boolean(scheme?.[mode] && Object.keys(scheme[mode]).length > 0);
}

function resolveMode(scheme, mode = getThemeMode()) {
    if (hasPalette(scheme, mode)) return mode;
    if (hasPalette(scheme, 'light')) return 'light';
    if (hasPalette(scheme, 'dark')) return 'dark';
    return null;
}

function emitThemeChanged(mode, path) {
    if (window.__TAURI__?.event) {
        window.__TAURI__.event.emit('theme:changed', { theme: mode, path });
    }
}

// ## Public API ###################################################

/**
 * Parse a raw theme document.
 * Returns { name, light, dark } or null when the document is not a valid scheme (bad JSON/format/version, no valid entry).
 * A theme with only `light` or only `dark` is valid.
 */
export function parseColorScheme(raw, allowedKeys) {
    let doc;
    try {
        doc = JSON.parse(raw);
    } catch (_) {
        return null;
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    if (doc.format !== FORMAT_ID || doc.formatVersion !== FORMAT_VERSION) return null;

    const light = pickColors(doc.light, allowedKeys);
    const dark = pickColors(doc.dark, allowedKeys);
    if (Object.keys(light).length === 0 && Object.keys(dark).length === 0) return null;

    return {
        name: typeof doc.name === 'string' ? doc.name : null,
        light,
        dark,
    };
}

/** Apply the scheme's palette for the resolved mode. */
export function applyColorScheme(scheme, theme = document.documentElement.getAttribute('data-theme')) {
    const root = document.documentElement;
    for (const key of _appliedKeys) root.style.removeProperty(key);
    _appliedKeys.clear();

    const mode = resolveMode(scheme, theme);
    if (mode) {
        if (root.getAttribute('data-theme') !== mode) {
            root.setAttribute('data-theme', mode);
        }
        setThemeMode(mode);
    }

    const colors = scheme?.[mode];
    if (!colors) return;
    for (const [key, value] of Object.entries(colors)) {
        root.style.setProperty(key, value);
        _appliedKeys.add(key);
    }
}

async function loadThemeByPath(file) {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return null;
    const raw = await invoke('read_theme', { file });
    if (raw === null || raw === undefined) return null;
    return parseColorScheme(raw, getAllowedKeys());
}

/** Create `themes/default.json` if it does not exist, then return it. */
export async function ensureDefaultTheme() {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return null;

    let raw;
    try {
        raw = await invoke('read_theme', { file: DEFAULT_THEME_FILE });
    } catch (error) {
        showToast('error', t('theme.error', { error: String(error) }));
        return null;
    }

    if (raw !== null && raw !== undefined) {
        const scheme = parseColorScheme(raw, getAllowedKeys());
        if (scheme) return scheme;
        showToast('error', t('theme.invalid_scheme'));
        return null;
    }

    const payload = dumpColorScheme();
    if (!payload) {
        showToast('error', t('theme.default_error'));
        return null;
    }
    try {
        await invoke('write_theme', { file: DEFAULT_THEME_FILE, payload });
        return parseColorScheme(payload, getAllowedKeys());
    } catch (error) {
        showToast('error', t('theme.error', { error: String(error) }));
        return null;
    }
}

/** Load the active theme, falling back to default.json then the built-in UI. */
export async function loadActiveTheme({ createDefault = false } = {}) {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return null;

    let file = getActiveThemePath();
    let scheme = null;

    try {
        scheme = await loadThemeByPath(file);
    } catch (error) {
        showToast('error', t('theme.error', { error: String(error) }));
    }

    if (!scheme && file !== DEFAULT_THEME_FILE) {
        file = DEFAULT_THEME_FILE;
        setActiveThemePath(file);
        try {
            scheme = await loadThemeByPath(file);
        } catch (error) {
            showToast('error', t('theme.error', { error: String(error) }));
        }
    }

    if (!scheme && createDefault) {
        scheme = await ensureDefaultTheme();
    }

    if (!scheme) {
        currentScheme = null;
        applyColorScheme(null);
        return null;
    }

    currentScheme = scheme;
    applyColorScheme(scheme);
    return scheme;
}

/** Reload the active theme file and apply it. */
export async function reloadColorScheme() {
    const scheme = await loadActiveTheme({ createDefault: false });
    if (!scheme) showToast('error', t('theme.invalid_scheme'));
    return scheme;
}

/** List and parse every theme file. Invalid files are returned with `valid: false`. */
export async function listThemes() {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return [];

    const files = await invoke('list_themes');
    const themes = files.map(({ file, content }) => {
        const scheme = parseColorScheme(content, getAllowedKeys());
        return {
            file,
            name: scheme?.name || file.replace(/\.json$/i, ''),
            scheme,
            valid: Boolean(scheme),
        };
    });

    themes.sort((a, b) => {
        if (a.file === DEFAULT_THEME_FILE) return -1;
        if (b.file === DEFAULT_THEME_FILE) return 1;
        return a.name.localeCompare(b.name);
    });
    return themes;
}

/**
 * Persist and apply a theme selection.
 * `mode` is the requested variant: if the theme does not provide it, the available variant is used.
 */
export async function applyThemeSelection(file, mode) {
    const scheme = await loadThemeByPath(file);
    if (!scheme) throw new Error(t('theme.invalid_scheme'));

    const resolved = resolveMode(scheme, mode);
    if (!resolved) throw new Error(t('theme.invalid_scheme'));

    setActiveThemePath(file);
    setThemeMode(resolved);
    currentScheme = scheme;
    document.documentElement.setAttribute('data-theme', resolved);
    applyColorScheme(scheme, resolved);
    emitThemeChanged(resolved, file);
    return { scheme, mode: resolved };
}

/** Open the themes folder in the OS file manager. */
export async function openThemesFolder() {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return;
    const dir = await invoke('get_themes_dir');
    await invoke('reveal_in_file_manager', { path: dir });
}

/**
 * Startup hook. The main window creates the default theme if needed, the other windows only load the active one.
 */
export async function initColorScheme({ createDefault = false } = {}) {
    try {
        await loadActiveTheme({ createDefault });
    } catch (_) {
        // Cosmetic feature: ignore any failure.
    }
}
