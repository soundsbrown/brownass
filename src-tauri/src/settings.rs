//! App settings, stored as JSON in the app config directory.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "settings.json";

#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// ffmpeg executable chosen by the user; ffprobe is expected next to it.
    pub ffmpeg_path: Option<PathBuf>,
}

impl Settings {
    /// Loads settings, falling back to defaults if the file is missing or unreadable.
    pub fn load(app: &AppHandle) -> Self {
        file_path(app)
            .ok()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// Writes settings via a temp file and rename, so a crash can't leave a
    /// half-written file behind.
    pub fn save(&self, app: &AppHandle) -> Result<(), String> {
        let path = file_path(app)?;
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &path).map_err(|e| e.to_string())
    }
}

fn file_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(FILE_NAME))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_use_defaults() {
        let s: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn round_trips_ffmpeg_path() {
        let s = Settings {
            ffmpeg_path: Some(PathBuf::from(r"C:\tools\ffmpeg\bin\ffmpeg.exe")),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("ffmpegPath"));
        assert_eq!(serde_json::from_str::<Settings>(&json).unwrap(), s);
    }
}
