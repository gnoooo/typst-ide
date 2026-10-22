use chrono::Utc;
use rusqlite::{Connection, Error, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub fn project_id_from_path(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn init_db(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            scope TEXT NOT NULL,
            project_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;
    Ok(conn)
}

#[derive(Serialize, Debug)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub scope: String,
    pub project_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A note as stored in an export file (timestamps are regenerated on import).
#[derive(Deserialize, Debug)]
pub struct NoteImport {
    pub id: String,
    pub title: String,
    pub content: String,
    pub scope: String,
    pub project_id: Option<String>,
}

pub fn add_note(
    conn: &Connection,
    title: &str,
    content: &str,
    scope: &str,
    project_id: Option<&str>,
) -> Result<()> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO notes (id, title, content, scope, project_id, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        (&id, &title, &content, &scope, &project_id, &now, &now),
    )?;
    Ok(())
}

pub fn get_all_notes(conn: &Connection) -> Result<Vec<Note>, Error> {
    let mut stmt = conn.prepare(
        "SELECT id, title, content, scope, project_id, created_at, updated_at FROM notes",
    )?;

    let notes = stmt.query_map([], |row| {
        Ok(Note {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            scope: row.get(3)?,
            project_id: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    notes.collect::<Result<Vec<_>>>()
}

pub fn get_global_notes(conn: &Connection) -> Result<Vec<Note>, Error> {
    let mut stmt = conn.prepare(
        "SELECT id, title, content, scope, project_id, created_at, updated_at FROM notes WHERE scope = 'global'"
    )?;

    let notes = stmt.query_map([], |row| {
        Ok(Note {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            scope: "global".to_string(),
            project_id: None,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    notes.collect::<Result<Vec<_>>>()
}

pub fn get_project_notes(conn: &Connection, project_id: &str) -> Result<Vec<Note>, Error> {
    let mut stmt = conn.prepare(
        "SELECT id, title, content, scope, project_id, created_at, updated_at FROM notes WHERE scope = 'project' AND project_id = ?1"
    )?;

    let notes = stmt.query_map([project_id], |row| {
        Ok(Note {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            scope: "project".to_string(),
            project_id: Some(project_id.to_string()),
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    notes.collect::<Result<Vec<_>>>()
}

pub fn delete_note(conn: &Connection, note_id: &str) -> Result<()> {
    let mut stmt = conn.prepare("DELETE FROM notes WHERE id = ?1")?;
    stmt.execute([note_id])?;
    Ok(())
}

pub fn update_note(
    conn: &Connection,
    note_id: &str,
    title: &str,
    content: &str,
    scope: &str,
    project_id: Option<&str>,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let mut stmt = conn.prepare(
        "UPDATE notes SET title = ?1, content = ?2, scope = ?3, project_id = ?4, updated_at = ?5 WHERE id = ?6"
    )?;
    stmt.execute((&title, &content, &scope, &project_id, &now, &note_id))?;
    Ok(())
}

/// Inserts exported notes, skipping any whose id already exists.
/// Returns the number of notes actually inserted.
pub fn import_notes(conn: &Connection, notes: &[NoteImport]) -> Result<usize> {
    // Une transaction pour que l'échec d'une ligne annule tout l'import.
    let tx = conn.unchecked_transaction()?;
    let now = Utc::now().to_rfc3339();
    let mut stmt = tx.prepare(
        "INSERT OR IGNORE INTO notes (id, title, content, scope, project_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )?;
    let mut inserted = 0;
    for note in notes {
        inserted += stmt.execute((
            &note.id,
            &note.title,
            &note.content,
            &note.scope,
            &note.project_id,
            &now,
            &now,
        ))?;
    }
    drop(stmt);
    tx.commit()?;
    Ok(inserted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn import_notes_merges_without_duplicates() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                scope TEXT NOT NULL,
                project_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )
        .unwrap();

        let notes = vec![
            NoteImport {
                id: "a".into(),
                title: "One".into(),
                content: "content".into(),
                scope: "global".into(),
                project_id: None,
            },
            NoteImport {
                id: "b".into(),
                title: "Two".into(),
                content: "more".into(),
                scope: "project".into(),
                project_id: Some("p1".into()),
            },
        ];
        assert_eq!(import_notes(&conn, &notes).unwrap(), 2);
        // Re-importing the same ids inserts nothing.
        assert_eq!(import_notes(&conn, &notes).unwrap(), 0);
        // A mix of new and existing ids only inserts the new ones.
        let mixed = vec![
            NoteImport {
                id: "a".into(),
                title: "One".into(),
                content: "changed".into(),
                scope: "global".into(),
                project_id: None,
            },
            NoteImport {
                id: "c".into(),
                title: "Three".into(),
                content: "new".into(),
                scope: "global".into(),
                project_id: None,
            },
        ];
        assert_eq!(import_notes(&conn, &mixed).unwrap(), 1);
        let all = get_all_notes(&conn).unwrap();
        assert_eq!(all.len(), 3);
        assert!(all.iter().any(|n| n.id == "c"));
    }

    #[test]
    fn import_notes_is_atomic_on_failure() {
        let conn = Connection::open_in_memory().unwrap();
        // UNIQUE/NOT NULL/CHECK sont absorbés par INSERT OR IGNORE, la clé
        // étrangère est la seule violation immédiate qui échoue l'INSERT.
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE parents (id TEXT PRIMARY KEY);
             CREATE TABLE notes (
                 id TEXT PRIMARY KEY,
                 title TEXT NOT NULL,
                 content TEXT NOT NULL,
                 scope TEXT NOT NULL,
                 project_id TEXT REFERENCES parents(id),
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             )",
        )
        .unwrap();

        let notes = vec![
            NoteImport {
                id: "a".into(),
                title: "One".into(),
                content: "content".into(),
                scope: "global".into(),
                project_id: None,
            },
            NoteImport {
                id: "b".into(),
                title: "Two".into(),
                content: "content".into(),
                scope: "project".into(),
                project_id: Some("missing".into()),
            },
        ];
        assert!(import_notes(&conn, &notes).is_err());
        // La ligne valide insérée en premier ne doit pas avoir persisté.
        assert!(get_all_notes(&conn).unwrap().is_empty());
    }
}
