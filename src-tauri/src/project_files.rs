//! Project persistence next to the video: `foo.mp4` is edited in `foo.bwass`,
//! and every save also exports `foo.ass` so players pick up the subtitles.
//!
//! Paths are derived from the opened video, never taken from the frontend.
//! If the video's folder isn't writable, the project goes to the app data
//! folder instead (and no `.ass` is written).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::video::OpenedVideo;

const PROJECT_EXTENSION: &str = "bwass";
const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";
/// We write the `.ass` just before the project, so an `.ass` noticeably newer
/// than its project was changed by something else.
const EXTERNAL_CHANGE_SLACK: Duration = Duration::from_secs(2);

#[derive(Default)]
pub struct ProjectFiles(Mutex<Option<Files>>);

impl ProjectFiles {
    pub fn clear(&self) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

/// Identifies a version of a file on disk without reading it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Stamp {
    len: u64,
    modified: SystemTime,
}

fn stamp(path: &Path) -> Option<Stamp> {
    let meta = fs::metadata(path).ok()?;
    meta.is_file().then(|| Stamp {
        len: meta.len(),
        modified: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
    })
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Loaded {
    /// A project file. `ass_changed`: the `.ass` was edited outside the app
    /// since the project was saved.
    Project {
        json: String,
        path: PathBuf,
        ass_changed: bool,
    },
    /// No project, but an `.ass` with the video's name exists.
    Ass {
        text: String,
        path: PathBuf,
    },
    None,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AssOutcome {
    Written,
    /// Not requested by the caller.
    Skipped,
    /// The file changed since we last wrote or read it; left untouched.
    Conflict,
    /// The video's folder isn't writable.
    Unwritable,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    project_path: PathBuf,
    ass: AssOutcome,
    /// Where an `.ass` we hadn't written ourselves was copied before being
    /// overwritten.
    ass_backup: Option<PathBuf>,
}

/// File locations and `.ass` bookkeeping for the opened video.
struct Files {
    project: PathBuf,
    ass: PathBuf,
    fallback: Option<PathBuf>,
    /// The `.ass` as we last wrote or read it. If the file on disk differs,
    /// saving reports a conflict instead of overwriting it.
    known_ass: Option<Stamp>,
    /// The `.ass` as we last wrote it. Overwriting anything else (an imported
    /// or externally edited file) makes a backup first.
    own_ass: Option<Stamp>,
}

impl Files {
    fn new(video: &Path, fallback: Option<PathBuf>) -> Self {
        Self {
            project: video.with_extension(PROJECT_EXTENSION),
            ass: video.with_extension("ass"),
            fallback,
            known_ass: None,
            own_ass: None,
        }
    }

    fn load(&mut self) -> io::Result<Loaded> {
        let existing = [Some(&self.project), self.fallback.as_ref()]
            .into_iter()
            .flatten()
            .find(|p| p.is_file())
            .cloned();
        let ass_stamp = stamp(&self.ass);

        let Some(project_path) = existing else {
            // The caller imports it, so it may be replaced, but it isn't ours.
            self.known_ass = ass_stamp;
            self.own_ass = None;
            return Ok(match ass_stamp {
                Some(_) => Loaded::Ass {
                    text: read_text(&self.ass)?,
                    path: self.ass.clone(),
                },
                None => Loaded::None,
            });
        };

        let json = fs::read_to_string(&project_path)?;
        let ass_changed = match (ass_stamp, stamp(&project_path)) {
            (Some(ass), Some(project)) => ass.modified > project.modified + EXTERNAL_CHANGE_SLACK,
            _ => false,
        };
        // An .ass no newer than its project is the one we wrote with it. An
        // externally changed one isn't "known", so saving asks first.
        self.known_ass = if ass_changed { None } else { ass_stamp };
        self.own_ass = self.known_ass;
        Ok(Loaded::Project {
            json,
            path: project_path,
            ass_changed,
        })
    }

    fn save(&mut self, json: &str, ass: Option<&str>, overwrite_ass: bool) -> io::Result<Saved> {
        let current = stamp(&self.ass);
        let mut ass_backup = None;
        let ass = match ass {
            None => AssOutcome::Skipped,
            Some(_) if !overwrite_ass && current.is_some_and(|s| Some(s) != self.known_ass) => {
                AssOutcome::Conflict
            }
            Some(text) => {
                if current.is_some_and(|s| Some(s) != self.own_ass) {
                    let backup = free_backup_path(&self.ass);
                    fs::copy(&self.ass, &backup)?;
                    ass_backup = Some(backup);
                }
                let bytes = [UTF8_BOM, text.as_bytes()].concat();
                match write_atomic(&self.ass, &bytes) {
                    Ok(()) => {
                        self.known_ass = stamp(&self.ass);
                        self.own_ass = self.known_ass;
                        AssOutcome::Written
                    }
                    Err(e) if is_unwritable(&e) => AssOutcome::Unwritable,
                    Err(e) => return Err(e),
                }
            }
        };

        let project_path = match write_atomic(&self.project, json.as_bytes()) {
            Ok(()) => self.project.clone(),
            Err(e) if is_unwritable(&e) => {
                let Some(fallback) = &self.fallback else {
                    return Err(e);
                };
                if let Some(dir) = fallback.parent() {
                    fs::create_dir_all(dir)?;
                }
                write_atomic(fallback, json.as_bytes())?;
                fallback.clone()
            }
            Err(e) => return Err(e),
        };
        Ok(Saved {
            project_path,
            ass,
            ass_backup,
        })
    }
}

/// `foo.ass.bak`, or `foo.ass.bak2`, `foo.ass.bak3`, ... so no earlier backup
/// is ever replaced.
fn free_backup_path(path: &Path) -> PathBuf {
    let with_suffix = |suffix: &str| {
        let mut name = path.as_os_str().to_owned();
        name.push(suffix);
        PathBuf::from(name)
    };
    std::iter::once(with_suffix(".bak"))
        .chain((2..).map(|n| with_suffix(&format!(".bak{n}"))))
        .find(|p| !p.exists())
        .expect("an unused backup name exists")
}

#[tauri::command]
pub async fn load_project(
    app: AppHandle,
    video: State<'_, OpenedVideo>,
    files: State<'_, ProjectFiles>,
) -> Result<Loaded, String> {
    let info = video.get().ok_or("No video is open.")?;
    let mut f = Files::new(&info.path, fallback_path(&app, &info.path));
    let loaded = f
        .load()
        .map_err(|e| format!("Could not read the project: {e}"))?;
    *files.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(f);
    Ok(loaded)
}

/// Saves the project JSON and, if `ass` is given, exports the `.ass` too.
#[tauri::command]
pub async fn save_project(
    files: State<'_, ProjectFiles>,
    json: String,
    ass: Option<String>,
    overwrite_ass: bool,
) -> Result<Saved, String> {
    let mut guard = files.0.lock().unwrap_or_else(|e| e.into_inner());
    let f = guard.as_mut().ok_or("No project is open.")?;
    f.save(&json, ass.as_deref(), overwrite_ass)
        .map_err(|e| format!("Could not save: {e}"))
}

fn fallback_path(app: &AppHandle, video: &Path) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("projects");
    let stem = video.file_stem()?.to_string_lossy();
    let key = crate::hash::path_key(video);
    Some(dir.join(format!("{stem}-{key:016x}.{PROJECT_EXTENSION}")))
}

fn is_unwritable(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        io::ErrorKind::PermissionDenied | io::ErrorKind::ReadOnlyFilesystem
    )
}

/// Writes via a temporary file in the same folder and a rename, so readers
/// never see a half-written file.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

/// Reads a subtitle file as text: UTF-8 (with or without BOM) or UTF-16 with
/// a BOM. Anything else is decoded as UTF-8, replacing invalid bytes.
pub(crate) fn read_text(path: &Path) -> io::Result<String> {
    let bytes = fs::read(path)?;
    let utf16 = |data: &[u8], decode: fn([u8; 2]) -> u16| {
        let units: Vec<u16> = data.as_chunks::<2>().0.iter().map(|c| decode(*c)).collect();
        String::from_utf16_lossy(&units)
    };
    Ok(match bytes.as_slice() {
        [0xEF, 0xBB, 0xBF, rest @ ..] => String::from_utf8_lossy(rest).into_owned(),
        [0xFF, 0xFE, rest @ ..] => utf16(rest, u16::from_le_bytes),
        [0xFE, 0xFF, rest @ ..] => utf16(rest, u16::from_be_bytes),
        other => String::from_utf8_lossy(other).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use tempfile::TempDir;

    fn setup() -> (TempDir, Files) {
        let dir = tempfile::tempdir().unwrap();
        let video = dir.path().join("my clip.mp4");
        fs::write(&video, b"").unwrap();
        let fallback = dir.path().join("appdata").join("my clip.bwass");
        let files = Files::new(&video, Some(fallback));
        (dir, files)
    }

    fn set_mtime(path: &Path, t: SystemTime) {
        File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(t)
            .unwrap();
    }

    #[test]
    fn nothing_to_load_for_a_new_video() {
        let (_dir, mut f) = setup();
        assert_eq!(f.load().unwrap(), Loaded::None);
    }

    #[test]
    fn saves_both_files_and_loads_the_project() {
        let (dir, mut f) = setup();
        f.load().unwrap();
        let saved = f.save("{}", Some("[Script Info]\n"), false).unwrap();
        assert_eq!(saved.ass, AssOutcome::Written);
        assert_eq!(saved.project_path, dir.path().join("my clip.bwass"));
        assert_eq!(
            fs::read(dir.path().join("my clip.ass")).unwrap(),
            b"\xEF\xBB\xBF[Script Info]\n"
        );

        let mut reopened = Files::new(&dir.path().join("my clip.mp4"), None);
        match reopened.load().unwrap() {
            Loaded::Project {
                json, ass_changed, ..
            } => {
                assert_eq!(json, "{}");
                assert!(!ass_changed);
            }
            other => panic!("{other:?}"),
        }
        // Our own .ass is known, so saving again overwrites it without asking
        // and without a backup.
        let saved = reopened.save("{}", Some("x"), false).unwrap();
        assert_eq!(saved.ass, AssOutcome::Written);
        assert_eq!(saved.ass_backup, None);
    }

    #[test]
    fn refuses_to_overwrite_an_externally_changed_ass() {
        let (dir, mut f) = setup();
        let ass = dir.path().join("my clip.ass");
        f.load().unwrap();
        f.save("{}", Some("ours"), false).unwrap();

        fs::write(&ass, "edited in Aegisub").unwrap();
        assert_eq!(
            f.save("{}", Some("ours again"), false).unwrap().ass,
            AssOutcome::Conflict
        );
        assert_eq!(fs::read_to_string(&ass).unwrap(), "edited in Aegisub");
        // The project itself is still saved.
        assert!(dir.path().join("my clip.bwass").is_file());

        // Overwriting on request keeps the external version as a backup.
        let saved = f.save("{}", Some("ours again"), true).unwrap();
        assert_eq!(saved.ass, AssOutcome::Written);
        let backup = saved.ass_backup.unwrap();
        assert_eq!(backup, dir.path().join("my clip.ass.bak"));
        assert_eq!(fs::read_to_string(&backup).unwrap(), "edited in Aegisub");

        let saved = f.save("{}", Some("and again"), false).unwrap();
        assert_eq!(saved.ass, AssOutcome::Written);
        assert_eq!(saved.ass_backup, None);
    }

    #[test]
    fn never_replaces_an_earlier_backup() {
        let (dir, mut f) = setup();
        let ass = dir.path().join("my clip.ass");
        fs::write(dir.path().join("my clip.ass.bak"), "oldest").unwrap();
        fs::write(&ass, "external").unwrap();
        f.load().unwrap();
        let backup = f.save("{}", Some("ours"), false).unwrap().ass_backup;
        assert_eq!(backup, Some(dir.path().join("my clip.ass.bak2")));
        assert_eq!(
            fs::read_to_string(dir.path().join("my clip.ass.bak")).unwrap(),
            "oldest"
        );
    }

    #[test]
    fn detects_an_ass_edited_after_the_project_was_saved() {
        let (dir, mut f) = setup();
        f.load().unwrap();
        f.save("{}", Some("ours"), false).unwrap();
        let ass = dir.path().join("my clip.ass");
        set_mtime(&ass, SystemTime::now() + Duration::from_secs(60));

        let mut reopened = Files::new(&dir.path().join("my clip.mp4"), None);
        assert!(matches!(
            reopened.load().unwrap(),
            Loaded::Project {
                ass_changed: true,
                ..
            }
        ));
        assert_eq!(
            reopened.save("{}", Some("x"), false).unwrap().ass,
            AssOutcome::Conflict
        );
    }

    #[test]
    fn offers_an_existing_ass_when_there_is_no_project() {
        let (dir, mut f) = setup();
        let ass = dir.path().join("my clip.ass");
        fs::write(&ass, b"\xEF\xBB\xBF[Script Info]").unwrap();
        assert_eq!(
            f.load().unwrap(),
            Loaded::Ass {
                text: "[Script Info]".into(),
                path: ass
            }
        );
        // Having read it, saving may replace it (the caller imported it), but
        // the original is kept as a backup.
        let saved = f.save("{}", Some("x"), false).unwrap();
        assert_eq!(saved.ass, AssOutcome::Written);
        let backup = saved.ass_backup.unwrap();
        assert_eq!(fs::read(backup).unwrap(), b"\xEF\xBB\xBF[Script Info]");
    }

    #[test]
    fn skips_the_ass_when_not_requested() {
        let (dir, mut f) = setup();
        f.load().unwrap();
        assert_eq!(f.save("{}", None, false).unwrap().ass, AssOutcome::Skipped);
        assert!(!dir.path().join("my clip.ass").exists());
    }

    #[cfg(windows)]
    #[test]
    fn falls_back_to_app_data_when_the_project_cannot_be_written() {
        let (dir, mut f) = setup();
        // Renaming onto a directory fails with "access denied" on Windows.
        fs::create_dir(dir.path().join("my clip.bwass")).unwrap();
        f.load().unwrap();
        let saved = f.save("{}", None, false).unwrap();
        assert_eq!(
            saved.project_path,
            dir.path().join("appdata").join("my clip.bwass")
        );
        assert_eq!(
            f.load().unwrap(),
            Loaded::Project {
                json: "{}".into(),
                path: saved.project_path,
                ass_changed: false,
            }
        );
    }

    #[test]
    fn reads_utf16_subtitles() {
        let (dir, _f) = setup();
        let path = dir.path().join("x.ass");
        let mut bytes = vec![0xFF, 0xFE];
        bytes.extend("Ünï".encode_utf16().flat_map(u16::to_le_bytes));
        fs::write(&path, bytes).unwrap();
        assert_eq!(read_text(&path).unwrap(), "Ünï");
    }
}
