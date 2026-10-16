import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLang, getLang, initI18n } from '../src/i18n/index.js';
import fr from '../src/i18n/fr.json';
import en from '../src/i18n/en.json';

// Stubs minimaux : setLang() touche localStorage et document.
globalThis.localStorage = {
    store: new Map(),
    getItem(k) { return this.store.get(k) ?? null; },
    setItem(k, v) { this.store.set(k, String(v)); },
    removeItem(k) { this.store.delete(k); },
};
globalThis.document = {
    documentElement: { lang: '' },
    querySelectorAll: () => [],
};

describe('i18n', () => {
    beforeEach(() => {
        setLang('fr');
    });

    it('returns the key when it is unknown', () => {
        expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
    });

    it('returns a known key in the current language', () => {
        setLang('fr');
        expect(t('menu.file')).toBe(fr['menu.file']);
    });

    it('switches language via setLang', () => {
        setLang('en');
        expect(getLang()).toBe('en');
        expect(t('menu.file')).toBe(en['menu.file']);
    });

    it('ignores unknown languages', () => {
        setLang('de');
        expect(getLang()).toBe('fr');
    });

    it('replaces placeholders', () => {
        expect(t('filesync.save_error', { error: 'boom' })).toBe(
            fr['filesync.save_error'].replace('{error}', 'boom')
        );
    });

    it('fr and en have exactly the same keys', () => {
        const frKeys = Object.keys(fr).sort();
        const enKeys = Object.keys(en).sort();
        expect(frKeys).toEqual(enKeys);
        expect(frKeys.length).toBeGreaterThan(0);
    });
});

describe('initI18n', () => {
    // Stubs configurables, réinstallés par chaque test
    const setup = ({ saved, invokeError, tauri, sysLang, navLang }) => {
        localStorage.store.clear();
        if (saved !== undefined) localStorage.setItem('lang', saved);
        globalThis.window = tauri ? {
            __TAURI__: {
                core: {
                    invoke: async (cmd) => {
                        if (invokeError) throw new Error('invoke failed');
                        if (cmd === 'system_lang') return sysLang;
                        throw new Error('unknown command ' + cmd);
                    },
                },
            },
        } : {};
        Object.defineProperty(globalThis, 'navigator', {
            value: { language: navLang },
            configurable: true,
        });
    };

    it('uses the system lang from Tauri when nothing is saved', async () => {
        setup({ tauri: true, sysLang: 'en' });
        await initI18n();
        expect(getLang()).toBe('en');
    });

    it('maps a French system to fr', async () => {
        setup({ tauri: true, sysLang: 'fr' });
        await initI18n();
        expect(getLang()).toBe('fr');
    });

    it('saved preference wins over system detection', async () => {
        setup({ tauri: true, sysLang: 'fr', saved: 'en' });
        await initI18n();
        expect(getLang()).toBe('en');
    });

    it('falls back to navigator.language without Tauri', async () => {
        setup({ tauri: false, navLang: 'fr-FR' });
        await initI18n();
        expect(getLang()).toBe('fr');
    });

    it('defaults to en when invoke fails', async () => {
        setup({ tauri: true, invokeError: true, navLang: 'de-DE' });
        await initI18n();
        expect(getLang()).toBe('en');
    });
});
