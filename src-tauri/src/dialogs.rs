//! Native file dialogs, opened from Rust so the frontend needs no dialog
//! permissions.

use std::path::PathBuf;

use tauri::Runtime;
use tauri_plugin_dialog::FileDialogBuilder;

/// Shows an open-file dialog and waits for the choice; `None` if cancelled.
pub async fn pick_file<R: Runtime>(dialog: FileDialogBuilder<R>) -> Option<PathBuf> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    dialog.pick_file(move |file| {
        let _ = tx.send(file);
    });
    rx.await
        .ok()
        .flatten()
        .and_then(|file| file.into_path().ok())
}
