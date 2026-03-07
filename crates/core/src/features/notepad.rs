// use rusqlite::{Connection, Result};
// use uuid::Uuid;

// pub struct Note {
//     pub id: String,
//     pub title: String,
//     pub content: String,
//     pub scope: String,
//     pub project_id: Option<String>,
// }

// pub fn add_note(
//     conn: &Connection,
//     title: &str,
//     content: &str,
//     scope: &str,
//     project_id: Option<&str>,
// ) -> Result<()> {
//     let id = Uuid::new_v4().to_string();

//     conn.execute(
//         "INSERT INTO notes (id, title, content, scope, project_id)
//         VALUES (?1, ?2, ?3, ?4, ?5)",
//         (&id, &title, &content, &scope, &project_id),
//     )?;
//     Ok(())
// }

// pub fn