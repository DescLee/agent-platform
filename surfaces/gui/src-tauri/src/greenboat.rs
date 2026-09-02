use std::io::Write;
use tauri::Manager;

fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Only the main window may export messages".into())
    }
}

#[tauri::command]
pub async fn start_greenboat_export(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    job_id: String,
) -> Result<(), String> {
    main_only(&window)?;
    uuid::Uuid::parse_str(&job_id).map_err(|_| "Invalid export job ID")?;
    let webview = app
        .get_webview_window("greenboat")
        .ok_or("请先打开绿舟并登录")?;
    let url = webview.url().map_err(|e| e.to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some("imwork.syncotechai.com")
        || url.port_or_known_default() != Some(8663)
    {
        return Err("请在绿舟窗口进入消息页后重试".into());
    }
    let script = include_str!("greenboat-export.js").replace(
        "__GREENBOAT_JOB_ID__",
        &serde_json::to_string(&job_id).map_err(|e| e.to_string())?,
    );
    webview.show().map_err(|e| e.to_string())?;
    webview.eval(&script).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cancel_greenboat_export(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    job_id: String,
) -> Result<(), String> {
    main_only(&window)?;
    uuid::Uuid::parse_str(&job_id).map_err(|_| "Invalid export job ID")?;
    if let Some(webview) = app.get_webview_window("greenboat") {
        let id = serde_json::to_string(&job_id).map_err(|e| e.to_string())?;
        webview.eval(format!("if(window.__greenboatExport?.id === {id}) window.__greenboatExport.cancelled = true;")).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn save_greenboat_report(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    date: String,
    report: String,
) -> Result<String, String> {
    main_only(&window)?;
    if date.len() != 10
        || !date.chars().all(|c| c.is_ascii_digit() || c == '-')
        || report.len() > 25 * 1024 * 1024
    {
        return Err("Invalid report date or report exceeds 25 MB".into());
    }
    let path = app
        .path()
        .desktop_dir()
        .map_err(|e| e.to_string())?
        .join(format!("绿舟今日消息-{}-{}.md", date, uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(|e| e.to_string())?;
    if let Err(error) = file
        .write_all(report.as_bytes())
        .and_then(|_| file.sync_all())
    {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err(error.to_string());
    }
    Ok(path.to_string_lossy().into_owned())
}
