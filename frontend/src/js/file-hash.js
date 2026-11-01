/**
 * FNV-1a 32-bit hash over UTF-8 bytes of `text`.
 * Pure `Math.imul` loop (no per-byte BigInt allocation), so hashing the whole
 * editor buffer stays cheap even when polled every 2 s on large documents.
 * Matches the Rust implementation in `commands::fs::file_hash`
 * (crates/app/src/commands/fs.rs).
 */
export function hashText(text) {
    const bytes = new TextEncoder().encode(text);
    let hash = 0x811c9dc5;
    for (const b of bytes) {
        hash = Math.imul(hash ^ b, 0x01000193) >>> 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0').toLowerCase();
}
