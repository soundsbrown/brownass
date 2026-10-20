//! Stylesheets ("house styles"): app-wide files of named styles that projects
//! link to. The frontend owns the format; this only stores JSON by id in the
//! app data folder.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::project_files::write_atomic;

#[derive(Debug, Serialize, PartialEq)]
pub struct StoredStylesheet {
    id: String,
    json: String,
}

/// Ids become file names, so only allow a safe, simple alphabet.
fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("stylesheets"))
        .map_err(|e| e.to_string())
}

fn file(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if valid_id(id) {
        Ok(dir.join(format!("{id}.json")))
    } else {
        Err(format!("Invalid stylesheet id: {id:?}"))
    }
}

fn list_in(dir: &Path) -> io::Result<Vec<StoredStylesheet>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut sheets = Vec::new();
    for entry in entries {
        let path = entry?.path();
        let Some(id) = path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_suffix(".json"))
        else {
            continue;
        };
        if valid_id(id) {
            sheets.push(StoredStylesheet {
                id: id.to_owned(),
                json: fs::read_to_string(&path)?,
            });
        }
    }
    sheets.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(sheets)
}

#[tauri::command]
pub async fn list_stylesheets(app: AppHandle) -> Result<Vec<StoredStylesheet>, String> {
    list_in(&dir(&app)?).map_err(|e| format!("Could not read stylesheets: {e}"))
}

#[tauri::command]
pub async fn save_stylesheet(app: AppHandle, id: String, json: String) -> Result<(), String> {
    let dir = dir(&app)?;
    let path = file(&dir, &id)?;
    fs::create_dir_all(&dir)
        .and_then(|()| write_atomic(&path, json.as_bytes()))
        .map_err(|e| format!("Could not save the stylesheet: {e}"))
}

#[tauri::command]
pub async fn delete_stylesheet(app: AppHandle, id: String) -> Result<(), String> {
    let path = file(&dir(&app)?, &id)?;
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => {
            Err(format!("Could not delete the stylesheet: {e}"))
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_ids_that_could_escape_the_folder() {
        assert!(valid_id("house-style_2"));
        assert!(valid_id("6f1c2d3e-aaaa-4bbb-8ccc-123456789abc"));
        for bad in [
            "",
            "..",
            "../x",
            "a/b",
            "a\\b",
            "a.json",
            "c:",
            &"x".repeat(65),
        ] {
            assert!(!valid_id(bad), "{bad:?}");
        }
        assert!(file(Path::new("d"), "../evil").is_err());
    }

    #[test]
    fn lists_saved_stylesheets_in_id_order() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(list_in(&dir.path().join("missing")).unwrap(), vec![]);

        for (id, json) in [("b", "{\"n\":2}"), ("a", "{\"n\":1}")] {
            write_atomic(&file(dir.path(), id).unwrap(), json.as_bytes()).unwrap();
        }
        fs::write(dir.path().join("notes.txt"), "ignored").unwrap();
        fs::write(dir.path().join("bad name.json"), "ignored").unwrap();

        let ids: Vec<_> = list_in(dir.path())
            .unwrap()
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(ids, ["a", "b"]);
    }
}
