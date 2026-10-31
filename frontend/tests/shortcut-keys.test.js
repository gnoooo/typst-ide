import { describe, expect, it } from 'vitest';
import { isToggleConsoleShortcut } from '../src/js/shortcut-keys.js';

function keyEvent(overrides = {}) {
    return {
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        code: '',
        key: '',
        ...overrides,
    };
}

describe('isToggleConsoleShortcut', () => {
    it('matches Ctrl+E', () => {
        expect(isToggleConsoleShortcut(keyEvent({ ctrlKey: true, code: 'KeyE', key: 'e' }))).toBe(true);
    });

    it('matches Cmd+E on macOS', () => {
        expect(isToggleConsoleShortcut(keyEvent({ metaKey: true, code: 'KeyE', key: 'e' }))).toBe(true);
    });

    it('falls back to the key when code is unavailable', () => {
        expect(isToggleConsoleShortcut(keyEvent({ ctrlKey: true, key: 'E' }))).toBe(true);
    });

    it('ignores Shift or Alt variants', () => {
        expect(isToggleConsoleShortcut(keyEvent({ ctrlKey: true, shiftKey: true, code: 'KeyE' }))).toBe(false);
        expect(isToggleConsoleShortcut(keyEvent({ ctrlKey: true, altKey: true, code: 'KeyE' }))).toBe(false);
    });

    it('ignores other keys and bare E', () => {
        expect(isToggleConsoleShortcut(keyEvent({ ctrlKey: true, code: 'KeyR', key: 'r' }))).toBe(false);
        expect(isToggleConsoleShortcut(keyEvent({ code: 'KeyE', key: 'e' }))).toBe(false);
        expect(isToggleConsoleShortcut(null)).toBe(false);
    });
});
