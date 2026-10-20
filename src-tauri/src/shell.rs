//! Showing folders and files in the system file manager, and app-level
//! commands (logging from the UI, opening the log folder).

use std::ffi::OsString;
use std::path::Path;
use std::process::Command;

use tauri::{AppHandle, Manager};

/// Opens `dir` in the file manager.
pub fn open_folder(dir: &Path) -> Result<(), String> {
    let program = if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    Command::new(program)
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open the folder: {e}"))
}

/// Opens the folder containing `file`, with the file selected (on Windows).
pub fn reveal_file(file: &Path) -> Result<(), String> {
    if cfg!(windows) {
        let mut select = OsString::from("/select,");
        select.push(file);
        Command::new("explorer")
            .arg(select)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not show the file: {e}"))
    } else {
        open_folder(file.parent().unwrap_or(file))
    }
}

/// Writes a message from the UI (e.g. an uncaught error) to the log file.
#[tauri::command]
pub fn log_from_ui(level: String, message: String) {
    match level.as_str() {
        "error" => log::error!(target: "ui", "{message}"),
        "warn" => log::warn!(target: "ui", "{message}"),
        _ => log::info!(target: "ui", "{message}"),
    }
}

#[tauri::command]
pub async fn open_log_folder(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open_folder(&dir)
}
