use rusqlite::{Connection, Result};
use serde::Serialize;
use uuid::Uuid;

pub struct BibliographyDB {
    pub conn: Connection,
}

pub fn init_db(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS bibliography (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            style TEXT NOT NULL,
            path TEXT NOT NULL,
            project_path TEXT NOT NULL,
            full BOOLEAN NOT NULL,
            created_at DEFAULT CURRENT_TIMESTAMP,
            updated_at DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;
    // Migrate existing "true"/"false" text values to integer (0/1)
    conn.execute_batch(
        "UPDATE bibliography SET full = 1 WHERE full = 'true';
         UPDATE bibliography SET full = 0 WHERE full = 'false';",
    )?;

    // Add project_path column if missing (migration for existing DBs)
    let _ = conn
        .execute_batch("ALTER TABLE bibliography ADD COLUMN project_path TEXT NOT NULL DEFAULT ''");

    Ok(conn)
}

#[derive(Serialize, Debug)]
pub struct BibliographyEntry {
    pub id: String,
    pub title: String,
    pub style: String,
    pub path: String,
    pub project_path: String,
    pub full: bool,
    pub created_at: String,
    pub updated_at: String,
}

pub fn add_entry(
    conn: &Connection,
    title: &str,
    style: &str,
    path: &str,
    project_path: &str,
    full: bool,
) -> Result<bool> {
    let id = Uuid::new_v4().to_string();

    let inserted = conn.execute(
        "INSERT OR IGNORE INTO bibliography (id, title, style, path, project_path, full) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, title, style, path, project_path, full],
    )?;

    Ok(inserted == 1)
}

pub fn get_bibliography(conn: &Connection, project_path: &str) -> Result<Vec<BibliographyEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, style, path, project_path, full, created_at, updated_at \
         FROM bibliography WHERE project_path = ?1 ORDER BY updated_at DESC",
    )?;
    let bibliography_iter = stmt.query_map(rusqlite::params![project_path], |row| {
        Ok(BibliographyEntry {
            id: row.get(0)?,
            title: row.get(1)?,
            style: row.get(2)?,
            path: row.get(3)?,
            project_path: row.get(4)?,
            full: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })?;

    let mut bibliography = Vec::new();
    for entry in bibliography_iter {
        bibliography.push(entry?);
    }
    Ok(bibliography)
}

pub fn set_entry_project_path(conn: &Connection, path: &str, project_path: &str) -> Result<()> {
    conn.execute(
        "UPDATE bibliography SET project_path = ?1 WHERE path = ?2",
        rusqlite::params![project_path, path],
    )?;
    Ok(())
}

pub fn delete_bibliography_entry(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM bibliography WHERE id = ?", [id])?;
    Ok(())
}

pub fn update_bibliography_entry(
    conn: &Connection,
    id: &str,
    title: &str,
    style: &str,
    path: &str,
    full: bool,
) -> Result<()> {
    conn.execute(
        "UPDATE bibliography SET title = ?1, style = ?2, path = ?3, full = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = ?5",
        rusqlite::params![title, style, path, full, id],
    )?;
    Ok(())
}
