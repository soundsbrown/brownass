//! ffmpeg / ffprobe sidecar runner.
//!
//! Sidecars are only ever spawned from Rust with fixed argument arrays; the
//! frontend has no shell permissions.

use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

/// Returns the first line of `ffmpeg -version` from the bundled sidecar.
#[tauri::command]
pub async fn ffmpeg_version(app: AppHandle) -> Result<String, String> {
    let output = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar not found: {e}"))?
        .args(["-hide_banner", "-version"])
        .output()
        .await
        .map_err(|e| format!("failed to run ffmpeg: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "ffmpeg exited with {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(first_line(&String::from_utf8_lossy(&output.stdout)))
}

fn first_line(s: &str) -> String {
    s.lines().next().unwrap_or_default().trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_line_takes_version_line() {
        let out = "ffmpeg version 8.1.2 Copyright (c)\r\nbuilt with gcc\n";
        assert_eq!(first_line(out), "ffmpeg version 8.1.2 Copyright (c)");
    }

    #[test]
    fn first_line_handles_empty_output() {
        assert_eq!(first_line(""), "");
    }
}
