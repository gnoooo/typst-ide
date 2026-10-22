/// Crash-safe file writing: never truncates an existing file in place.
use std::{
    fs::File,
    io::{self, Write},
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

// pid separates crashed processes, the counter separates concurrent saves within the same one
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Writes `bytes` to `path` (creating parent directories as needed) without ever truncating the existing target:
/// content goes to a sibling `<name>.tmp-<pid>-<seq>` (unique per call, so concurrent writers to the
/// same target never share a tmp file), is flushed to disk, then atomically renamed over the target (same filesystem).
/// A crash at any point leaves either the previous or the new complete file (never a truncated one).
pub fn write_atomic<P: AsRef<Path>>(path: P, bytes: &[u8]) -> io::Result<()> {
    let target = path.as_ref();
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp_path = target.with_file_name(format!(
        "{}.tmp-{}-{}",
        target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default(),
        std::process::id(),
        TMP_SEQ.fetch_add(1, Ordering::Relaxed),
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
    fn concurrent_writers_to_same_path_never_mix_content() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("f.txt");

        let spawn = |byte: u8| {
            let path = path.clone();
            std::thread::spawn(move || {
                let buf = vec![byte; 64 * 1024];
                for _ in 0..100 {
                    write_atomic(&path, &buf).unwrap();
                }
            })
        };

        let t1 = spawn(b'a');
        let t2 = spawn(b'b');
        t1.join().unwrap();
        t2.join().unwrap();

        let content = std::fs::read(&path).unwrap();
        assert_eq!(content.len(), 64 * 1024, "never truncated or partial");
        assert!(
            content.iter().all(|&b| b == content[0]),
            "content came from a single writer"
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
