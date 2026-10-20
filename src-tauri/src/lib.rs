mod dialogs;
mod ffmpeg;
mod settings;
mod video;
mod waveform;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ffmpeg::FfmpegState::default())
        .manage(video::OpenedVideo::default())
        .manage(waveform::WaveformJobs::default())
        .invoke_handler(tauri::generate_handler![
            ffmpeg::ffmpeg_status,
            ffmpeg::locate_ffmpeg,
            video::open_video,
            waveform::waveform
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
