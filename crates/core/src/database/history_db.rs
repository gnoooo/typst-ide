use rusqlite::{Connection, Error, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub fn init_db(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS history (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            created_at DEFAULT CURRENT_TIMESTAMP,
            updated_at DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;
    Ok(conn)
}

#[derive(Serialize, Debug)]
pub struct HistoryEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub updated_at: String,
}

/// A history entry as stored in an export file (timestamps are regenerated
/// on import; the `id` is kept so re-importing never duplicates anything).
#[derive(Deserialize, Debug)]
pub struct HistoryImport {
    pub id: String,
    pub name: String,
    pub path: String,
}

pub fn add_entry(conn: &Connection, name: &str, path: &str) -> Result<bool> {
    // Le booléen garde la sémantique « nouvelle entrée » attendue par le frontend
    let already = conn
        .query_row("SELECT 1 FROM history WHERE path = ?1", [path], |_| Ok(()))
        .optional()?
        .is_some();

    let id = Uuid::new_v4().to_string();

    // Rouvrir un projet doit remonter la ligne en tête
    // (get_history trie par updated_at), le ignore était un no-op
    conn.execute(
        "INSERT INTO history (id, name, path) VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET updated_at = CURRENT_TIMESTAMP",
        [id, name.to_string(), path.to_string()],
    )?;

    Ok(!already)
}

pub fn get_history(conn: &Connection) -> Result<Vec<HistoryEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, created_at, updated_at FROM history ORDER BY updated_at DESC",
    )?;
    let history_iter = stmt.query_map([], |row| {
        Ok(HistoryEntry {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    let history = history_iter.collect::<Result<Vec<_>, _>>()?;
    Ok(history)
}

pub fn delete_history_entry(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM history WHERE id = ?", [id])?;
    Ok(())
}

/// Path of a history entry, to purge project-scoped data alongside it.
pub fn get_entry_path(conn: &Connection, id: &str) -> Result<Option<String>> {
    conn.query_row("SELECT path FROM history WHERE id = ?", [id], |row| {
        row.get(0)
    })
    .optional()
}

pub fn update_history_entry(conn: &Connection, id: &str, name: &str, path: &str) -> Result<()> {
    let updated = conn.execute(
        "
        UPDATE history SET name = ?, path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    ",
        [&name, &path, &id],
    )?;
    // Renommer une entrée supprimée ailleurs dans une vue obsolète
    // ne doit pas se terminer en faux succès sans message
    if updated == 0 {
        return Err(Error::QueryReturnedNoRows);
    }
    Ok(())
}

/// Inserts exported history entries, skipping any whose id or path already
/// exists. Returns the number of entries actually inserted.
pub fn import_history(conn: &Connection, entries: &[HistoryImport]) -> Result<usize> {
    // Une transaction pour que l'échec d'une ligne annule tout l'import.
    let tx = conn.unchecked_transaction()?;
    let mut stmt =
        tx.prepare("INSERT OR IGNORE INTO history (id, name, path) VALUES (?1, ?2, ?3)")?;
    let mut inserted = 0;
    for entry in entries {
        inserted += stmt.execute((&entry.id, &entry.name, &entry.path))?;
    }
    drop(stmt);
    tx.commit()?;
    Ok(inserted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::thread::sleep;
    use std::time::Duration;

    fn fresh_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE history (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                created_at DEFAULT CURRENT_TIMESTAMP,
                updated_at DEFAULT CURRENT_TIMESTAMP
            )",
        )
        .unwrap();
        conn
    }

    #[test]
    fn reopening_moves_the_project_to_the_top() {
        let conn = fresh_db();
        add_entry(&conn, "A", "/tmp/a").unwrap();
        sleep(Duration::from_millis(1100));
        add_entry(&conn, "B", "/tmp/b").unwrap();
        assert_eq!(get_history(&conn).unwrap()[0].path, "/tmp/b");

        // Le INSERT OR IGNORE d'avant faisait de la réouverture un no-op
        sleep(Duration::from_millis(1100));
        assert!(!add_entry(&conn, "A", "/tmp/a").unwrap());
        assert_eq!(get_history(&conn).unwrap()[0].path, "/tmp/a");
    }

    #[test]
    fn update_of_a_deleted_entry_fails() {
        let conn = fresh_db();
        assert!(update_history_entry(&conn, "missing", "n", "/tmp/n").is_err());
    }

    #[test]
    fn update_renaming_onto_an_existing_path_fails() {
        let conn = fresh_db();
        add_entry(&conn, "A", "/tmp/a").unwrap();
        add_entry(&conn, "B", "/tmp/b").unwrap();

        let id_b = get_history(&conn)
            .unwrap()
            .iter()
            .find(|e| e.path == "/tmp/b")
            .unwrap()
            .id
            .clone();
        assert!(update_history_entry(&conn, &id_b, "B", "/tmp/a").is_err());
        // B garde son chemin d'origine
        assert!(
            get_history(&conn)
                .unwrap()
                .iter()
                .any(|e| e.path == "/tmp/b")
        );
    }

    #[test]
    fn import_history_merges_without_duplicates() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE history (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                created_at DEFAULT CURRENT_TIMESTAMP,
                updated_at DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )
        .unwrap();

        let entries = vec![
            HistoryImport {
                id: "h1".into(),
                name: "Projet A".into(),
                path: "/tmp/a".into(),
            },
            HistoryImport {
                id: "h2".into(),
                name: "Projet B".into(),
                path: "/tmp/b".into(),
            },
        ];
        assert_eq!(import_history(&conn, &entries).unwrap(), 2);
        // Same ids AND/or same paths are skipped on re-import.
        assert_eq!(import_history(&conn, &entries).unwrap(), 0);
        let extra = vec![HistoryImport {
            id: "h3".into(),
            name: "Projet C".into(),
            path: "/tmp/c".into(),
        }];
        assert_eq!(import_history(&conn, &extra).unwrap(), 1);
        assert_eq!(get_history(&conn).unwrap().len(), 3);
    }

    #[test]
    fn import_history_is_atomic_on_failure() {
        let conn = Connection::open_in_memory().unwrap();
        // UNIQUE/NOT NULL/CHECK sont absorbés par INSERT OR IGNORE, la clé
        // étrangère est la seule violation immédiate qui échoue l'INSERT.
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE parents (id TEXT PRIMARY KEY);
             CREATE TABLE history (
                 id TEXT PRIMARY KEY NOT NULL,
                 name TEXT NOT NULL,
                 path TEXT NOT NULL UNIQUE REFERENCES parents(id),
                 created_at DEFAULT CURRENT_TIMESTAMP,
                 updated_at DEFAULT CURRENT_TIMESTAMP
             )",
        )
        .unwrap();

        let entries = vec![
            HistoryImport {
                id: "h1".into(),
                name: "Projet A".into(),
                path: "/tmp/a".into(),
            },
            HistoryImport {
                id: "h2".into(),
                name: "Projet B".into(),
                path: "missing".into(),
            },
        ];
        assert!(import_history(&conn, &entries).is_err());
        // La ligne valide insérée en premier ne doit pas avoir persisté.
        assert!(get_history(&conn).unwrap().is_empty());
    }
}
