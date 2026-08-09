/**
 * FNV-1a 64-bit hash over UTF-8 bytes of `text`.
 * Matches the Rust implementation in `commands::fs::file_hash`
 * (crates/app/src/commands/fs.rs).
 */
export function hashText(text) {
    const bytes = new TextEncoder().encode(text);
    let hash = 0xcbf29ce484222325n;
    for (const b of bytes) {
        hash ^= BigInt(b);
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, '0').toLowerCase();
}