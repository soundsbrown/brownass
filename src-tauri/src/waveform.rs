//! Audio waveform peaks for the timeline, computed with ffmpeg and cached.
//!
//! The first audio stream is decoded to 16 kHz mono and reduced to one peak
//! per 16 samples (1000 per second). The frontend builds coarser levels from
//! these for zoomed-out drawing.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncReadExt;

use crate::ffmpeg::{self, FfmpegState};
use crate::hash;
use crate::process;
use crate::video::{OpenedVideo, VideoInfo};

const SAMPLE_RATE: u32 = 16_000;
const SAMPLES_PER_BIN: usize = 16;
const BINS_PER_SECOND: u32 = SAMPLE_RATE / SAMPLES_PER_BIN as u32;

const CACHE_MAGIC: &[u8; 4] = b"BWPK";
const CACHE_VERSION: u32 = 1;
/// The cache keeps the most recently used waveforms within this size (an hour
/// of video takes about 3.6 MB).
const MAX_CACHE_BYTES: u64 = 200 * 1024 * 1024;

/// Counts waveform requests; a newer request cancels an older one.
#[derive(Default)]
pub struct WaveformJobs(AtomicU64);

/// Returns peaks for the opened video as `[u32 LE bins per second][u8 peak]*`,
/// where each peak is the bin's maximum absolute sample scaled to 0-255.
/// Progress (0-1) is reported on `on_progress` while extracting.
#[tauri::command]
pub async fn waveform(
    app: AppHandle,
    video: State<'_, OpenedVideo>,
    ffmpeg: State<'_, FfmpegState>,
    jobs: State<'_, WaveformJobs>,
    on_progress: Channel<f64>,
) -> Result<Response, String> {
    let info = video.get().ok_or("No video is open.")?;
    let job = jobs.0.fetch_add(1, Ordering::SeqCst) + 1;

    let cache = cache_file(&app, &info.path);
    if let Some(payload) = cache.as_deref().and_then(read_cache) {
        if let Some(path) = &cache {
            touch(path);
        }
        return Ok(Response::new(payload));
    }

    let paths = ffmpeg.paths()?;
    let cancelled = || jobs.0.load(Ordering::SeqCst) != job;
    let bins = extract(&paths.ffmpeg, &info, &cancelled, &on_progress).await?;
    let payload = encode(&bins);
    if let Some(path) = cache {
        // A failed cache write only costs a re-extraction next time.
        if write_cache(&path, &payload).is_ok()
            && let Some(dir) = path.parent()
            && let Err(e) = prune_cache(dir, MAX_CACHE_BYTES, &path)
        {
            log::warn!("Could not prune the waveform cache: {e}");
        }
    }
    Ok(Response::new(payload))
}

async fn extract(
    ffmpeg: &Path,
    info: &VideoInfo,
    cancelled: &(dyn Fn() -> bool + Send + Sync),
    progress: &Channel<f64>,
) -> Result<Vec<u8>, String> {
    let rate = SAMPLE_RATE.to_string();
    let mut child = process::spawn(
        ffmpeg::command(ffmpeg)
            .args(["-v", "error", "-nostdin", "-i"])
            .arg(&info.path)
            .args(["-map", "0:a:0", "-vn", "-ac", "1", "-ar", &rate])
            .args(["-f", "s16le", "-acodec", "pcm_s16le", "-"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()),
    )
    .map_err(|e| format!("Could not run ffmpeg: {e}"))?;

    let mut stdout = child.stdout.take().ok_or("ffmpeg has no stdout")?;
    let mut stderr = child.stderr.take().ok_or("ffmpeg has no stderr")?;
    // Drain stderr concurrently so ffmpeg can't block on a full pipe.
    let stderr_task = tokio::spawn(async move {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text).await;
        text
    });

    let expected = (info.duration * f64::from(SAMPLE_RATE)).max(1.0);
    let mut peaks = PeakBuilder::default();
    let mut buf = vec![0u8; 64 * 1024];
    let mut reported = 0.0;
    loop {
        if cancelled() {
            let _ = child.kill().await;
            return Err("Cancelled.".into());
        }
        let n = stdout.read(&mut buf).await.map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        peaks.push_bytes(&buf[..n]);
        let p = (peaks.samples as f64 / expected).min(1.0);
        if p - reported >= 0.01 {
            reported = p;
            let _ = progress.send(p);
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() {
        let detail = stderr_task.await.unwrap_or_default();
        return Err(format!(
            "ffmpeg could not read the audio: {}",
            detail.trim()
        ));
    }
    Ok(peaks.finish())
}

/// Turns a stream of s16le bytes, split at arbitrary points, into peaks.
#[derive(Default)]
struct PeakBuilder {
    bins: Vec<u8>,
    peak: u16,
    in_bin: usize,
    samples: u64,
    odd_byte: Option<u8>,
}

impl PeakBuilder {
    fn push_bytes(&mut self, mut bytes: &[u8]) {
        if let Some(lo) = self.odd_byte.take() {
            let Some((&hi, rest)) = bytes.split_first() else {
                self.odd_byte = Some(lo);
                return;
            };
            self.push_sample(i16::from_le_bytes([lo, hi]));
            bytes = rest;
        }
        let (pairs, rest) = bytes.as_chunks::<2>();
        for pair in pairs {
            self.push_sample(i16::from_le_bytes(*pair));
        }
        if let [b] = rest {
            self.odd_byte = Some(*b);
        }
    }

    fn push_sample(&mut self, sample: i16) {
        self.peak = self.peak.max(sample.unsigned_abs());
        self.in_bin += 1;
        self.samples += 1;
        if self.in_bin == SAMPLES_PER_BIN {
            self.flush();
        }
    }

    fn flush(&mut self) {
        self.bins.push(scale(self.peak));
        self.peak = 0;
        self.in_bin = 0;
    }

    fn finish(mut self) -> Vec<u8> {
        if self.in_bin > 0 {
            self.flush();
        }
        self.bins
    }
}

/// Maps an absolute sample (0-32768) to 0-255, rounding to nearest.
fn scale(peak: u16) -> u8 {
    ((u32::from(peak) * 255 + 16_384) / 32_768).min(255) as u8
}

fn encode(bins: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(4 + bins.len());
    payload.extend_from_slice(&BINS_PER_SECOND.to_le_bytes());
    payload.extend_from_slice(bins);
    payload
}

/// Cache entries are keyed by path, size and modification time, so an
/// edited or replaced video gets fresh peaks.
fn cache_file(app: &AppHandle, video: &Path) -> Option<PathBuf> {
    let meta = fs::metadata(video).ok()?;
    let mtime = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let key = hash::fnv1a(&[
        video.as_os_str().as_encoded_bytes(),
        &meta.len().to_le_bytes(),
        &mtime.to_le_bytes(),
    ]);
    let dir = app.path().app_cache_dir().ok()?.join("waveforms");
    Some(dir.join(format!("{key:016x}.peaks")))
}

fn read_cache(path: &Path) -> Option<Vec<u8>> {
    let data = fs::read(path).ok()?;
    let rest = data.strip_prefix(CACHE_MAGIC)?;
    let (version, payload) = rest.split_first_chunk::<4>()?;
    (u32::from_le_bytes(*version) == CACHE_VERSION && payload.len() >= 4).then(|| payload.to_vec())
}

/// Marks a cache entry as recently used (its modification time is the
/// "last used" time for pruning).
fn touch(path: &Path) {
    if let Ok(file) = fs::File::options().write(true).open(path) {
        let _ = file.set_modified(std::time::SystemTime::now());
    }
}

/// Deletes the least recently used cache entries until the cache fits in
/// `max_bytes`, never deleting `keep` (the entry just written).
fn prune_cache(dir: &Path, max_bytes: u64, keep: &Path) -> std::io::Result<()> {
    let mut entries: Vec<(std::time::SystemTime, u64, PathBuf)> = fs::read_dir(dir)?
        .filter_map(|e| {
            let path = e.ok()?.path();
            if path.extension()? != "peaks" {
                return None;
            }
            let meta = fs::metadata(&path).ok()?;
            Some((meta.modified().ok()?, meta.len(), path))
        })
        .collect();
    let mut total: u64 = entries.iter().map(|(_, len, _)| len).sum();
    entries.sort_by_key(|(used, _, _)| *used);
    for (_, len, path) in entries {
        if total <= max_bytes {
            break;
        }
        if path != keep && fs::remove_file(&path).is_ok() {
            total -= len;
        }
    }
    Ok(())
}

fn write_cache(path: &Path, payload: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut data = Vec::with_capacity(8 + payload.len());
    data.extend_from_slice(CACHE_MAGIC);
    data.extend_from_slice(&CACHE_VERSION.to_le_bytes());
    data.extend_from_slice(payload);
    let tmp = path.with_extension("peaks.tmp");
    fs::write(&tmp, data)?;
    fs::rename(tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn samples_to_bytes(samples: &[i16]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }

    #[test]
    fn builds_one_peak_per_bin() {
        let mut samples = vec![0i16; SAMPLES_PER_BIN * 3 + 5];
        samples[3] = -16_384; // bin 0: half scale
        samples[SAMPLES_PER_BIN + 7] = i16::MAX; // bin 1: full scale
        samples[SAMPLES_PER_BIN * 3 + 1] = i16::MIN; // partial last bin
        let mut b = PeakBuilder::default();
        b.push_bytes(&samples_to_bytes(&samples));
        assert_eq!(b.finish(), vec![128, 255, 0, 255]);
    }

    #[test]
    fn result_does_not_depend_on_chunking() {
        let samples: Vec<i16> = (0..1000)
            .map(|i| ((i * 7919) % 65_536 - 32_768) as i16)
            .collect();
        let bytes = samples_to_bytes(&samples);

        let mut whole = PeakBuilder::default();
        whole.push_bytes(&bytes);

        let mut chunked = PeakBuilder::default();
        for chunk in bytes.chunks(7) {
            chunked.push_bytes(chunk);
        }
        chunked.push_bytes(&[]);
        assert_eq!(chunked.samples, 1000);
        assert_eq!(chunked.finish(), whole.finish());
    }

    #[test]
    fn scales_to_byte_range() {
        assert_eq!(scale(0), 0);
        assert_eq!(scale(64), 0);
        assert_eq!(scale(65), 1);
        assert_eq!(scale(32_768), 255);
    }

    #[test]
    fn prunes_least_recently_used_entries_to_the_limit() {
        use std::time::{Duration, SystemTime};
        let dir = tempfile::tempdir().unwrap();
        let entry = |name: &str, age_secs: u64| {
            let path = dir.path().join(name);
            fs::write(&path, vec![0u8; 100]).unwrap();
            let file = fs::File::options().write(true).open(&path).unwrap();
            file.set_modified(SystemTime::now() - Duration::from_secs(age_secs))
                .unwrap();
            path
        };
        entry("oldest.peaks", 400);
        let older = entry("older.peaks", 300);
        let recent = entry("recent.peaks", 100);
        let new = entry("new.peaks", 500); // just written, but with an old time
        fs::write(dir.path().join("other.txt"), vec![0u8; 1000]).unwrap();

        prune_cache(dir.path(), 250, &new).unwrap();
        let mut left: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        // 400 bytes of entries, limit 250: the two oldest go (not "new").
        assert_eq!(left, ["new.peaks", "other.txt", "recent.peaks"]);

        // Using an entry makes it recent again.
        touch(&older);
        assert!(
            !older.exists(),
            "deleted above, touching doesn't recreate it"
        );
        touch(&recent);
        assert!(
            fs::metadata(&recent).unwrap().modified().unwrap()
                > SystemTime::now() - Duration::from_secs(5)
        );
    }

    #[test]
    fn cache_round_trips_and_rejects_other_versions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub").join("x.peaks");
        let payload = encode(&[1, 2, 3]);
        write_cache(&path, &payload).unwrap();
        assert_eq!(read_cache(&path), Some(payload));

        fs::write(&path, b"BWPK\x09\x00\x00\x00\xe8\x03\x00\x00").unwrap();
        assert_eq!(read_cache(&path), None);
    }

    /// Runs real ffmpeg. Set BROWNASS_TEST_FFMPEG (ffmpeg.exe) and
    /// BROWNASS_TEST_VIDEO (a file with audio), then `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn extracts_peaks_with_real_ffmpeg() {
        let ffmpeg = PathBuf::from(std::env::var("BROWNASS_TEST_FFMPEG").unwrap());
        let path = PathBuf::from(std::env::var("BROWNASS_TEST_VIDEO").unwrap());
        let duration = 20.0;
        let info = VideoInfo {
            path,
            width: 0,
            height: 0,
            fps: 30.0,
            duration,
            video_codec: String::new(),
            audio_codec: Some("aac".into()),
        };
        let progress = Channel::new(|_| Ok(()));
        let bins = extract(&ffmpeg, &info, &|| false, &progress).await.unwrap();
        let expected = (duration * f64::from(BINS_PER_SECOND)) as usize;
        assert!(bins.len().abs_diff(expected) <= 50, "{} bins", bins.len());
        assert!(bins.iter().any(|&b| b > 0));
    }
}
