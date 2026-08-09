import { describe, it, expect } from 'vitest';
import { hashText } from '../src/js/file-hash.js';

// Vecteurs de test connus de FNV-1a 64 (offset basis 0xcbf29ce484222325).
// Le hash doit correspondre à la version Rust de commands::fs::file_hash.
describe('hashText (FNV-1a 64)', () => {
    it('hashes the empty string', () => {
        expect(hashText('')).toBe('cbf29ce484222325');
    });

    it('hashes "a"', () => {
        expect(hashText('a')).toBe('af63dc4c8601ec8c');
    });

    it('hashes "hello world"', () => {
        expect(hashText('hello world')).toBe('779a65e7023cd2e7');
    });

    it('handles multi-byte UTF-8 characters', () => {
        expect(hashText('é')).not.toBe(hashText('e'));
        expect(hashText('é')).toBe(hashText('é'));
    });

    it('is deterministic', () => {
        const sample = '#let x = 1 // typst content\n#x * 2';
        expect(hashText(sample)).toBe(hashText(sample));
    });
});
