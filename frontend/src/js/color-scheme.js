/**
 * Color scheme
 *
 * At every launch the main window snapshots the palette the app is actually
 * showing (light and dark, colors only) into ~/.config/io.github.gnoooo.typst-ide/theme.json
 * and applies it as inline custom properties on <html>. The other windows read
 * that file at startup, and the Help menu re-reads it on demand.
 *
 * Only existing theme variables are accepted, and only color values, so the
 * file can recolor the UI but never inject arbitrary CSS (e.g. url(...)).
 */

import { t } from '../i18n/index.js';
import { showToast } from './toast.js';

const FORMAT_ID = 'typst-ide-color-scheme';
const FORMAT_VERSION = 1;

/** Scheme currently loaded (null when none). Exported live for toolbar.js. */
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
 * The custom properties declared by the built-in theme, read once (no second
 * hardcoded list to keep in sync with tokens.css).
 */
function getAllowedKeys() {
    if (!_allowedKeys) {
        _allowedKeys = new Set();
        forEachCustomProperty((prop) => _allowedKeys.add(prop));
        // Chromium does not list custom properties on computed styles: fall
        // back to the declarations of the loaded stylesheets.
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
    forEachCustomProperty((key, value) => {
        const trimmed = value.trim();
        if (isColor(trimmed)) colors[key] = trimmed;
    });
    return colors;
}

/**
 * Snapshot the built-in palette as a theme.json document. Both palettes are
 * read by toggling data-theme and restored in the same task, so nothing is
 * painted in between. Returns null when the engine cannot enumerate custom
 * properties (Chromium), so the file is never wiped with an empty scheme.
 */
function dumpColorScheme() {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    const scheme = { format: FORMAT_ID, formatVersion: FORMAT_VERSION };
    for (const theme of ['light', 'dark']) {
        root.setAttribute('data-theme', theme);
        scheme[theme] = readPalette();
    }
    if (previous === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', previous);

    if (Object.keys(scheme.light).length === 0 && Object.keys(scheme.dark).length === 0) return null;
    return JSON.stringify(scheme, null, 2) + '\n';
}

// ## Public API ###################################################

/**
 * Parse a raw theme.json document. Returns { name, light, dark } or null when
 * the document is not a valid scheme (bad JSON/format/version, no valid entry).
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

/** Apply the scheme's palette for `theme` (defaults to the applied one). */
export function applyColorScheme(scheme, theme = document.documentElement.getAttribute('data-theme')) {
    const root = document.documentElement;
    for (const key of _appliedKeys) root.style.removeProperty(key);
    _appliedKeys.clear();

    const colors = scheme?.[theme];
    if (!colors) return;
    for (const [key, value] of Object.entries(colors)) {
        root.style.setProperty(key, value);
        _appliedKeys.add(key);
    }
}

/** Reload theme.json from disk and apply it for the current theme. */
export async function reloadColorScheme() {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return null;

    let raw;
    try {
        raw = await invoke('load_color_scheme');
    } catch (error) {
        showToast('error', t('theme.error', { error: String(error) }));
        return null;
    }

    if (raw === null || raw === undefined) {
        currentScheme = null;
        applyColorScheme(null);
        return null;
    }

    currentScheme = parseColorScheme(raw, getAllowedKeys());
    applyColorScheme(currentScheme);
    if (!currentScheme) showToast('error', t('theme.invalid_scheme'));
    return currentScheme;
}

/**
 * Startup hook. In the main window (`writeDefault`), the built-in palette is
 * written to theme.json first, so the file always mirrors the app; the other
 * windows just load it.
 */
export async function initColorScheme({ writeDefault = false } = {}) {
    try {
        const payload = writeDefault ? dumpColorScheme() : null;
        if (payload) {
            const invoke = window.__TAURI__?.core?.invoke;
            if (invoke) {
                try {
                    await invoke('save_color_scheme', { payload });
                } catch (error) {
                    showToast('error', t('theme.error', { error: String(error) }));
                }
            }
            currentScheme = parseColorScheme(payload, getAllowedKeys());
            applyColorScheme(currentScheme);
            return;
        }
        if (writeDefault) {
            console.warn('[theme] cannot read custom properties from computed styles: theme.json not written');
        }
        await reloadColorScheme();
    } catch (_) {
        // Cosmetic feature: ignore any failure.
    }
}
