//! Exporting with ffmpeg: burning subtitles into a copy of the video,
//! rendering single test frames, and muxing soft subtitles into an MKV.
//!
//! Each run gets a temporary folder holding `subs.ass` and copies of the
//! fonts it uses, and ffmpeg runs inside it, so the filter string only ever
//! contains `ass=subs.ass:fontsdir=fonts`: Windows paths (drive colons,
//! backslashes, spaces) never need escaping. The input is always the opened
//! (original) video.

use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::sync::oneshot;

use crate::ffmpeg::{self, FfmpegPaths, FfmpegState};
use crate::fonts::FontIndex;
use crate::process;
use crate::video::{OpenedVideo, VideoInfo};

const SUBS_FILE: &str = "subs.ass";
const FONTS_DIR: &str = "fonts";
const ASS_FILTER: &str = "ass=subs.ass:fontsdir=fonts";
const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Encoder {
    X264,
    X265,
    NvencH264,
    NvencHevc,
    QsvH264,
    QsvHevc,
    AmfH264,
    AmfHevc,
}

impl Encoder {
    const ALL: [Encoder; 8] = [
        Encoder::X264,
        Encoder::X265,
        Encoder::NvencH264,
        Encoder::NvencHevc,
        Encoder::QsvH264,
        Encoder::QsvHevc,
        Encoder::AmfH264,
        Encoder::AmfHevc,
    ];

    fn ffmpeg_name(self) -> &'static str {
        match self {
            Encoder::X264 => "libx264",
            Encoder::X265 => "libx265",
            Encoder::NvencH264 => "h264_nvenc",
            Encoder::NvencHevc => "hevc_nvenc",
            Encoder::QsvH264 => "h264_qsv",
            Encoder::QsvHevc => "hevc_qsv",
            Encoder::AmfH264 => "h264_amf",
            Encoder::AmfHevc => "hevc_amf",
        }
    }

    fn is_hevc(self) -> bool {
        matches!(
            self,
            Encoder::X265 | Encoder::NvencHevc | Encoder::QsvHevc | Encoder::AmfHevc
        )
    }

    fn is_hardware(self) -> bool {
        !matches!(self, Encoder::X264 | Encoder::X265)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Speed {
    Fast,
    Balanced,
    Small,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSettings {
    pub encoder: Encoder,
    /// Constant quality on the x264 CRF scale: lower is better and larger
    /// (18 is visually lossless for most material, 23 is x264's default).
    pub quality: u8,
    pub speed: Speed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Container {
    Mp4,
    Mkv,
}

impl Container {
    fn of(path: &Path) -> Container {
        match path
            .extension()
            .and_then(OsStr::to_str)
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("mkv") => Container::Mkv,
            _ => Container::Mp4,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Audio {
    Copy,
    Aac,
}

/// Encoder options for `settings`, in ffmpeg's terms.
fn video_args(settings: &ExportSettings, container: Container) -> Vec<String> {
    let q = settings.quality.min(51).to_string();
    let e = settings.encoder;
    let pick =
        |fast: &'static str, balanced: &'static str, small: &'static str| match settings.speed {
            Speed::Fast => fast,
            Speed::Balanced => balanced,
            Speed::Small => small,
        };
    let mut args: Vec<String> = vec!["-c:v".into(), e.ffmpeg_name().into()];
    let rest: Vec<&str> = match e {
        Encoder::X264 | Encoder::X265 => {
            vec![
                "-preset",
                pick("veryfast", "medium", "slow"),
                "-crf",
                &q,
                "-pix_fmt",
                "yuv420p",
            ]
        }
        Encoder::NvencH264 | Encoder::NvencHevc => vec![
            "-preset",
            pick("p2", "p5", "p7"),
            "-rc",
            "vbr",
            "-cq",
            &q,
            "-b:v",
            "0",
            "-pix_fmt",
            "yuv420p",
        ],
        Encoder::QsvH264 | Encoder::QsvHevc => vec![
            "-preset",
            pick("veryfast", "medium", "veryslow"),
            "-global_quality",
            &q,
            "-pix_fmt",
            "nv12",
        ],
        Encoder::AmfH264 | Encoder::AmfHevc => vec![
            "-quality",
            pick("speed", "balanced", "quality"),
            "-rc",
            "cqp",
            "-qp_i",
            &q,
            "-qp_p",
            &q,
            "-pix_fmt",
            "yuv420p",
        ],
    };
    args.extend(rest.into_iter().map(String::from));
    // Apple players need this tag to play HEVC in MP4.
    if e.is_hevc() && container == Container::Mp4 {
        args.extend(["-tag:v".into(), "hvc1".into()]);
    }
    args
}

/// The full argument list for a burn-in export (run inside the work folder).
fn export_args(
    input: &Path,
    output: &Path,
    settings: &ExportSettings,
    audio: Audio,
) -> Vec<OsString> {
    let container = Container::of(output);
    let mut args: Vec<OsString> = ["-hide_banner", "-nostdin", "-y", "-i"]
        .map(OsString::from)
        .into();
    args.push(input.into());
    for a in ["-map", "0:v:0", "-map", "0:a?", "-vf", ASS_FILTER] {
        args.push(a.into());
    }
    args.extend(
        video_args(settings, container)
            .into_iter()
            .map(OsString::from),
    );
    let audio_args: &[&str] = match audio {
        Audio::Copy => &["-c:a", "copy"],
        Audio::Aac => &["-c:a", "aac", "-b:a", "192k"],
    };
    args.extend(audio_args.iter().map(OsString::from));
    if container == Container::Mp4 {
        args.extend(["-movflags", "+faststart"].map(OsString::from));
    }
    args.extend(["-progress", "pipe:1", "-nostats"].map(OsString::from));
    args.push(output.into());
    args
}

/// Seconds encoded so far, from a `-progress` line (`out_time_us=…`).
fn progress_seconds(line: &str) -> Option<f64> {
    let micros: f64 = line.strip_prefix("out_time_us=")?.trim().parse().ok()?;
    (micros >= 0.0).then_some(micros / 1e6)
}

/// Whether ffmpeg failed because the container can't hold the audio as-is.
fn audio_rejected(stderr: &str) -> bool {
    stderr.contains("Could not find tag for codec")
        || stderr.contains("not currently supported in container")
}

/// A work folder with `subs.ass` and the files of the fonts named.
fn prepare(ass: &str, font_names: &[String]) -> io::Result<TempDir> {
    let dir = tempfile::Builder::new()
        .prefix("brownass-export-")
        .tempdir()?;
    fs::write(
        dir.path().join(SUBS_FILE),
        [UTF8_BOM, ass.as_bytes()].concat(),
    )?;
    let index = FontIndex::system();
    let files: Vec<PathBuf> = font_names
        .iter()
        .flat_map(|name| index.files(name).cloned())
        .collect();
    copy_fonts(&files, &dir.path().join(FONTS_DIR))?;
    Ok(dir)
}

/// Copies font files into `dir`, each once, renaming on name clashes.
fn copy_fonts(files: &[PathBuf], dir: &Path) -> io::Result<Vec<PathBuf>> {
    fs::create_dir_all(dir)?;
    let mut seen = HashSet::new();
    let mut copied = Vec::new();
    for source in files {
        if !seen.insert(source.clone()) {
            continue;
        }
        let name = source
            .file_name()
            .map(OsStr::to_os_string)
            .unwrap_or_default();
        let mut target = dir.join(&name);
        for n in 2.. {
            if !target.exists() {
                break;
            }
            let mut renamed = OsString::from(format!("{n}-"));
            renamed.push(&name);
            target = dir.join(renamed);
        }
        fs::copy(source, &target)?;
        copied.push(target);
    }
    Ok(copied)
}

enum RunError {
    Cancelled,
    Failed(String),
}

/// Runs ffmpeg in `workdir`, reporting progress (0-1) and stopping early if
/// `cancel` fires.
async fn run_with_progress(
    ffmpeg: &Path,
    args: &[OsString],
    workdir: &Path,
    duration: f64,
    progress: &Channel<f64>,
    cancel: &mut oneshot::Receiver<()>,
) -> Result<(), RunError> {
    let mut child = process::spawn(
        ffmpeg::command(ffmpeg)
            .args(args)
            .current_dir(workdir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()),
    )
    .map_err(|e| RunError::Failed(format!("Could not run ffmpeg: {e}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or(RunError::Failed("no stdout".into()))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or(RunError::Failed("no stderr".into()))?;
    let stderr_task = tokio::spawn(async move {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text).await;
        text
    });

    let mut lines = BufReader::new(stdout).lines();
    loop {
        tokio::select! {
            line = lines.next_line() => match line {
                Ok(Some(line)) => {
                    if let Some(done) = progress_seconds(&line) {
                        let _ = progress.send((done / duration.max(0.001)).clamp(0.0, 1.0));
                    }
                }
                _ => break,
            },
            _ = &mut *cancel => {
                let _ = child.kill().await;
                return Err(RunError::Cancelled);
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| RunError::Failed(e.to_string()))?;
    if status.success() {
        let _ = progress.send(1.0);
        Ok(())
    } else {
        Err(RunError::Failed(stderr_task.await.unwrap_or_default()))
    }
}

/// The last lines of ffmpeg's error output, which carry the actual message.
fn tail(stderr: &str) -> String {
    let lines: Vec<&str> = stderr.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(3)..].join("\n")
}

/// The running export (one at a time) and the last file written.
#[derive(Default)]
pub struct Exports {
    cancel: Mutex<Option<oneshot::Sender<()>>>,
    last_output: Mutex<Option<PathBuf>>,
}

/// Which encoders this ffmpeg has; hardware ones are only listed if a
/// one-frame test encode works (an encoder can be compiled in without the
/// GPU or driver to use it).
#[tauri::command]
pub async fn detect_encoders(ffmpeg: State<'_, FfmpegState>) -> Result<Vec<Encoder>, String> {
    let paths = ffmpeg.paths()?;
    let list = ffmpeg::run(&paths.ffmpeg, ["-hide_banner", "-encoders"])
        .await
        .map_err(|e| e.to_string())?;
    let available: HashSet<&str> = list
        .lines()
        .filter_map(|l| l.split_whitespace().nth(1))
        .collect();
    let mut usable = Vec::new();
    for encoder in Encoder::ALL {
        if !available.contains(encoder.ffmpeg_name()) {
            continue;
        }
        if !encoder.is_hardware() || trial_encode(&paths, encoder).await {
            usable.push(encoder);
        }
    }
    Ok(usable)
}

async fn trial_encode(paths: &FfmpegPaths, encoder: Encoder) -> bool {
    let args = [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=256x256:r=25:d=0.2",
        "-frames:v",
        "1",
        "-c:v",
        encoder.ffmpeg_name(),
        "-f",
        "null",
        "-",
    ];
    let run = ffmpeg::run(&paths.ffmpeg, args);
    matches!(
        tokio::time::timeout(std::time::Duration::from_secs(15), run).await,
        Ok(Ok(_))
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exported {
    path: PathBuf,
    /// The source audio couldn't go into the container, so it was encoded.
    audio_reencoded: bool,
}

fn suggested_name(video: &Path, suffix: &str, extension: &str) -> String {
    let stem = video.file_stem().unwrap_or_default().to_string_lossy();
    format!("{stem} ({suffix}).{extension}")
}

async fn ask_output(
    app: &AppHandle,
    video: &Path,
    name: String,
    filters: &[(&str, &[&str])],
) -> Option<PathBuf> {
    let mut dialog = app.dialog().file().set_title("Export").set_file_name(name);
    if let Some(dir) = video.parent() {
        dialog = dialog.set_directory(dir);
    }
    for (label, extensions) in filters {
        dialog = dialog.add_filter(*label, extensions);
    }
    let (tx, rx) = oneshot::channel();
    dialog.save_file(move |file| {
        let _ = tx.send(file);
    });
    rx.await.ok().flatten().and_then(|f| f.into_path().ok())
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// Burns `ass` into a copy of the opened video. Asks where to save it;
/// `Ok(None)` means the dialog was cancelled.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn export_video(
    app: AppHandle,
    video: State<'_, OpenedVideo>,
    ffmpeg: State<'_, FfmpegState>,
    exports: State<'_, Exports>,
    ass: String,
    fonts: Vec<String>,
    settings: ExportSettings,
    on_progress: Channel<f64>,
) -> Result<Option<Exported>, String> {
    let info = video.get().ok_or("No video is open.")?;
    let paths = ffmpeg.paths()?;
    let name = suggested_name(&info.path, "subtitled", "mp4");
    let filters: &[(&str, &[&str])] = &[("MP4 video", &["mp4"]), ("Matroska video", &["mkv"])];
    let Some(output) = ask_output(&app, &info.path, name, filters).await else {
        return Ok(None);
    };
    if same_file(&output, &info.path) {
        return Err("Choose a different file than the source video.".into());
    }

    let (tx, mut cancel) = oneshot::channel();
    {
        let mut running = exports.cancel.lock().unwrap_or_else(|e| e.into_inner());
        if running.is_some() {
            return Err("An export is already running.".into());
        }
        *running = Some(tx);
    }
    let result = encode(
        &paths,
        &info,
        &output,
        &ass,
        &fonts,
        &settings,
        &on_progress,
        &mut cancel,
    )
    .await;
    *exports.cancel.lock().unwrap_or_else(|e| e.into_inner()) = None;

    match result {
        Ok(audio_reencoded) => {
            *exports
                .last_output
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(output.clone());
            Ok(Some(Exported {
                path: output,
                audio_reencoded,
            }))
        }
        Err(e) => {
            // Don't leave a partial video behind.
            let _ = fs::remove_file(&output);
            if let RunError::Failed(stderr) = &e {
                log::error!(
                    "Export to {} failed ({settings:?}): {stderr}",
                    output.display()
                );
            }
            Err(match e {
                RunError::Cancelled => "Cancelled.".into(),
                RunError::Failed(stderr) => format!("ffmpeg failed: {}", tail(&stderr)),
            })
        }
    }
}

/// Encodes, retrying with AAC audio if the container rejects the original.
/// Returns whether the audio was re-encoded.
#[allow(clippy::too_many_arguments)]
async fn encode(
    paths: &FfmpegPaths,
    info: &VideoInfo,
    output: &Path,
    ass: &str,
    fonts: &[String],
    settings: &ExportSettings,
    progress: &Channel<f64>,
    cancel: &mut oneshot::Receiver<()>,
) -> Result<bool, RunError> {
    let (ass, fonts) = (ass.to_owned(), fonts.to_vec());
    let workdir = tauri::async_runtime::spawn_blocking(move || prepare(&ass, &fonts))
        .await
        .map_err(|e| RunError::Failed(e.to_string()))?
        .map_err(|e| RunError::Failed(format!("Could not prepare the export: {e}")))?;

    let run = |audio| export_args(&info.path, output, settings, audio);
    match run_with_progress(
        &paths.ffmpeg,
        &run(Audio::Copy),
        workdir.path(),
        info.duration,
        progress,
        cancel,
    )
    .await
    {
        Err(RunError::Failed(stderr)) if audio_rejected(&stderr) => run_with_progress(
            &paths.ffmpeg,
            &run(Audio::Aac),
            workdir.path(),
            info.duration,
            progress,
            cancel,
        )
        .await
        .map(|()| true),
        other => other.map(|()| false),
    }
}

#[tauri::command]
pub async fn cancel_export(exports: State<'_, Exports>) -> Result<(), String> {
    if let Some(cancel) = exports
        .cancel
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    {
        let _ = cancel.send(());
    }
    Ok(())
}

/// Shows the last exported file in Explorer.
#[tauri::command]
pub async fn reveal_export(exports: State<'_, Exports>) -> Result<(), String> {
    let path = exports
        .last_output
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .ok_or("Nothing has been exported yet.")?;
    crate::shell::reveal_file(&path)
}

/// The frame at `time` (a frame's start time) with subtitles burned in, as
/// PNG bytes, rendered exactly as an export would.
#[tauri::command]
pub async fn render_test_frame(
    video: State<'_, OpenedVideo>,
    ffmpeg: State<'_, FfmpegState>,
    ass: String,
    fonts: Vec<String>,
    time: f64,
) -> Result<Response, String> {
    let info = video.get().ok_or("No video is open.")?;
    let paths = ffmpeg.paths()?;
    let workdir = tauri::async_runtime::spawn_blocking(move || prepare(&ass, &fonts))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Could not prepare the frame: {e}"))?;

    let mut child = process::spawn(
        ffmpeg::command(&paths.ffmpeg)
            .args(test_frame_args(&info.path, time, info.fps))
            .current_dir(workdir.path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()),
    )
    .map_err(|e| format!("Could not run ffmpeg: {e}"))?;
    let mut png = Vec::new();
    if let Some(mut stdout) = child.stdout.take() {
        stdout
            .read_to_end(&mut png)
            .await
            .map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().await.map_err(|e| e.to_string())?;
    if !output.status.success() || png.is_empty() {
        return Err(format!(
            "ffmpeg could not render the frame: {}",
            tail(&String::from_utf8_lossy(&output.stderr))
        ));
    }
    Ok(Response::new(png))
}

/// Seeks half a frame early: ffmpeg returns the first frame at or after the
/// seek point, and `-copyts` keeps timestamps, so subtitles line up exactly.
fn test_frame_args(input: &Path, time: f64, fps: f64) -> Vec<OsString> {
    let seek = (time - 0.5 / fps).max(0.0);
    let mut args: Vec<OsString> = ["-hide_banner", "-nostdin", "-v", "error", "-ss"]
        .map(OsString::from)
        .into();
    args.push(format!("{seek:.6}").into());
    args.extend(["-copyts", "-i"].map(OsString::from));
    args.push(input.into());
    args.extend(
        [
            "-vf",
            ASS_FILTER,
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-c:v",
            "png",
            "-",
        ]
        .map(OsString::from),
    );
    args
}

/// Writes an MKV with the video and audio copied as-is, the subtitles as a
/// track, and the fonts attached so players render them as intended.
#[tauri::command]
pub async fn export_soft_subtitles(
    app: AppHandle,
    video: State<'_, OpenedVideo>,
    ffmpeg: State<'_, FfmpegState>,
    exports: State<'_, Exports>,
    ass: String,
    fonts: Vec<String>,
) -> Result<Option<Exported>, String> {
    let info = video.get().ok_or("No video is open.")?;
    let paths = ffmpeg.paths()?;
    let name = suggested_name(&info.path, "with subtitles", "mkv");
    let Some(output) = ask_output(&app, &info.path, name, &[("Matroska video", &["mkv"])]).await
    else {
        return Ok(None);
    };
    if same_file(&output, &info.path) {
        return Err("Choose a different file than the source video.".into());
    }

    let workdir = tauri::async_runtime::spawn_blocking(move || prepare(&ass, &fonts))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Could not prepare the export: {e}"))?;
    let font_files: Vec<PathBuf> = fs::read_dir(workdir.path().join(FONTS_DIR))
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .collect();

    let args = mux_args(&info.path, &output, &font_files);
    let result = ffmpeg::run_in(&paths.ffmpeg, &args, Some(workdir.path())).await;
    match result {
        Ok(_) => {
            *exports
                .last_output
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(output.clone());
            Ok(Some(Exported {
                path: output,
                audio_reencoded: false,
            }))
        }
        Err(e) => {
            let _ = fs::remove_file(&output);
            Err(format!("ffmpeg failed: {}", tail(&e.to_string())))
        }
    }
}

fn font_mimetype(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(OsStr::to_str)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("otf") => "application/vnd.ms-opentype",
        _ => "application/x-truetype-font",
    }
}

fn mux_args(input: &Path, output: &Path, fonts: &[PathBuf]) -> Vec<OsString> {
    let mut args: Vec<OsString> = ["-hide_banner", "-nostdin", "-v", "error", "-y", "-i"]
        .map(OsString::from)
        .into();
    args.push(input.into());
    args.extend(
        [
            "-i",
            SUBS_FILE,
            "-map",
            "0:v",
            "-map",
            "0:a?",
            "-map",
            "1:0",
            "-c",
            "copy",
            "-c:s",
            "ass",
            "-disposition:s:0",
            "default",
        ]
        .map(OsString::from),
    );
    for (n, font) in fonts.iter().enumerate() {
        args.push("-attach".into());
        args.push(font.into());
        args.push(format!("-metadata:s:t:{n}").into());
        args.push(format!("mimetype={}", font_mimetype(font)).into());
    }
    args.push(output.into());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    fn settings(encoder: Encoder) -> ExportSettings {
        ExportSettings {
            encoder,
            quality: 20,
            speed: Speed::Balanced,
        }
    }

    #[test]
    fn builds_encoder_options() {
        assert_eq!(
            video_args(&settings(Encoder::X264), Container::Mp4),
            [
                "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"
            ]
        );
        let nvenc = video_args(&settings(Encoder::NvencHevc), Container::Mp4);
        assert_eq!(&nvenc[..2], ["-c:v", "hevc_nvenc"]);
        assert!(nvenc.windows(2).any(|w| w == ["-cq", "20"]));
        assert!(nvenc.ends_with(&["-tag:v".into(), "hvc1".into()]));
        // No Apple tag in MKV.
        assert!(!video_args(&settings(Encoder::X265), Container::Mkv).contains(&"hvc1".into()));
    }

    #[test]
    fn export_runs_the_ass_filter_on_the_original_with_paths_as_arguments() {
        let input = Path::new(r"D:\Vidéos\my clip: final.mp4");
        let output = Path::new(r"E:\out\clip (subtitled).mp4");
        let args = strings(&export_args(
            input,
            output,
            &settings(Encoder::X264),
            Audio::Copy,
        ));
        assert_eq!(args[4], input.to_string_lossy());
        assert_eq!(args.last().unwrap(), &output.to_string_lossy());
        assert!(
            args.windows(2)
                .any(|w| w == ["-vf", "ass=subs.ass:fontsdir=fonts"])
        );
        assert!(args.windows(2).any(|w| w == ["-c:a", "copy"]));
        assert!(args.windows(2).any(|w| w == ["-movflags", "+faststart"]));
        assert!(
            args.windows(3)
                .any(|w| w == ["-progress", "pipe:1", "-nostats"])
        );

        let mkv = strings(&export_args(
            input,
            Path::new("x.MKV"),
            &settings(Encoder::X264),
            Audio::Aac,
        ));
        assert!(mkv.windows(2).any(|w| w == ["-c:a", "aac"]));
        assert!(!mkv.contains(&"-movflags".to_owned()));
    }

    #[test]
    fn parses_progress_and_audio_errors() {
        assert_eq!(progress_seconds("out_time_us=12500000"), Some(12.5));
        assert_eq!(progress_seconds("out_time_us=N/A"), None);
        assert_eq!(progress_seconds("speed=1.5x"), None);
        assert!(audio_rejected(
            "[mp4 @ 0] Could not find tag for codec wmav2 in stream #1, codec not currently supported in container"
        ));
        assert!(!audio_rejected("Invalid data found when processing input"));
    }

    #[test]
    fn test_frames_seek_half_a_frame_early_and_keep_timestamps() {
        let args = strings(&test_frame_args(
            Path::new("v.mp4"),
            12.012,
            30000.0 / 1001.0,
        ));
        assert_eq!(&args[4..8], ["-ss", "11.995317", "-copyts", "-i"]);
        assert_eq!(
            &strings(&test_frame_args(Path::new("v"), 0.0, 25.0))[5],
            "0.000000"
        );
    }

    #[test]
    fn muxes_subtitles_and_attaches_fonts() {
        let fonts = [
            PathBuf::from("fonts/arial.ttf"),
            PathBuf::from("fonts/x.OTF"),
        ];
        let args = strings(&mux_args(Path::new("in.mp4"), Path::new("out.mkv"), &fonts));
        assert!(args.windows(2).any(|w| w == ["-c:s", "ass"]));
        assert!(args.windows(4).any(|w| w
            == [
                "-attach",
                "fonts/arial.ttf",
                "-metadata:s:t:0",
                "mimetype=application/x-truetype-font"
            ]));
        assert!(args.contains(&"mimetype=application/vnd.ms-opentype".to_owned()));
    }

    #[test]
    fn copies_each_font_once_and_avoids_name_clashes() {
        let src = tempfile::tempdir().unwrap();
        let (a, b) = (src.path().join("a"), src.path().join("b"));
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        fs::write(a.join("font.ttf"), "one").unwrap();
        fs::write(b.join("font.ttf"), "two").unwrap();
        let out = src.path().join("out");
        let files = [a.join("font.ttf"), b.join("font.ttf"), a.join("font.ttf")];
        let copied = copy_fonts(&files, &out).unwrap();
        assert_eq!(copied.len(), 2);
        assert_eq!(fs::read_to_string(out.join("font.ttf")).unwrap(), "one");
        assert_eq!(fs::read_to_string(out.join("2-font.ttf")).unwrap(), "two");
    }

    /// Runs real ffmpeg: set BROWNASS_TEST_FFMPEG (ffmpeg.exe, with ffprobe
    /// next to it) and BROWNASS_TEST_VIDEO, then `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn exports_cancels_and_muxes_with_real_ffmpeg() {
        let ffmpeg = PathBuf::from(std::env::var("BROWNASS_TEST_FFMPEG").unwrap());
        let ffprobe = ffmpeg.with_file_name("ffprobe.exe");
        let input = PathBuf::from(std::env::var("BROWNASS_TEST_VIDEO").unwrap());
        let ass = "[Script Info]\nPlayResX: 1280\nPlayResY: 720\n\n[V4+ Styles]\n\
            Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n\
            Style: Default,Arial,60,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,20,20,30,1\n\n\
            [Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n\
            Dialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,Burned in\n";
        let workdir = prepare(ass, &["Arial".to_owned()]).unwrap();
        assert!(workdir.path().join(FONTS_DIR).join("arial.ttf").is_file());
        let out_dir = tempfile::tempdir().unwrap();
        let progress_seen = std::sync::Arc::new(Mutex::new(Vec::new()));
        let seen = progress_seen.clone();
        let progress = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                seen.lock().unwrap().push(json.parse::<f64>().unwrap());
            }
            Ok(())
        });

        // A complete export.
        let output = out_dir.path().join("out (subtitled).mp4");
        let fast = ExportSettings {
            encoder: Encoder::X264,
            quality: 28,
            speed: Speed::Fast,
        };
        let (_keep, mut never) = oneshot::channel();
        let args = export_args(&input, &output, &fast, Audio::Copy);
        assert!(
            run_with_progress(&ffmpeg, &args, workdir.path(), 20.0, &progress, &mut never)
                .await
                .is_ok()
        );
        assert_eq!(progress_seen.lock().unwrap().last(), Some(&1.0));
        let duration = ffmpeg::run(
            &ffprobe,
            [
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
            ]
            .map(OsStr::new)
            .into_iter()
            .chain([output.as_os_str()]),
        )
        .await
        .unwrap();
        assert!(
            (duration.trim().parse::<f64>().unwrap() - 20.0).abs() < 0.2,
            "{duration}"
        );

        // Cancelling stops ffmpeg.
        let slow = ExportSettings {
            encoder: Encoder::X264,
            quality: 18,
            speed: Speed::Small,
        };
        let cancelled = out_dir.path().join("cancelled.mp4");
        let (cancel, mut on_cancel) = oneshot::channel();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            let _ = cancel.send(());
        });
        let args = export_args(&input, &cancelled, &slow, Audio::Copy);
        let result = run_with_progress(
            &ffmpeg,
            &args,
            workdir.path(),
            20.0,
            &progress,
            &mut on_cancel,
        )
        .await;
        assert!(matches!(result, Err(RunError::Cancelled)));

        // Soft subtitles with the font attached.
        let mkv = out_dir.path().join("soft.mkv");
        let fonts: Vec<PathBuf> = fs::read_dir(workdir.path().join(FONTS_DIR))
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        ffmpeg::run_in(
            &ffmpeg,
            mux_args(&input, &mkv, &fonts),
            Some(workdir.path()),
        )
        .await
        .unwrap();
        let streams = ffmpeg::run(
            &ffprobe,
            [
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type,codec_name",
                "-of",
                "csv=p=0",
            ]
            .map(OsStr::new)
            .into_iter()
            .chain([mkv.as_os_str()]),
        )
        .await
        .unwrap();
        assert!(streams.contains("ass,subtitle"), "{streams}");
        assert!(streams.contains("attachment"), "{streams}");
    }

    #[test]
    fn names_the_output_after_the_video() {
        assert_eq!(
            suggested_name(Path::new(r"C:\v\clip.mp4"), "subtitled", "mp4"),
            "clip (subtitled).mp4"
        );
    }
}
