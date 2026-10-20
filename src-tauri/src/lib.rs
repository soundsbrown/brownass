mod ffmpeg;
mod settings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ffmpeg::FfmpegState::default())
        .invoke_handler(tauri::generate_handler![
            ffmpeg::ffmpeg_status,
            ffmpeg::locate_ffmpeg
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
