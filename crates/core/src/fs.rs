/// Crash-safe file writing: never truncates an existing file in place.
use std::{
    fs::File,
    io::{self, Write},
    path::Path,
};

/// Writes `bytes` to `path` (creating parent directories as needed) without ever truncating the existing target:
/// content goes to a sibling `<name>.tmp`, is flushed to disk, then atomically renamed over the target (same filesystem).
/// A crash at any point leaves either the previous or the new complete file (never a truncated one).
pub fn write_atomic<P: AsRef<Path>>(path: P, bytes: &[u8]) -> io::Result<()> {
    let target = path.as_ref();
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp_path = target.with_file_name(format!(
        "{}.tmp",
        target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
    ));
    let mut tmp = File::create(&tmp_path)?;
    tmp.write_all(bytes)?;
    tmp.sync_all()?;
    // no fsync of the parent dir a crash right after the rename may keep
    // the old file instead of the new one, but never a truncated one
    std::fs::rename(&tmp_path, target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn overwrites_completely_and_leaves_no_tmp() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("f.txt");
        std::fs::write(&p, "0123456789").unwrap();

        write_atomic(&p, b"abc").unwrap();

        assert_eq!(std::fs::read(&p).unwrap(), b"abc");
        assert_eq!(
            std::fs::read_dir(dir.path()).unwrap().count(),
            1,
            "no .tmp leftover"
        );
    }

    #[test]
    fn creates_missing_parent_dirs() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("nested/dir/f.txt");

        write_atomic(&p, b"hi").unwrap();

        assert_eq!(std::fs::read(&p).unwrap(), b"hi");
    }
}
