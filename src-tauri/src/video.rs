//! Opening a video: file dialog, ffprobe, and asset-protocol access.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::dialogs;
use crate::ffmpeg::{self, FfmpegState};
use crate::project_files::ProjectFiles;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "mpg", "mpeg", "ts", "m2ts", "mts",
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub path: PathBuf,
    /// Display size, after applying any rotation metadata.
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration: f64,
    pub video_codec: String,
    pub audio_codec: Option<String>,
}

/// The video opened via the dialog. Commands that work on "the video" use
/// this rather than accepting a path from the frontend.
#[derive(Default)]
pub struct OpenedVideo(Mutex<Option<VideoInfo>>);

impl OpenedVideo {
    pub fn get(&self) -> Option<VideoInfo> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn set(&self, info: VideoInfo) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(info);
    }
}

/// Asks the user for a video, probes it and grants the webview read access to
/// that one file. `Ok(None)` means the dialog was cancelled.
#[tauri::command]
pub async fn open_video(
    app: AppHandle,
    window: WebviewWindow,
    ffmpeg: State<'_, FfmpegState>,
    opened: State<'_, OpenedVideo>,
    project: State<'_, ProjectFiles>,
) -> Result<Option<VideoInfo>, String> {
    let paths = ffmpeg.paths()?;
    let dialog = app
        .dialog()
        .file()
        .set_title("Open video")
        .add_filter("Video", VIDEO_EXTENSIONS)
        .add_filter("All files", &["*"]);
    let Some(path) = dialogs::pick_file(dialog).await else {
        return Ok(None);
    };

    let info = probe(&paths.ffprobe, &path).await.inspect_err(|e| {
        log::warn!("Could not open {}: {e}", path.display());
    })?;
    log::info!(
        "Opened {} ({}x{}, {:.3} fps, {:.2} s, {} / {:?})",
        path.display(),
        info.width,
        info.height,
        info.fps,
        info.duration,
        info.video_codec,
        info.audio_codec
    );
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;
    if let Some(name) = path.file_name() {
        let _ = window.set_title(&format!("{} — BrownASS", name.to_string_lossy()));
    }
    opened.set(info.clone());
    // Until load_project runs for this video, nothing may be saved.
    project.clear();
    Ok(Some(info))
}

async fn probe(ffprobe: &Path, video: &Path) -> Result<VideoInfo, String> {
    let args = [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
    ]
    .map(OsStr::new)
    .into_iter()
    .chain([video.as_os_str()]);
    let json = ffmpeg::run(ffprobe, args)
        .await
        .map_err(|e| e.to_string())?;
    parse_probe(&json, video)
}

#[derive(Deserialize)]
struct Probe {
    #[serde(default)]
    streams: Vec<Stream>,
    format: Option<Format>,
}

#[derive(Deserialize)]
struct Stream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    duration: Option<String>,
    #[serde(default)]
    disposition: Disposition,
    #[serde(default)]
    side_data_list: Vec<SideData>,
}

#[derive(Deserialize, Default)]
struct Disposition {
    #[serde(default)]
    attached_pic: u8,
}

#[derive(Deserialize)]
struct SideData {
    rotation: Option<f64>,
}

#[derive(Deserialize)]
struct Format {
    duration: Option<String>,
}

fn parse_probe(json: &str, path: &Path) -> Result<VideoInfo, String> {
    let probe: Probe =
        serde_json::from_str(json).map_err(|e| format!("Unexpected ffprobe output: {e}"))?;

    // Cover art in audio files shows up as a video stream; skip it.
    let video = probe
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video") && s.disposition.attached_pic == 0)
        .ok_or("This file has no video stream.")?;
    let audio = probe
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("audio"));

    let (Some(mut width), Some(mut height)) = (video.width, video.height) else {
        return Err("Could not determine the video size.".into());
    };
    let quarter_turn = video
        .side_data_list
        .iter()
        .filter_map(|d| d.rotation)
        .any(|r| (r.abs() % 180.0 - 90.0).abs() < 1.0);
    if quarter_turn {
        std::mem::swap(&mut width, &mut height);
    }

    let fps = [&video.avg_frame_rate, &video.r_frame_rate]
        .into_iter()
        .find_map(|r| r.as_deref().and_then(parse_rate))
        .ok_or("Could not determine the frame rate.")?;

    let duration = probe
        .format
        .and_then(|f| f.duration)
        .or_else(|| video.duration.clone())
        .and_then(|d| d.parse::<f64>().ok())
        .filter(|d| *d > 0.0)
        .ok_or("Could not determine the duration.")?;

    Ok(VideoInfo {
        path: path.to_owned(),
        width,
        height,
        fps,
        duration,
        video_codec: video.codec_name.clone().unwrap_or_default(),
        audio_codec: audio.and_then(|a| a.codec_name.clone()),
    })
}

/// Parses an ffprobe rate such as `30000/1001`; `0/0` means unknown.
fn parse_rate(rate: &str) -> Option<f64> {
    let (num, den) = rate.split_once('/')?;
    let (num, den): (f64, f64) = (num.parse().ok()?, den.parse().ok()?);
    (num > 0.0 && den > 0.0).then(|| num / den)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MP4: &str = r#"{
        "streams": [
            {
                "index": 0, "codec_name": "h264", "codec_type": "video",
                "width": 1280, "height": 720,
                "r_frame_rate": "30000/1001", "avg_frame_rate": "30000/1001",
                "duration": "2.969633",
                "disposition": { "default": 1, "attached_pic": 0 }
            },
            {
                "index": 1, "codec_name": "aac", "codec_type": "audio",
                "r_frame_rate": "0/0", "avg_frame_rate": "0/0", "duration": "3.000000",
                "disposition": { "default": 1, "attached_pic": 0 }
            }
        ],
        "format": { "duration": "3.000000" }
    }"#;

    #[test]
    fn parses_mp4() {
        let info = parse_probe(MP4, Path::new("clip.mp4")).unwrap();
        assert_eq!(
            info,
            VideoInfo {
                path: "clip.mp4".into(),
                width: 1280,
                height: 720,
                fps: 30000.0 / 1001.0,
                duration: 3.0,
                video_codec: "h264".into(),
                audio_codec: Some("aac".into()),
            }
        );
    }

    #[test]
    fn swaps_size_for_rotated_video() {
        let json = r#"{
            "streams": [{
                "codec_name": "hevc", "codec_type": "video", "width": 1920, "height": 1080,
                "avg_frame_rate": "30/1",
                "side_data_list": [{ "side_data_type": "Display Matrix", "rotation": -90 }]
            }],
            "format": { "duration": "10.5" }
        }"#;
        let info = parse_probe(json, Path::new("phone.mov")).unwrap();
        assert_eq!((info.width, info.height), (1080, 1920));
        assert_eq!(info.audio_codec, None);
    }

    #[test]
    fn skips_cover_art_and_falls_back_to_r_frame_rate() {
        let json = r#"{
            "streams": [
                { "codec_name": "mjpeg", "codec_type": "video", "width": 500, "height": 500,
                  "avg_frame_rate": "0/0", "disposition": { "attached_pic": 1 } },
                { "codec_name": "vp9", "codec_type": "video", "width": 640, "height": 360,
                  "avg_frame_rate": "0/0", "r_frame_rate": "24000/1001", "duration": "4.2" }
            ]
        }"#;
        let info = parse_probe(json, Path::new("x.mkv")).unwrap();
        assert_eq!(info.video_codec, "vp9");
        assert_eq!(info.fps, 24000.0 / 1001.0);
        assert_eq!(info.duration, 4.2);
    }

    #[test]
    fn rejects_audio_only_files() {
        let json = r#"{ "streams": [{ "codec_type": "audio", "codec_name": "mp3" }],
                        "format": { "duration": "60" } }"#;
        assert!(parse_probe(json, Path::new("a.mp3")).is_err());
    }

    #[test]
    fn parses_rates() {
        assert_eq!(parse_rate("25/1"), Some(25.0));
        assert_eq!(parse_rate("0/0"), None);
        assert_eq!(parse_rate("garbage"), None);
    }
}
