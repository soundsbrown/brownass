//! App settings, stored as JSON in the app config directory.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "settings.json";

#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// ffmpeg executable chosen by the user; ffprobe is expected next to it.
    pub ffmpeg_path: Option<PathBuf>,
    /// Recently opened videos, most recent first.
    pub recent_videos: Vec<PathBuf>,
}

/// How many recent videos to remember.
pub const MAX_RECENT: usize = 10;

impl Settings {
    /// Puts `video` at the front of the recent list (once).
    pub fn add_recent(&mut self, video: &Path) {
        self.recent_videos.retain(|p| !same_path(p, video));
        self.recent_videos.insert(0, video.to_owned());
        self.recent_videos.truncate(MAX_RECENT);
    }

    pub fn is_recent(&self, video: &Path) -> bool {
        self.recent_videos.iter().any(|p| same_path(p, video))
    }

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

/// Paths on Windows are case-insensitive.
fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        a.as_os_str().eq_ignore_ascii_case(b.as_os_str())
    } else {
        a == b
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
    fn keeps_recent_videos_unique_newest_first_and_bounded() {
        let mut s = Settings::default();
        for n in 0..12 {
            s.add_recent(&PathBuf::from(format!(r"C:\v\{n}.mp4")));
        }
        assert_eq!(s.recent_videos.len(), MAX_RECENT);
        assert_eq!(s.recent_videos[0], PathBuf::from(r"C:\v\11.mp4"));
        s.add_recent(Path::new(r"C:\v\5.mp4"));
        assert_eq!(s.recent_videos[0], PathBuf::from(r"C:\v\5.mp4"));
        assert_eq!(
            s.recent_videos
                .iter()
                .filter(|p| p.ends_with("5.mp4"))
                .count(),
            1
        );
        assert!(s.is_recent(Path::new(r"C:\v\9.mp4")));
        assert!(!s.is_recent(Path::new(r"C:\v\0.mp4")), "fell off the end");
    }

    #[test]
    fn round_trips_ffmpeg_path() {
        let s = Settings {
            ffmpeg_path: Some(PathBuf::from(r"C:\tools\ffmpeg\bin\ffmpeg.exe")),
            ..Settings::default()
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("ffmpegPath"));
        assert_eq!(serde_json::from_str::<Settings>(&json).unwrap(), s);
    }
}
