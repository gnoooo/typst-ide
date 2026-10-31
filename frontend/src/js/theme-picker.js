/**
 * Theme picker
 *
 * Lists the JSON files from the themes folder.
 * Each theme row exposes its available light/dark variants, a missing variant is disabled.
 */

import { t } from '../i18n/index.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';
import {
    DEFAULT_THEME_FILE,
    applyThemeSelection,
    ensureDefaultTheme,
    getActiveThemePath,
    getThemeMode,
    hasPalette,
    listThemes,
    openThemesFolder,
} from './color-scheme.js';

function modeLabel(mode) {
    return mode === 'dark' ? t('theme.dark') : t('theme.light');
}

function createSwatch(colors) {
    const swatch = document.createElement('span');
    swatch.className = 'theme-swatch';
    if (!colors) {
        swatch.classList.add('theme-swatch--missing');
        return swatch;
    }

    swatch.style.backgroundColor = colors['--bg'] || 'transparent';
    swatch.style.borderColor = colors['--border'] || 'var(--border)';

    const text = document.createElement('span');
    text.className = 'theme-swatch-text';
    text.textContent = 'Aa';
    text.style.color = colors['--text'] || 'inherit';
    swatch.appendChild(text);

    const dot = document.createElement('span');
    dot.className = 'theme-swatch-dot';
    dot.style.backgroundColor = colors['--accent'] || 'transparent';
    swatch.appendChild(dot);

    return swatch;
}

function buildThemeRow(theme, selected, onSelect, registerVariant) {
    const row = document.createElement('div');
    row.className = 'theme-picker-row';
    if (!theme.valid) row.classList.add('theme-picker-row--invalid');

    const info = document.createElement('div');
    info.className = 'theme-picker-info';

    const title = document.createElement('div');
    title.className = 'theme-picker-name';
    title.textContent = theme.name;
    if (theme.file === getActiveThemePath()) {
        const badge = document.createElement('span');
        badge.className = 'theme-current-badge';
        badge.textContent = t('theme.current');
        title.appendChild(badge);
    }
    info.appendChild(title);

    const file = document.createElement('div');
    file.className = 'theme-picker-file';
    file.textContent = theme.file;
    info.appendChild(file);

    if (!theme.valid) {
        const error = document.createElement('div');
        error.className = 'theme-picker-error';
        error.textContent = t('theme.invalid_file');
        info.appendChild(error);
    }
    row.appendChild(info);

    const variants = document.createElement('div');
    variants.className = 'theme-picker-variants';

    for (const mode of ['light', 'dark']) {
        const colors = hasPalette(theme.scheme, mode) ? theme.scheme[mode] : null;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-variant-btn';
        btn.disabled = !colors;
        if (!colors) {
            btn.classList.add('theme-variant-btn--missing');
            btn.title = t('theme.variant_missing', { mode: modeLabel(mode) });
        }
        const isSelected = selected?.file === theme.file && selected?.mode === mode;
        if (isSelected) {
            btn.classList.add('theme-variant-btn--selected');
        }
        btn.setAttribute('aria-pressed', String(isSelected));

        btn.appendChild(createSwatch(colors));

        const label = document.createElement('span');
        label.className = 'theme-variant-label';
        label.textContent = modeLabel(mode);
        btn.appendChild(label);

        const check = document.createElement('span');
        check.className = 'material-symbols-outlined theme-variant-check';
        check.textContent = 'check';
        btn.appendChild(check);

        btn.addEventListener('click', () => {
            if (!colors) return;
            onSelect(theme.file, mode);
        });
        if (colors) registerVariant(theme.file, mode, btn);
        variants.appendChild(btn);
    }
    row.appendChild(variants);
    return row;
}

/**
 * Opens the theme picker.
 * The current theme/variant is preselected, applying writes `theme-path` and `theme`, then reloads the colors.
 */
export async function openThemePicker() {
    await ensureDefaultTheme();

    let themes;
    try {
        themes = await listThemes();
    } catch (error) {
        showToast('error', t('theme.list_error', { error: String(error) }));
        return;
    }

    const activePath = getActiveThemePath();
    const activeMode = getThemeMode();
    let selected = null;

    const active = themes.find((theme) => theme.valid && theme.file === activePath);
    if (active) {
        selected = {
            file: active.file,
            mode: hasPalette(active.scheme, activeMode)
                ? activeMode
                : (hasPalette(active.scheme, 'light') ? 'light' : 'dark'),
        };
    } else {
        const fallback =
            themes.find((theme) => theme.valid && theme.file === DEFAULT_THEME_FILE) ||
            themes.find((theme) => theme.valid);
        if (fallback) {
            selected = {
                file: fallback.file,
                mode: hasPalette(fallback.scheme, 'light') ? 'light' : 'dark',
            };
        }
    }

    const body = document.createElement('div');
    body.className = 'theme-picker';

    const list = document.createElement('div');
    list.className = 'theme-picker-list';
    body.appendChild(list);

    const variantButtons = [];
    let applyButton = null;

    const syncSelection = () => {
        for (const { file, mode, btn } of variantButtons) {
            const isSelected = selected?.file === file && selected?.mode === mode;
            btn.classList.toggle('theme-variant-btn--selected', isSelected);
            btn.setAttribute('aria-pressed', String(isSelected));
        }
        if (applyButton) applyButton.disabled = !selected;
    };

    const onSelect = (file, mode) => {
        selected = { file, mode };
        syncSelection();
    };

    if (themes.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'theme-picker-empty';
        empty.textContent = t('theme.empty');
        list.appendChild(empty);
    } else {
        for (const theme of themes) {
            const row = buildThemeRow(
                theme,
                selected,
                onSelect,
                (file, mode, btn) => variantButtons.push({ file, mode, btn }),
            );
            list.appendChild(row);
        }
    }

    const { overlay } = openModal({
        title: t('theme.picker_title'),
        body,
        width: '640px',
        buttons: [
            {
                label: t('theme.open_folder'),
                onClick: () => {
                    openThemesFolder().catch((error) => {
                        showToast('error', t('theme.open_folder_error', { error: String(error) }));
                    });
                },
            },
            {
                label: t('theme.reload'),
                onClick: (modalClose) => {
                    modalClose();
                    setTimeout(() => { void openThemePicker(); }, 0);
                },
            },
            {
                label: t('modal.cancel'),
                onClick: (modalClose) => modalClose(),
            },
            {
                label: t('theme.apply'),
                primary: true,
                onClick: async (modalClose) => {
                    if (!selected) return;
                    try {
                        const theme = themes.find((item) => item.file === selected.file);
                        const { mode } = await applyThemeSelection(selected.file, selected.mode);
                        showToast('success', t('theme.applied', {
                            name: theme?.name ?? selected.file,
                            mode: modeLabel(mode),
                        }));
                        modalClose();
                    } catch (error) {
                        showToast('error', t('theme.apply_error', { error: String(error) }));
                    }
                },
            },
        ],
    });

    applyButton = overlay.querySelector('.ide-modal-actions button:last-child');
    if (applyButton) applyButton.disabled = !selected;
    syncSelection();
}
