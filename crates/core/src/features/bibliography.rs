use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fmt::Write as FmtWrite,
    fs::{self, OpenOptions, read_dir},
    io::{Error, ErrorKind, Result, Write as IoWrite},
};

#[derive(Debug, Serialize, Deserialize)]
pub struct BibEntry {
    pub entry_type: String,
    pub cite_key: String,
    pub data: HashMap<String, String>,
}

/// An entry together with the indexes of its lines in the file
/// (`start` = `@type{key,` line, `end` = closing line, both inclusive).
#[derive(Debug)]
struct EntrySpan {
    entry: BibEntry,
    start: usize,
    end: usize,
}

/// Parses a .bib file, tracking brace depth so that values containing
/// `{` / `}` (e.g. `author = "{Krupke, Dominik}"`) do not break parsing.
/// Lines that do not belong to any entry are ignored.
fn parse_entries(content: &str) -> Vec<EntrySpan> {
    let lines: Vec<&str> = content.lines().collect();
    let mut spans = Vec::new();
    let mut current: Option<(BibEntry, usize)> = None;
    let mut brace_count = 0;

    for (i, line) in lines.iter().enumerate() {
        if current.is_none() && brace_count == 0 && line.starts_with('@') {
            if let Some(open_brace) = line.find('{') {
                let entry_type = line[1..open_brace].trim().to_string();
                let rest = &line[open_brace + 1..];
                let key_end = rest.find(|c| c == ',' || c == '}').unwrap_or(rest.len());
                let cite_key = rest[..key_end].trim().to_string();

                let opens = line.chars().filter(|&c| c == '{').count();
                let closes = line.chars().filter(|&c| c == '}').count();
                brace_count = opens - closes;

                if brace_count == 0 {
                    // one-line entry: header only, nothing else to collect
                    spans.push(EntrySpan {
                        entry: BibEntry {
                            entry_type,
                            cite_key,
                            data: HashMap::new(),
                        },
                        start: i,
                        end: i,
                    });
                    continue;
                }
                current = Some((
                    BibEntry {
                        entry_type,
                        cite_key,
                        data: HashMap::new(),
                    },
                    i,
                ));
            }
            continue;
        }

        if let Some((entry, _)) = &mut current {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                if let Some((key, value)) = trimmed.split_once('=') {
                    let key = key.trim().to_string();
                    let value = value
                        .trim()
                        .trim_end_matches(',')
                        .trim_matches('"')
                        .to_string();
                    entry.data.insert(key, value);
                }
            }

            brace_count += line.chars().filter(|&c| c == '{').count();
            brace_count -= line.chars().filter(|&c| c == '}').count();

            if brace_count == 0 {
                let (entry, start) = current.take().unwrap();
                spans.push(EntrySpan {
                    entry,
                    start,
                    end: i,
                });
            }
        }
    }

    spans
}

pub fn create_bib_file_if_missing(filepath: &str) -> Result<()> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(filepath);

    match file {
        Ok(_) => println!("Fichier créé : {}", filepath),
        Err(ref e) if e.kind() == ErrorKind::AlreadyExists => (),
        Err(e) => return Err(e),
    }

    Ok(())
}

pub fn parse_bib_file(path: &str) -> Result<Vec<BibEntry>> {
    let content = fs::read_to_string(path)?;
    Ok(parse_entries(&content)
        .into_iter()
        .map(|span| span.entry)
        .collect())
}

pub fn check_if_entry_exists(filepath: &str, cite_key_tocheck: &str) -> Result<bool> {
    let entries = parse_bib_file(filepath)?;

    for entry in entries {
        if entry.cite_key == cite_key_tocheck {
            return Ok(false);
        }
    }

    Ok(true)
}

pub fn build_bib_entry(entry_type: &str, cite_key: &str, json: &Value) -> String {
    let mut entry = String::new();

    writeln!(entry, "@{}{{{},", entry_type, cite_key).unwrap();

    if let Value::Object(map) = json {
        let mut keys: Vec<&String> = map.keys().collect();
        keys.sort();
        for key in keys {
            let value_str = match &map[key] {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                _ => continue, // ignore whatever it is
            };
            writeln!(entry, "\t{} = \"{}\",", key, value_str).unwrap();
        }
    }

    entry.push_str("}\n");
    entry
}

pub fn add_entry_to_bib(
    filepath: &str,
    entry_type: &str,
    cite_key: &str,
    json: &Value,
) -> Result<()> {
    if !check_if_entry_exists(filepath, cite_key)? {
        return Err(Error::new(ErrorKind::Other, "Entry already exists"));
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .append(true)
        .open(filepath)?;

    writeln!(file, "{}", build_bib_entry(entry_type, cite_key, json))?;

    Ok(())
}

pub fn get_all_bibs(projectpath: &str) -> Result<Vec<String>> {
    let mut files = Vec::new();

    for entry in read_dir(projectpath)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_file() {
            if let Some(file_ext) = path.extension().and_then(|e| e.to_str()) {
                if file_ext == "bib" {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        files.push(name.to_string());
                    }
                }
            }
        }
    }

    Ok(files)
}

/// Locates the entry with the given cite key and replaces it entirely with
/// the entry built from `entry` (from the sources form).
///
/// Only the lines of the target entry are touched: everything else in the
/// file is preserved as-is, whatever its formatting.
pub fn replace_whole_bib_source(filepath: &str, old_cite_key: &str, entry: &Value) -> Result<()> {
    let content = fs::read_to_string(filepath)?;
    let spans = parse_entries(&content);

    let span = spans
        .iter()
        .find(|s| s.entry.cite_key == old_cite_key)
        .ok_or_else(|| Error::new(ErrorKind::NotFound, "Entry not found"))?;

    let new_entry_type = entry
        .get("entry_type")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let new_cite_key = entry.get("cite_key").and_then(|v| v.as_str()).unwrap_or("");

    // refuse to create a duplicate cite key
    if new_cite_key != old_cite_key && spans.iter().any(|s| s.entry.cite_key == new_cite_key) {
        return Err(Error::new(
            ErrorKind::AlreadyExists,
            "Cite key already exists",
        ));
    }

    let new_data = entry.get("data").cloned().unwrap_or(Value::Null);
    let new_entry_text = build_bib_entry(&new_entry_type, &new_cite_key, &new_data);

    let lines: Vec<&str> = content.lines().collect();
    let mut out = String::new();
    for (i, line) in lines.iter().enumerate() {
        if i == span.start {
            out.push_str(&new_entry_text);
        } else if i < span.start || i > span.end {
            out.push_str(line);
            out.push('\n');
        }
    }

    fs::write(filepath, out)?;
    Ok(())
}

/// Removes the entry with the given cite key from the file.
pub fn delete_whole_bib_source(filepath: &str, cite_key_to_delete: &str) -> Result<()> {
    let content = fs::read_to_string(filepath)?;
    let spans = parse_entries(&content);

    let Some(span) = spans
        .iter()
        .find(|s| s.entry.cite_key == cite_key_to_delete)
    else {
        return Ok(());
    };

    let lines: Vec<&str> = content.lines().collect();
    let mut out = String::new();
    for (i, line) in lines.iter().enumerate() {
        if i >= span.start && i <= span.end {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }

    fs::write(filepath, out)?;
    Ok(())
}

/// Removes a single field from the entry with the given cite key.
/// If the entry has no field left, the whole entry is removed.
pub fn delete_bib_source_value(
    filepath: &str,
    cite_key_to_edit: &str,
    key_to_delete: &str,
) -> Result<()> {
    let content = fs::read_to_string(filepath)?;
    let lines: Vec<&str> = content.lines().collect();
    let spans = parse_entries(&content);

    let Some(span) = spans.iter().find(|s| s.entry.cite_key == cite_key_to_edit) else {
        return Ok(());
    };

    let mut out = String::new();

    if span.start < span.end {
        let mut kept: Vec<&str> = Vec::new();
        for i in span.start + 1..span.end {
            let trimmed = lines[i].trim();
            if trimmed.is_empty() {
                continue;
            }
            let key = trimmed.split('=').next().unwrap_or("").trim();
            if key != key_to_delete {
                kept.push(lines[i]);
            }
        }

        if kept.is_empty() {
            // no field left: remove the whole entry
            for (i, line) in lines.iter().enumerate() {
                if i >= span.start && i <= span.end {
                    continue;
                }
                out.push_str(line);
                out.push('\n');
            }
        } else {
            for (i, line) in lines.iter().enumerate() {
                if i == span.start {
                    out.push_str(line);
                    out.push('\n');
                    for k in &kept {
                        out.push_str(k);
                        out.push('\n');
                    }
                    out.push_str("}\n");
                } else if i < span.start || i > span.end {
                    out.push_str(line);
                    out.push('\n');
                }
            }
        }
    } else {
        // one-line entry: keep it unchanged
        out = content;
    }

    fs::write(filepath, out)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const SAMPLE: &str = "@online{cpsat-primer,
    author = \"{Krupke, Dominik}\",
    title = \"{CP-SAT Primer : Effective CP-SAT Optimization Techniques}\",
    url = \"{https://d-krupke.github.io/cpsat-primer/}\",
},

@online{ortools,
    author = \"{Google}\",
    title = \"{Google OR-Tools}\",
    url = \"{https://developers.google.com/optimization/}\",
},
";

    fn write_sample(dir: &tempfile::TempDir) -> String {
        let path = dir.path().join("refs.bib");
        fs::write(&path, SAMPLE).unwrap();
        path.to_string_lossy().to_string()
    }

    #[test]
    fn parses_entries_with_braces_in_values() {
        let dir = tempdir().unwrap();
        let path = write_sample(&dir);

        let entries = parse_bib_file(&path).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].cite_key, "cpsat-primer");
        assert_eq!(entries[0].data["author"], "{Krupke, Dominik}");
        assert_eq!(
            entries[0].data["url"],
            "{https://d-krupke.github.io/cpsat-primer/}"
        );
        assert_eq!(entries[1].cite_key, "ortools");
    }

    #[test]
    fn replace_only_touches_the_target_entry() {
        let dir = tempdir().unwrap();
        let path = write_sample(&dir);

        let json = serde_json::json!({
            "entry_type": "online",
            "cite_key": "cpsat-primer",
            "data": { "author": "A, B", "title": "New title" }
        });
        replace_whole_bib_source(&path, "cpsat-primer", &json).unwrap();

        let entries = parse_bib_file(&path).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].cite_key, "cpsat-primer");
        assert_eq!(entries[0].data["author"], "A, B");
        assert_eq!(entries[0].data["title"], "New title");
        // other entry untouched
        assert_eq!(entries[1].cite_key, "ortools");
        assert_eq!(
            entries[1].data["url"],
            "{https://developers.google.com/optimization/}"
        );
    }

    #[test]
    fn replace_refuses_duplicate_cite_key() {
        let dir = tempdir().unwrap();
        let path = write_sample(&dir);

        let json = serde_json::json!({
            "entry_type": "online",
            "cite_key": "ortools",
            "data": {}
        });
        let res = replace_whole_bib_source(&path, "cpsat-primer", &json);
        assert!(res.is_err());
    }

    #[test]
    fn delete_removes_only_the_target_entry() {
        let dir = tempdir().unwrap();
        let path = write_sample(&dir);

        delete_whole_bib_source(&path, "cpsat-primer").unwrap();

        let entries = parse_bib_file(&path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].cite_key, "ortools");
    }

    #[test]
    fn delete_value_removes_one_field_and_keeps_the_rest() {
        let dir = tempdir().unwrap();
        let path = write_sample(&dir);

        delete_bib_source_value(&path, "ortools", "url").unwrap();

        let entries = parse_bib_file(&path).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].cite_key, "ortools");
        assert!(!entries[1].data.contains_key("url"));
        assert_eq!(entries[1].data["title"], "{Google OR-Tools}");
        // first entry untouched
        assert_eq!(
            entries[0].data["url"],
            "{https://d-krupke.github.io/cpsat-primer/}"
        );
    }

    #[test]
    fn delete_last_field_removes_the_entry() {
        let dir = tempdir().unwrap();
        let path = write_sample(&dir);

        delete_bib_source_value(&path, "cpsat-primer", "author").unwrap();
        delete_bib_source_value(&path, "cpsat-primer", "title").unwrap();
        delete_bib_source_value(&path, "cpsat-primer", "url").unwrap();

        let entries = parse_bib_file(&path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].cite_key, "ortools");
    }

    #[test]
    fn one_line_entry_does_not_panic() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("one.bib");
        fs::write(&path, "@online{key, title = \"x\"},\n").unwrap();
        let path = path.to_string_lossy().to_string();

        let entries = parse_bib_file(&path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].cite_key, "key");

        // editing operations must not crash on it either
        delete_bib_source_value(&path, "key", "title").unwrap();
        let entries = parse_bib_file(&path).unwrap();
        assert_eq!(entries.len(), 1);
    }
}
