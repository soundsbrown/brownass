mod dialogs;
mod export;
mod ffmpeg;
mod fonts;
mod hash;
mod process;
mod project_files;
mod settings;
mod stylesheets;
mod video;
mod waveform;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    fonts::warm_up();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ffmpeg::FfmpegState::default())
        .manage(video::OpenedVideo::default())
        .manage(project_files::ProjectFiles::default())
        .manage(waveform::WaveformJobs::default())
        .manage(stylesheets::StylesheetFiles::default())
        .manage(export::Exports::default())
        .invoke_handler(tauri::generate_handler![
            export::detect_encoders,
            export::export_video,
            export::cancel_export,
            export::reveal_export,
            export::render_test_frame,
            export::export_soft_subtitles,
            ffmpeg::ffmpeg_status,
            ffmpeg::locate_ffmpeg,
            fonts::font_families,
            fonts::font_files,
            fonts::missing_fonts,
            video::open_video,
            project_files::load_project,
            project_files::save_project,
            stylesheets::list_stylesheets,
            stylesheets::save_stylesheet,
            stylesheets::delete_stylesheet,
            stylesheets::open_stylesheets_folder,
            waveform::waveform
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
