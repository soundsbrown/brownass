//! Stylesheets ("house styles"): files of named styles that projects link to,
//! kept in a visible folder (`Documents\BrownASS\Stylesheets`) as
//! `<name>.bwstyle`. The frontend owns the format; this stores JSON, finds
//! files by the `id` inside them, and keeps file names in step with names.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::project_files::write_atomic;

const EXTENSION: &str = "bwstyle";

/// Which file holds each stylesheet id, as of the last scan or save.
#[derive(Default)]
pub struct StylesheetFiles(Mutex<HashMap<String, PathBuf>>);

#[derive(Debug, Serialize, PartialEq)]
pub struct StoredStylesheet {
    id: String,
    json: String,
}

/// Ids identify stylesheets across renames; keep them to a simple alphabet.
fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .map(|d| d.join("BrownASS").join("Stylesheets"))
        .map_err(|e| e.to_string())
}

/// Where stylesheets were kept before they moved to Documents.
fn legacy_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("stylesheets"))
}

/// A file name stem for a stylesheet name, safe on Windows.
fn file_stem(name: &str) -> String {
    const RESERVED: [&str; 4] = ["CON", "PRN", "AUX", "NUL"];
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .take(100)
        .collect();
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']).to_owned();
    let upper = trimmed.to_uppercase();
    let reserved = RESERVED.contains(&upper.as_str())
        || ((upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.len() == 4
            && upper.as_bytes()[3].is_ascii_digit());
    match (trimmed.is_empty(), reserved) {
        (true, _) => "Stylesheet".to_owned(),
        (false, true) => format!("{trimmed}_"),
        (false, false) => trimmed,
    }
}

/// Whether `path` is already a fine file for a stylesheet with this stem:
/// `stem.bwstyle` or a numbered duplicate like `stem (2).bwstyle`.
fn fits_stem(path: &Path, stem: &str) -> bool {
    let Some(current) = path.file_stem().and_then(|s| s.to_str()) else {
        return false;
    };
    let current = current.to_lowercase();
    let stem = stem.to_lowercase();
    current == stem
        || current
            .strip_prefix(&format!("{stem} ("))
            .and_then(|rest| rest.strip_suffix(')'))
            .is_some_and(|n| n.parse::<u32>().is_ok())
}

/// `stem.bwstyle`, or `stem (2).bwstyle`, ... whichever doesn't exist yet.
fn free_path(dir: &Path, stem: &str) -> PathBuf {
    std::iter::once(dir.join(format!("{stem}.{EXTENSION}")))
        .chain((2..).map(|n| dir.join(format!("{stem} ({n}).{EXTENSION}"))))
        .find(|p| !p.exists())
        .expect("an unused file name exists")
}

/// The `id` field of a stylesheet file's JSON.
fn id_of(json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let id = value.get("id")?.as_str()?;
    valid_id(id).then(|| id.to_owned())
}

/// Reads every stylesheet file in `dir`. A second file with an id already
/// seen is ignored (e.g. a copy made in Explorer), so ids stay unique.
fn scan(dir: &Path) -> io::Result<(Vec<StoredStylesheet>, HashMap<String, PathBuf>)> {
    let mut paths: Vec<PathBuf> = match fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case(EXTENSION))
            })
            .collect(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e),
    };
    paths.sort();
    let mut sheets = Vec::new();
    let mut files = HashMap::new();
    for path in paths {
        let Ok(json) = fs::read_to_string(&path) else {
            continue;
        };
        let Some(id) = id_of(&json) else {
            continue;
        };
        if files.contains_key(&id) {
            continue;
        }
        files.insert(id.clone(), path);
        sheets.push(StoredStylesheet { id, json });
    }
    Ok((sheets, files))
}

/// Moves stylesheets from the old app data folder into `dir`, unless a
/// stylesheet with the same id is already there.
fn migrate(legacy: &Path, dir: &Path) -> io::Result<()> {
    let Ok(entries) = fs::read_dir(legacy) else {
        return Ok(());
    };
    let (_, existing) = scan(dir)?;
    fs::create_dir_all(dir)?;
    for path in entries.filter_map(|e| e.ok().map(|e| e.path())) {
        if path.extension().is_none_or(|e| e != "json") {
            continue;
        }
        let json = fs::read_to_string(&path)?;
        if let Some(id) = id_of(&json)
            && !existing.contains_key(&id)
        {
            let name = serde_json::from_str::<serde_json::Value>(&json)
                .ok()
                .and_then(|v| v.get("name")?.as_str().map(str::to_owned))
                .unwrap_or_default();
            write_atomic(&free_path(dir, &file_stem(&name)), json.as_bytes())?;
        }
        fs::remove_file(&path)?;
    }
    let _ = fs::remove_dir(legacy);
    Ok(())
}

/// Writes a stylesheet, naming (or renaming) its file after `name`.
fn save_in(
    dir: &Path,
    files: &mut HashMap<String, PathBuf>,
    id: &str,
    name: &str,
    json: &str,
) -> io::Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let stem = file_stem(name);
    let current = files.get(id).cloned();
    let target = match &current {
        Some(path) if fits_stem(path, &stem) => path.clone(),
        _ => free_path(dir, &stem),
    };
    write_atomic(&target, json.as_bytes())?;
    if let Some(old) = current.filter(|old| *old != target) {
        let _ = fs::remove_file(old);
    }
    files.insert(id.to_owned(), target.clone());
    Ok(target)
}

#[tauri::command]
pub async fn list_stylesheets(
    app: AppHandle,
    files: State<'_, StylesheetFiles>,
) -> Result<Vec<StoredStylesheet>, String> {
    let dir = dir(&app)?;
    if let Some(legacy) = legacy_dir(&app) {
        migrate(&legacy, &dir).map_err(|e| format!("Could not move old stylesheets: {e}"))?;
    }
    let (sheets, found) = scan(&dir).map_err(|e| format!("Could not read stylesheets: {e}"))?;
    *files.0.lock().unwrap_or_else(|e| e.into_inner()) = found;
    Ok(sheets)
}

#[tauri::command]
pub async fn save_stylesheet(
    app: AppHandle,
    files: State<'_, StylesheetFiles>,
    id: String,
    name: String,
    json: String,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err(format!("Invalid stylesheet id: {id:?}"));
    }
    let dir = dir(&app)?;
    let mut files = files.0.lock().unwrap_or_else(|e| e.into_inner());
    save_in(&dir, &mut files, &id, &name, &json)
        .map(|_| ())
        .map_err(|e| format!("Could not save the stylesheet: {e}"))
}

#[tauri::command]
pub async fn delete_stylesheet(
    files: State<'_, StylesheetFiles>,
    id: String,
) -> Result<(), String> {
    let Some(path) = files
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id)
    else {
        return Ok(());
    };
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => {
            Err(format!("Could not delete the stylesheet: {e}"))
        }
        _ => Ok(()),
    }
}

/// Opens the stylesheets folder in the file manager.
#[tauri::command]
pub async fn open_stylesheets_folder(app: AppHandle) -> Result<(), String> {
    let dir = dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let program = if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    std::process::Command::new(program)
        .arg(&dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open the folder: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sheet(id: &str, name: &str) -> String {
        format!(r#"{{"version":1,"id":"{id}","name":"{name}","styles":{{}}}}"#)
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn makes_safe_file_names() {
        assert_eq!(file_stem("House style"), "House style");
        assert_eq!(file_stem("Client: A/B?"), "Client_ A_B_");
        assert_eq!(file_stem("  trailing dots... "), "trailing dots");
        assert_eq!(file_stem("con"), "con_");
        assert_eq!(file_stem("COM3"), "COM3_");
        assert_eq!(file_stem("Comic"), "Comic");
        assert_eq!(file_stem(""), "Stylesheet");
    }

    #[test]
    fn names_files_after_stylesheets_and_renames_them() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("Stylesheets");
        let mut files = HashMap::new();

        save_in(
            &dir,
            &mut files,
            "a",
            "House style",
            &sheet("a", "House style"),
        )
        .unwrap();
        // Same name for another stylesheet: numbered, not overwritten.
        save_in(
            &dir,
            &mut files,
            "b",
            "House style",
            &sheet("b", "House style"),
        )
        .unwrap();
        assert_eq!(
            names(&dir),
            ["House style (2).bwstyle", "House style.bwstyle"]
        );

        // Saving again keeps the numbered file; renaming moves it.
        save_in(
            &dir,
            &mut files,
            "b",
            "House style",
            &sheet("b", "House style"),
        )
        .unwrap();
        save_in(&dir, &mut files, "a", "Client", &sheet("a", "Client")).unwrap();
        assert_eq!(names(&dir), ["Client.bwstyle", "House style (2).bwstyle"]);
    }

    #[test]
    fn finds_stylesheets_by_the_id_inside_them() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        fs::write(
            dir.join("Renamed in Explorer.bwstyle"),
            sheet("a", "House style"),
        )
        .unwrap();
        fs::write(dir.join("Copy of it.bwstyle"), sheet("a", "House style")).unwrap();
        fs::write(dir.join("broken.bwstyle"), "{").unwrap();
        fs::write(dir.join("notes.txt"), "ignored").unwrap();

        let (sheets, files) = scan(dir).unwrap();
        assert_eq!(sheets.len(), 1, "duplicate id and broken file are skipped");
        assert_eq!(sheets[0].id, "a");
        assert_eq!(files["a"], dir.join("Copy of it.bwstyle"));
    }

    #[test]
    fn moves_old_stylesheets_into_the_new_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let legacy = tmp.path().join("appdata").join("stylesheets");
        let dir = tmp.path().join("Documents").join("Stylesheets");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("abc.json"), sheet("abc", "House style")).unwrap();

        migrate(&legacy, &dir).unwrap();
        assert_eq!(names(&dir), ["House style.bwstyle"]);
        assert!(!legacy.exists());
        let (sheets, _) = scan(&dir).unwrap();
        assert_eq!(sheets[0].id, "abc");

        // Nothing to do the second time.
        migrate(&legacy, &dir).unwrap();
        assert_eq!(names(&dir), ["House style.bwstyle"]);
    }

    #[test]
    fn rejects_unsafe_ids() {
        assert!(valid_id("6f1c2d3e-aaaa-4bbb-8ccc-123456789abc"));
        for bad in ["", "..", "../x", "a/b", "a.b", &"x".repeat(65)] {
            assert!(!valid_id(bad), "{bad:?}");
        }
        assert_eq!(id_of(&sheet("../x", "n")), None);
    }
}
