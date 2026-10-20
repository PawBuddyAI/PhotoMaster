use tauri::Manager;

/// 把主窗口带到前台：从任务栏最小化恢复并获得焦点。
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 必须最先注册：再次启动（包括点击 ai-photo-master:// 深链）时交给已运行的窗口，深链由 deep-link 插件转交给前端。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| focus_main_window(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        // 必须在 fs 之后：把对话框选过的文件记入磁盘，重启后「保存」仍能写回工程记着的原图路径。
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // 安装包在安装时注册 ai-photo-master://；开发运行时在这里注册。失败只影响自动跳回，仍可粘贴连接码。
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(error) = app.deep_link().register_all() {
                    log::warn!("无法注册 ai-photo-master:// 深链：{error}");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
