import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../src/js/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/js/color-scheme.js', () => {
    const applyThemeSelection = vi.fn(async () => ({ mode: 'light' }));
    return {
        DEFAULT_THEME_FILE: 'default.json',
        ensureDefaultTheme: vi.fn(async () => ({})),
        listThemes: vi.fn(async () => [
            {
                file: 'default.json',
                name: 'Default',
                valid: true,
                scheme: { light: { '--bg': '#fff' }, dark: { '--bg': '#000' } },
            },
            {
                file: 'light-only.json',
                name: 'Light only',
                valid: true,
                scheme: { light: { '--bg': '#eee' }, dark: {} },
            },
            {
                file: 'broken.json',
                name: 'Broken',
                valid: false,
                scheme: null,
            },
        ]),
        getActiveThemePath: () => 'default.json',
        getThemeMode: () => 'light',
        hasPalette: (scheme, mode) => Boolean(scheme?.[mode] && Object.keys(scheme[mode]).length),
        applyThemeSelection,
        openThemesFolder: vi.fn(async () => {}),
    };
});

import { applyThemeSelection } from '../src/js/color-scheme.js';
import { openThemePicker } from '../src/js/theme-picker.js';

function setupDom() {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.requestAnimationFrame = (cb) => cb();
    return dom.window;
}

describe('theme picker', () => {
    let dom;

    beforeEach(() => {
        dom = setupDom();
        applyThemeSelection.mockClear();
    });

    it('lists themes, disables missing variants and applies the selected one', async () => {
        await openThemePicker();

        const rows = document.querySelectorAll('.theme-picker-row');
        expect(rows).toHaveLength(3);

        const lightOnly = rows[1];
        const buttons = lightOnly.querySelectorAll('.theme-variant-btn');
        expect(buttons[0].disabled).toBe(false);
        expect(buttons[1].disabled).toBe(true);
        expect(buttons[0].querySelector('.theme-variant-check')).not.toBeNull();
        expect(buttons[0].getAttribute('aria-pressed')).toBe('false');

        buttons[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
        expect(buttons[0].classList.contains('theme-variant-btn--selected')).toBe(true);

        const apply = document.querySelector('.ide-modal-actions button:last-child');
        expect(apply.disabled).toBe(false);
        apply.click();

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(applyThemeSelection).toHaveBeenCalledWith('light-only.json', 'light');
    });

    it('marks invalid files and disables their variants', async () => {
        await openThemePicker();

        const broken = document.querySelectorAll('.theme-picker-row')[2];
        expect(broken.classList.contains('theme-picker-row--invalid')).toBe(true);
        for (const button of broken.querySelectorAll('.theme-variant-btn')) {
            expect(button.disabled).toBe(true);
        }
    });
});
