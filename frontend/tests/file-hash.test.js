import { describe, it, expect } from 'vitest';
import { hashText } from '../src/js/file-hash.js';

// Known FNV-1a 32 test vectors (offset basis 0x811c9dc5).
// The hash must match the Rust version of commands::fs::file_hash.
describe('hashText (FNV-1a 32)', () => {
    it('hashes the empty string', () => {
        expect(hashText('')).toBe('811c9dc5');
    });

    it('hashes "a"', () => {
        expect(hashText('a')).toBe('e40c292c');
    });

    it('hashes "hello world"', () => {
        expect(hashText('hello world')).toBe('d58b3fa7');
    });

    // Reference vector from the FNV reference test suite
    it('hashes "foobar" (reference vector)', () => {
        expect(hashText('foobar')).toBe('bf9cf968');
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
