import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLang, getLang } from '../src/i18n/index.js';
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