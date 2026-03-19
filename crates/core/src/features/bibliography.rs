use std::{
    fs::{File, read_dir, OpenOptions},
    io::{BufRead, BufReader, Result, Error, ErrorKind, Write as IoWrite},
    fmt::Write as FmtWrite,
    collections::HashMap,
};
use serde::{Serialize, Deserialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
pub struct BibEntry {
    pub entry_type: String,
    pub cite_key: String,
    pub data: HashMap<String, String>
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
    let file = File::open(path)?;
    let reader = BufReader::new(file);

    let mut entries = Vec::new();
    let mut current_entry: Option<BibEntry> = None;
    let mut brace_count = 0;

    for line in reader.lines() {
        let line = line?;

        // new entry, begins with @
        if line.starts_with('@') && brace_count == 0 {
            // get entry_type and cite_key
            if let Some(start) = line.find('@') {
                if let Some(open_brace) = line.find('{') {
                    let entry_type = line[start + 1..open_brace].trim().to_string();
                    let cite_key = line[open_brace + 1..line.find(',').unwrap_or(open_brace)].trim().to_string();

                    current_entry = Some(BibEntry {
                        entry_type,
                        cite_key,
                        data: HashMap::new(),
                    });

                    // init bracket count
                    brace_count = line.chars().filter(|&c| c == '{').count() - line.chars().filter(|&c| c == '}').count();
                }
            }
            continue;
        }

        // inside an entry
        if let Some(entry) = &mut current_entry {
            let line = line.trim();
            if line.is_empty() { continue };

            if let Some((key, value)) = line.split_once("=") {
                let key = key.trim().to_string();

                let value = value
                    .trim()
                    .trim_end_matches(',')
                    .trim_matches('"')
                    .to_string();

                entry.data.insert(key, value);
            }

            // update bracket count
            brace_count += line.chars().filter(|&c| c == '{').count();
            brace_count -= line.chars().filter(|&c| c == '}').count();

            // end of entry
            if brace_count == 0 {
                entries.push(current_entry.take().unwrap())
            }
        }
    }

    Ok(entries)
}

pub fn check_if_entry_exists(
    filepath: &str,
    cite_key_tocheck: &str
) -> Result<bool> {
    let entries: Vec<BibEntry> = match parse_bib_file(filepath) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };

    for entry in entries {
        if entry.cite_key == cite_key_tocheck {
            return Ok(false)
        }
    }

    Ok(true)
}

pub fn build_bib_entry(
    entry_type: &str,
    cite_key: &str,
    json: &Value
) -> String {
    let mut entry = String::new();

    // to escape a { or }, we have to double it
    writeln!(entry, "@{}{{{},", entry_type, cite_key).unwrap();

    if let Value::Object(map) = json {
        for (key, value) in map {
            let value_str = match value {
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
    json: &Value
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

pub fn get_all_bibs(
    projectpath: &str
) -> Result<Vec<String>> {
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
