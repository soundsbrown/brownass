//! Locating, verifying and running the user's ffmpeg / ffprobe install.
//!
//! ffmpeg is not bundled. It is looked up via the path saved in settings, then
//! PATH, and must be built with libass. Processes are spawned only from Rust
//! with fixed argument arrays; the frontend has no shell permissions.

use std::env;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tokio::process::Command;

use crate::dialogs;
use crate::process;
use crate::settings::Settings;

const FFMPEG: &str = "ffmpeg";
const FFPROBE: &str = "ffprobe";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FfmpegPaths {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

/// The verified install, or `None` until one has been found.
#[derive(Default)]
pub struct FfmpegState(Mutex<Option<FfmpegPaths>>);

impl FfmpegState {
    /// The verified paths, or an error to show if ffmpeg isn't usable yet.
    pub fn paths(&self) -> Result<FfmpegPaths, String> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or_else(|| "ffmpeg is not available. See the status bar.".to_owned())
    }

    fn set(&self, paths: Option<FfmpegPaths>) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = paths;
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInfo {
    version: String,
    ffmpeg_path: PathBuf,
    ffprobe_path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FfmpegErrorKind {
    NotFound,
    FfprobeMissing,
    NoLibass,
    Failed,
}

#[derive(Debug, Serialize)]
pub struct FfmpegError {
    kind: FfmpegErrorKind,
    message: String,
}

impl FfmpegError {
    fn new(kind: FfmpegErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for FfmpegError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// Finds and verifies ffmpeg, remembering the result for later commands.
#[tauri::command]
pub async fn ffmpeg_status(
    app: AppHandle,
    state: State<'_, FfmpegState>,
) -> Result<FfmpegInfo, FfmpegError> {
    let configured = Settings::load(&app).ffmpeg_path.filter(|p| p.is_file());
    let result = match configured {
        Some(ffmpeg) => paths_from_ffmpeg(ffmpeg),
        None => find_in_dirs(&path_dirs()),
    };
    let result = match result {
        Ok(paths) => verify(&paths).await.map(|version| (paths, version)),
        Err(e) => Err(e),
    };
    state.set(result.as_ref().ok().map(|(paths, _)| paths.clone()));
    result.map(|(paths, version)| info(&paths, version))
}

/// Lets the user pick an ffmpeg executable. On success the choice is saved to
/// settings; `Ok(None)` means the dialog was cancelled.
#[tauri::command]
pub async fn locate_ffmpeg(
    app: AppHandle,
    state: State<'_, FfmpegState>,
) -> Result<Option<FfmpegInfo>, FfmpegError> {
    let mut dialog = app.dialog().file().set_title("Locate ffmpeg");
    if cfg!(windows) {
        dialog = dialog.add_filter("ffmpeg", &["exe"]);
    }
    let Some(ffmpeg) = dialogs::pick_file(dialog).await else {
        return Ok(None);
    };

    let paths = paths_from_ffmpeg(ffmpeg)?;
    let version = verify(&paths).await?;
    Settings {
        ffmpeg_path: Some(paths.ffmpeg.clone()),
    }
    .save(&app)
    .map_err(|e| FfmpegError::new(FfmpegErrorKind::Failed, e))?;
    state.set(Some(paths.clone()));
    Ok(Some(info(&paths, version)))
}

fn info(paths: &FfmpegPaths, version: String) -> FfmpegInfo {
    FfmpegInfo {
        version,
        ffmpeg_path: paths.ffmpeg.clone(),
        ffprobe_path: paths.ffprobe.clone(),
    }
}

fn exe_name(tool: &str) -> String {
    format!("{tool}{}", env::consts::EXE_SUFFIX)
}

fn path_dirs() -> Vec<PathBuf> {
    env::var_os("PATH")
        .map(|p| env::split_paths(&p).collect())
        .unwrap_or_default()
}

/// Finds ffmpeg and ffprobe in `dirs`, in order. A directory containing both
/// wins over the first ffmpeg and first ffprobe found separately, so the pair
/// comes from the same install when possible.
fn find_in_dirs(dirs: &[PathBuf]) -> Result<FfmpegPaths, FfmpegError> {
    let tool_in = |dir: &Path, tool: &str| {
        let p = dir.join(exe_name(tool));
        p.is_file().then_some(p)
    };

    if let Some(dir) = dirs
        .iter()
        .find(|d| tool_in(d, FFMPEG).is_some() && tool_in(d, FFPROBE).is_some())
    {
        return Ok(FfmpegPaths {
            ffmpeg: dir.join(exe_name(FFMPEG)),
            ffprobe: dir.join(exe_name(FFPROBE)),
        });
    }

    let ffmpeg = dirs
        .iter()
        .find_map(|d| tool_in(d, FFMPEG))
        .ok_or_else(|| {
            FfmpegError::new(FfmpegErrorKind::NotFound, "ffmpeg was not found on PATH.")
        })?;
    let ffprobe = dirs
        .iter()
        .find_map(|d| tool_in(d, FFPROBE))
        .ok_or_else(|| {
            FfmpegError::new(
                FfmpegErrorKind::FfprobeMissing,
                format!(
                    "Found ffmpeg at {}, but ffprobe was not found on PATH.",
                    ffmpeg.display()
                ),
            )
        })?;
    Ok(FfmpegPaths { ffmpeg, ffprobe })
}

/// Pairs an explicitly chosen ffmpeg with the ffprobe next to it.
fn paths_from_ffmpeg(ffmpeg: PathBuf) -> Result<FfmpegPaths, FfmpegError> {
    let ffprobe = ffmpeg.with_file_name(exe_name(FFPROBE));
    if !ffprobe.is_file() {
        return Err(FfmpegError::new(
            FfmpegErrorKind::FfprobeMissing,
            format!(
                "Found ffmpeg at {}, but there is no ffprobe next to it.",
                ffmpeg.display()
            ),
        ));
    }
    Ok(FfmpegPaths { ffmpeg, ffprobe })
}

/// Checks that both tools run and that ffmpeg has the libass `ass` filter.
/// Returns ffmpeg's version line.
async fn verify(paths: &FfmpegPaths) -> Result<String, FfmpegError> {
    let version = run(&paths.ffmpeg, &["-hide_banner", "-version"]).await?;
    run(&paths.ffprobe, &["-hide_banner", "-version"]).await?;
    let filters = run(&paths.ffmpeg, &["-hide_banner", "-filters"]).await?;
    if !has_ass_filter(&filters) {
        return Err(FfmpegError::new(
            FfmpegErrorKind::NoLibass,
            format!(
                "The ffmpeg at {} was built without libass, which is needed to render subtitles.",
                paths.ffmpeg.display()
            ),
        ));
    }
    Ok(first_line(&version))
}

/// Runs a tool to completion and returns its stdout.
pub async fn run<I, S>(program: &Path, args: I) -> Result<String, FfmpegError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_in(program, args, None::<&Path>).await
}

/// Like `run`, with `dir` (if given) as the working directory.
pub async fn run_in<I, S>(
    program: &Path,
    args: I,
    dir: Option<impl AsRef<Path>>,
) -> Result<String, FfmpegError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let failed = |detail: String| {
        FfmpegError::new(
            FfmpegErrorKind::Failed,
            format!("Could not run {}: {detail}", program.display()),
        )
    };
    let mut cmd = command(program);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(dir) = dir {
        cmd.current_dir(dir);
    }
    let child = process::spawn(&mut cmd).map_err(|e| failed(e.to_string()))?;
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| failed(e.to_string()))?;
    if !output.status.success() {
        return Err(failed(format!(
            "exited with {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// A command that doesn't flash a console window on Windows and is killed if
/// its future is dropped.
pub fn command(program: &Path) -> Command {
    let mut cmd = Command::new(program);
    cmd.stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Whether `ffmpeg -filters` output lists the `ass` filter. Rows look like
/// ` .. ass               V->V       Render ASS subtitles ...`.
fn has_ass_filter(filters: &str) -> bool {
    filters
        .lines()
        .any(|line| line.split_whitespace().nth(1) == Some("ass"))
}

fn first_line(s: &str) -> String {
    s.lines().next().unwrap_or_default().trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn dir_with(tools: &[&str]) -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        for tool in tools {
            fs::write(dir.path().join(exe_name(tool)), b"").unwrap();
        }
        dir
    }

    #[test]
    fn prefers_directory_with_both_tools() {
        let only_ffmpeg = dir_with(&[FFMPEG]);
        let both = dir_with(&[FFMPEG, FFPROBE]);
        let paths = find_in_dirs(&[only_ffmpeg.path().into(), both.path().into()]).unwrap();
        assert_eq!(paths.ffmpeg, both.path().join(exe_name(FFMPEG)));
        assert_eq!(paths.ffprobe, both.path().join(exe_name(FFPROBE)));
    }

    #[test]
    fn falls_back_to_tools_in_separate_directories() {
        let a = dir_with(&[FFMPEG]);
        let b = dir_with(&[FFPROBE]);
        let paths = find_in_dirs(&[a.path().into(), b.path().into()]).unwrap();
        assert_eq!(paths.ffmpeg, a.path().join(exe_name(FFMPEG)));
        assert_eq!(paths.ffprobe, b.path().join(exe_name(FFPROBE)));
    }

    #[test]
    fn reports_missing_tools() {
        let empty = dir_with(&[]);
        let err = find_in_dirs(&[empty.path().into()]).unwrap_err();
        assert_eq!(err.kind, FfmpegErrorKind::NotFound);

        let only_ffmpeg = dir_with(&[FFMPEG]);
        let err = find_in_dirs(&[only_ffmpeg.path().into()]).unwrap_err();
        assert_eq!(err.kind, FfmpegErrorKind::FfprobeMissing);
    }

    #[test]
    fn chosen_ffmpeg_needs_sibling_ffprobe() {
        let both = dir_with(&[FFMPEG, FFPROBE]);
        let paths = paths_from_ffmpeg(both.path().join(exe_name(FFMPEG))).unwrap();
        assert_eq!(paths.ffprobe, both.path().join(exe_name(FFPROBE)));

        let only_ffmpeg = dir_with(&[FFMPEG]);
        let err = paths_from_ffmpeg(only_ffmpeg.path().join(exe_name(FFMPEG))).unwrap_err();
        assert_eq!(err.kind, FfmpegErrorKind::FfprobeMissing);
    }

    #[test]
    fn detects_ass_filter() {
        let with_libass = "Filters:\n  T.. = Timeline support\n  ------\n \
            .. acontrast         A->A       Simple audio dynamic range compression.\n \
            .. ass               V->V       Render ASS subtitles onto input video using the libass library.\n";
        assert!(has_ass_filter(with_libass));

        let without = "Filters:\n  ------\n \
            .. assdraw           V->V       Not the real filter.\n \
            TS scale             V->V       Scale the input video size.\n";
        assert!(!has_ass_filter(without));
    }

    #[test]
    fn first_line_takes_version_line() {
        let out = "ffmpeg version 9.0.2 Copyright (c)\r\nbuilt with gcc\n";
        assert_eq!(first_line(out), "ffmpeg version 9.0.2 Copyright (c)");
        assert_eq!(first_line(""), "");
    }
}
