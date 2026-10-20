//! System fonts by name. Shared by the live preview (font data for JASSUB)
//! and export (font files copied into ffmpeg's `fontsdir`), so both see the
//! same fonts.
//!
//! ASS refers to fonts by name, and libass matches the family (name IDs 1 and
//! 16), full name (4) and PostScript name (6), so all of those are indexed.
//! A family maps to every file with a face of that family (regular, bold,
//! italic, ...); libass picks the right face among them.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::ipc::Response;
use ttf_parser::name_id;

pub struct FontIndex {
    by_name: HashMap<String, BTreeSet<PathBuf>>,
}

impl FontIndex {
    /// The system's fonts, indexed on first use (takes a moment; call from a
    /// blocking-friendly context).
    pub fn system() -> &'static FontIndex {
        static INDEX: OnceLock<FontIndex> = OnceLock::new();
        INDEX.get_or_init(|| {
            let mut db = fontdb::Database::new();
            db.load_system_fonts();
            Self::from_db(&db)
        })
    }

    fn from_db(db: &fontdb::Database) -> Self {
        let mut by_name: HashMap<String, BTreeSet<PathBuf>> = HashMap::new();
        for face in db.faces() {
            let path = match &face.source {
                fontdb::Source::File(path) => path.clone(),
                fontdb::Source::SharedFile(path, _) => path.clone(),
                fontdb::Source::Binary(_) => continue,
            };
            let names = db.with_face_data(face.id, face_names).unwrap_or_default();
            let fallback = face.families.iter().map(|(name, _)| name.clone());
            for name in names
                .into_iter()
                .chain(fallback)
                .chain([face.post_script_name.clone()])
            {
                let key = normalize(&name);
                if !key.is_empty() {
                    by_name.entry(key).or_default().insert(path.clone());
                }
            }
        }
        Self { by_name }
    }

    /// Files containing faces named `name` (case-insensitive).
    pub fn files(&self, name: &str) -> impl Iterator<Item = &PathBuf> {
        self.by_name.get(&normalize(name)).into_iter().flatten()
    }

    pub fn contains(&self, name: &str) -> bool {
        self.by_name.contains_key(&normalize(name))
    }
}

fn normalize(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Family, typographic family, full and PostScript names, in any language.
fn face_names(data: &[u8], index: u32) -> Vec<String> {
    let Ok(face) = ttf_parser::Face::parse(data, index) else {
        return Vec::new();
    };
    face.names()
        .into_iter()
        .filter(|n| {
            matches!(
                n.name_id,
                name_id::FAMILY
                    | name_id::TYPOGRAPHIC_FAMILY
                    | name_id::FULL_NAME
                    | name_id::POST_SCRIPT_NAME
            )
        })
        .filter_map(|n| n.to_string())
        .collect()
}

/// Builds the system font index in the background, so the first preview
/// doesn't wait for it.
pub fn warm_up() {
    std::thread::spawn(FontIndex::system);
}

/// The font files for `name`, as `[u32 count]([u32 length][bytes])*` (LE).
/// An empty list means the font isn't installed.
#[tauri::command]
pub async fn font_files(name: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let files: Vec<Vec<u8>> = FontIndex::system()
            .files(&name)
            .filter_map(|path| fs::read(path).ok())
            .collect();
        Response::new(encode(&files))
    })
    .await
    .map_err(|e| e.to_string())
}

/// Which of `names` aren't installed.
#[tauri::command]
pub async fn missing_fonts(names: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let index = FontIndex::system();
        names.into_iter().filter(|n| !index.contains(n)).collect()
    })
    .await
    .map_err(|e| e.to_string())
}

fn encode(files: &[Vec<u8>]) -> Vec<u8> {
    let total: usize = files.iter().map(|f| 4 + f.len()).sum();
    let mut out = Vec::with_capacity(4 + total);
    out.extend_from_slice(&(files.len() as u32).to_le_bytes());
    for file in files {
        out.extend_from_slice(&(file.len() as u32).to_le_bytes());
        out.extend_from_slice(file);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_length_prefixed_files() {
        assert_eq!(
            encode(&[vec![1, 2], vec![]]),
            [2, 0, 0, 0, 2, 0, 0, 0, 1, 2, 0, 0, 0, 0]
        );
    }

    /// Indexes the real system fonts: `cargo test system_index -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn system_index() {
        let start = std::time::Instant::now();
        let index = FontIndex::system();
        println!(
            "{} names indexed in {:?}",
            index.by_name.len(),
            start.elapsed()
        );
        assert!(index.by_name.len() > 10);
    }

    #[cfg(windows)]
    #[test]
    fn indexes_arial_by_family_full_and_postscript_name() {
        let mut db = fontdb::Database::new();
        let fonts = PathBuf::from(std::env::var("SYSTEMROOT").unwrap()).join("Fonts");
        for file in ["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"] {
            db.load_font_file(fonts.join(file)).unwrap();
        }
        let index = FontIndex::from_db(&db);

        let family: Vec<_> = index.files("ARIAL").collect();
        assert_eq!(family.len(), 4, "{family:?}");
        // Full and PostScript names find a single face.
        assert_eq!(index.files("Arial Bold Italic").count(), 1);
        assert_eq!(index.files("Arial-BoldMT").count(), 1);
        assert!(index.contains(" arial "));
        assert!(!index.contains("Comic Neue Nonexistent"));
    }
}
