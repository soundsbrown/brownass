mod dialogs;
mod export;
mod ffmpeg;
mod fonts;
mod hash;
mod process;
mod project_files;
mod settings;
mod shell;
mod stylesheets;
mod svg_import;
mod video;
mod waveform;
mod woff;

use tauri::{AppHandle, Manager, Runtime};

/// The window title's app part, e.g. "BrownASS 0.4.0".
pub fn app_title<R: Runtime>(app: &AppHandle<R>) -> String {
    format!("BrownASS {}", app.package_info().version)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    fonts::warm_up();
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(ffmpeg::FfmpegState::default())
        .manage(video::OpenedVideo::default())
        .manage(project_files::ProjectFiles::default())
        .manage(waveform::WaveformJobs::default())
        .manage(stylesheets::StylesheetFiles::default())
        .manage(export::Exports::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&app_title(app.handle()))?;
            }
            Ok(())
        })
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
            video::open_recent,
            video::recent_videos,
            video::forget_recent,
            project_files::load_project,
            project_files::save_project,
            shell::log_from_ui,
            shell::open_log_folder,
            stylesheets::list_stylesheets,
            stylesheets::save_stylesheet,
            stylesheets::delete_stylesheet,
            stylesheets::open_stylesheets_folder,
            svg_import::import_svg,
            waveform::waveform
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
