use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub struct HistoryDB {
    pub conn: Connection,
}

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
    let id = Uuid::new_v4().to_string();

    let inserted = conn.execute(
        "INSERT OR IGNORE INTO history (id, name, path) VALUES (?, ?, ?)",
        [id, name.to_string(), path.to_string()],
    )?;

    Ok(inserted == 1)
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

pub fn update_history_entry(conn: &Connection, id: &str, name: &str, path: &str) -> Result<()> {
    conn.execute(
        "
        UPDATE history SET name = ?, path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    ",
        [&name, &path, &id],
    )?;
    Ok(())
}

/// Inserts exported history entries, skipping any whose id or path already
/// exists. Returns the number of entries actually inserted.
pub fn import_history(conn: &Connection, entries: &[HistoryImport]) -> Result<usize> {
    let mut stmt =
        conn.prepare("INSERT OR IGNORE INTO history (id, name, path) VALUES (?1, ?2, ?3)")?;
    let mut inserted = 0;
    for entry in entries {
        inserted += stmt.execute((&entry.id, &entry.name, &entry.path))?;
    }
    Ok(inserted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

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
}
