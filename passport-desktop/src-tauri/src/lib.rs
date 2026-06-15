use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Default)]
struct ScanState {
    in_progress: Arc<Mutex<bool>>,
    active_child: Arc<Mutex<Option<Child>>>,
    cancel_requested: Arc<Mutex<bool>>,
}

#[derive(Clone)]
struct RendererHealth {
    last_heartbeat: Arc<Mutex<Instant>>,
    has_heartbeat: Arc<Mutex<bool>>,
    recovery_attempts: Arc<Mutex<u32>>,
    window_focused: Arc<Mutex<bool>>,
}

impl Default for RendererHealth {
    fn default() -> Self {
        Self {
            last_heartbeat: Arc::new(Mutex::new(Instant::now())),
            has_heartbeat: Arc::new(Mutex::new(false)),
            recovery_attempts: Arc::new(Mutex::new(0)),
            window_focused: Arc::new(Mutex::new(true)),
        }
    }
}

struct WorkerPaths {
    repo_root: PathBuf,
    command_executable: PathBuf,
    worker_script: Option<PathBuf>,
    working_dir: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PassportImageData {
    path: String,
    data_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedPassportCrop {
    path: String,
    relative_path: String,
}

const RENDERER_WATCHDOG_INTERVAL: Duration = Duration::from_secs(15);
const RENDERER_HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(75);
const RENDERER_WATCHDOG_PING_SCRIPT: &str = r#"(() => ({
  ok: true,
  href: window.location.href,
  bodyLength: document.body ? document.body.innerText.length : -1,
  timestamp: Date.now()
}))()"#;

fn diagnostics_log_path() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("entrymate-by-ghaniya")
        .join("diagnostics.log")
}

fn log_diagnostic(message: impl AsRef<str>) {
    let path = diagnostics_log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{:?}] {}", SystemTime::now(), message.as_ref());
    }
}

fn mark_renderer_seen(health: &RendererHealth) -> Result<bool, String> {
    let is_first_heartbeat = {
        let mut has_heartbeat = health
            .has_heartbeat
            .lock()
            .map_err(|_| "Gagal mengunci status heartbeat renderer.".to_string())?;
        let is_first = !*has_heartbeat;
        *has_heartbeat = true;
        is_first
    };

    {
        let mut last_heartbeat = health
            .last_heartbeat
            .lock()
            .map_err(|_| "Gagal memperbarui heartbeat renderer.".to_string())?;
        *last_heartbeat = Instant::now();
    }

    if let Ok(mut recovery_attempts) = health.recovery_attempts.lock() {
        *recovery_attempts = 0;
    }

    Ok(is_first_heartbeat)
}

#[cfg(target_os = "windows")]
fn configure_webview2_runtime() {
    const DISABLED_EDGE_FEATURES: &str = concat!(
        "CalculateNativeWinOcclusion,",
        "msDesktopMam,",
        "msMamDlp,",
        "msAllowMamDevToolsBlock,",
        "msAllowMamEnrollmentForAffiliatedProfiles,",
        "msAllowMamEnrollmentWithConflictingDlp,",
        "msAllowMamEnrollmentWithoutCABlock,",
        "msAllowMamOnMdm,",
        "msAllowMamScreenCaptureBlock,",
        "msDlpUseOneDriveForMAMDownloadBlock,",
        "msEnableMamAuthFlow,",
        "msEnableMamEnrollmentPage,",
        "msEnableMamTelemetry,",
        "msEnableMamWorkplaceJoinEnforcement,",
        "msDataProtection,",
        "msEnableDataControls,",
        "msSingleSignOnOSForPrimaryAccountIsShared,",
        "msAutoToggleAADPrtSSOForNonAADProfile,",
        "msBrowserSignInAllowedByPolicy,",
        "msEdgeOnlineAccounts,",
        "msEdgeOSAccountInfoManagerCache,",
        "msEdgeOSAccountInfoSubstrate,",
        "msEdgeProfileIntegratedAccountsInfo,",
        "msEdgeSignInAccountPicker,",
        "msEdgeSignInAccountPickerFRE,",
        "msEdgeSignInAccountPickerProfileCard,",
        "msEdgeSignInAccountPickerSettingsPage,",
        "msEnableAADWebToBrowserSignIn,",
        "msEnableProfileAADAccountSSO,",
        "msEnableWebToBrowserSignIn,",
        "msForceBrowserSignIn,",
        "msForceSigninManagedBar,",
        "edge-desktop-mam,",
        "edge-saas-dlp,",
        "edge-purview-dlp-paste,",
        "edge-llm-dlp-purview,",
        "edge-mip-enabled-pdf,",
        "edge-managed-site-indicator-dlp-policy-view,",
        "edge-sso-ignore-profile,",
        "profile-signals-reporting-enabled"
    );
    let webview_args = [
        "--disable-gpu".to_string(),
        "--disable-background-networking".to_string(),
        "--disable-component-update".to_string(),
        "--disable-renderer-backgrounding".to_string(),
        "--disable-background-timer-throttling".to_string(),
        "--dlp-protection-type=none".to_string(),
        format!("--disable-features={DISABLED_EDGE_FEATURES}"),
    ];

    let mut args = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
    for arg in webview_args {
        if !args.contains(&arg) {
            if !args.trim().is_empty() {
                args.push(' ');
            }
            args.push_str(&arg);
        }
    }

    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", &args);
    log_diagnostic(format!("configured WebView2 args: {args}"));
}

#[cfg(not(target_os = "windows"))]
fn configure_webview2_runtime() {}

fn ping_renderer(app: &AppHandle, health: &RendererHealth) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let health = health.clone();
    if let Err(err) = window.eval_with_callback(RENDERER_WATCHDOG_PING_SCRIPT, move |_| {
        if let Ok(is_first_heartbeat) = mark_renderer_seen(&health) {
            if is_first_heartbeat {
                log_diagnostic("renderer heartbeat started by host ping");
            }
        }
    }) {
        log_diagnostic(format!("renderer host ping failed: {err}"));
    }
}

fn start_renderer_watchdog(app: AppHandle, health: RendererHealth) {
    thread::spawn(move || loop {
        thread::sleep(RENDERER_WATCHDOG_INTERVAL);

        let window_focused = health
            .window_focused
            .lock()
            .map(|value| *value)
            .unwrap_or(true);
        if !window_focused {
            continue;
        }

        ping_renderer(&app, &health);

        let has_heartbeat = health
            .has_heartbeat
            .lock()
            .map(|value| *value)
            .unwrap_or(false);
        if !has_heartbeat {
            continue;
        }

        let elapsed = health
            .last_heartbeat
            .lock()
            .map(|value| value.elapsed())
            .unwrap_or_else(|_| Duration::from_secs(0));
        if elapsed < RENDERER_HEARTBEAT_TIMEOUT {
            continue;
        }

        let recovery_attempt = health
            .recovery_attempts
            .lock()
            .map(|mut value| {
                *value += 1;
                *value
            })
            .unwrap_or(2);

        if recovery_attempt == 1 {
            log_diagnostic(format!(
                "renderer heartbeat stale for {}s; reloading main window",
                elapsed.as_secs()
            ));

            match app.get_webview_window("main") {
                Some(window) => {
                    if let Err(err) = window.reload() {
                        log_diagnostic(format!("main window reload failed: {err}"));
                    } else {
                        log_diagnostic("main window reload requested by renderer watchdog");
                    }
                }
                None => log_diagnostic("renderer watchdog could not find main window"),
            }

            continue;
        }

        log_diagnostic(format!(
            "renderer heartbeat still stale after reload attempt; restarting app after {}s",
            elapsed.as_secs()
        ));
        app.restart();
    });
}

#[tauri::command]
fn renderer_heartbeat(state: State<'_, RendererHealth>) -> Result<(), String> {
    let is_first_heartbeat = mark_renderer_seen(&state)?;
    if is_first_heartbeat {
        log_diagnostic("renderer heartbeat started");
    }

    Ok(())
}

fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Jendela utama tidak ditemukan.".to_string())
}

#[tauri::command]
fn window_minimize(app: AppHandle) -> Result<(), String> {
    main_window(&app)?
        .minimize()
        .map_err(|err| format!("Gagal minimize jendela: {err}"))
}

#[tauri::command]
fn window_start_dragging(app: AppHandle) -> Result<(), String> {
    main_window(&app)?
        .start_dragging()
        .map_err(|err| format!("Gagal drag jendela: {err}"))
}

#[tauri::command]
fn window_toggle_maximize(app: AppHandle) -> Result<bool, String> {
    let window = main_window(&app)?;
    let is_maximized = window
        .is_maximized()
        .map_err(|err| format!("Gagal membaca status jendela: {err}"))?;
    if is_maximized {
        window
            .unmaximize()
            .map_err(|err| format!("Gagal restore jendela: {err}"))?;
        Ok(false)
    } else {
        window
            .maximize()
            .map_err(|err| format!("Gagal maximize jendela: {err}"))?;
        Ok(true)
    }
}

#[tauri::command]
fn window_close(app: AppHandle) -> Result<(), String> {
    main_window(&app)?
        .close()
        .map_err(|err| format!("Gagal menutup jendela: {err}"))
}

fn emit_scan_error(app: &AppHandle, code: &str, message: String, stage: &str, fatal: bool) {
    let _ = app.emit(
        "scan-event",
        json!({
            "event": "scan_error",
            "code": code,
            "message": message,
            "stage": stage,
            "fatal": fatal
        }),
    );
    if fatal {
        let _ = app.emit(
            "scan-event",
            json!({
                "event": "scan_failed",
                "message": format!("[{code}] {message}")
            }),
        );
    }
}

fn emit_scan_stopped(app: &AppHandle) {
    let _ = app.emit(
        "scan-event",
        json!({
            "event": "scan_stopped",
            "message": "Proses scan dihentikan oleh pengguna."
        }),
    );
}

#[tauri::command]
fn start_scan(
    app: AppHandle,
    state: State<'_, ScanState>,
    selected_dir: String,
    ocr_mode: Option<String>,
    prepared_manifest_path: Option<String>,
) -> Result<(), String> {
    let selected_dir = selected_dir.trim().to_string();
    if selected_dir.is_empty() {
        return Err("Folder passport belum dipilih.".to_string());
    }
    let ocr_mode = normalize_ocr_mode(ocr_mode.as_deref().unwrap_or(""))?;
    let prepared_manifest_path = prepared_manifest_path
        .unwrap_or_default()
        .trim()
        .to_string();

    let worker_paths = locate_worker_paths()?;
    let scan_flag = state.in_progress.clone();
    let active_child = state.active_child.clone();
    let cancel_requested = state.cancel_requested.clone();

    {
        let mut in_progress = scan_flag
            .lock()
            .map_err(|_| "Gagal mengunci status scan.".to_string())?;
        if *in_progress {
            return Err("Scan sedang berjalan. Tunggu proses saat ini selesai.".to_string());
        }
        *in_progress = true;
    }
    if let Ok(mut requested) = cancel_requested.lock() {
        *requested = false;
    }

    thread::spawn(move || {
        let result = run_worker_process(
            &app,
            &worker_paths,
            &selected_dir,
            &ocr_mode,
            &prepared_manifest_path,
            active_child.clone(),
            cancel_requested.clone(),
        );
        if let Err(message) = result {
            emit_scan_error(
                &app,
                "RUST_SCAN_PROCESS_FAILED",
                message,
                "start_scan",
                true,
            );
        }

        if let Ok(mut in_progress) = scan_flag.lock() {
            *in_progress = false;
        }
        if let Ok(mut child) = active_child.lock() {
            *child = None;
        }
        if let Ok(mut requested) = cancel_requested.lock() {
            *requested = false;
        }
    });

    Ok(())
}

#[tauri::command]
fn prepare_passport_images(
    selected_dir: String,
    pdf_batch_mode: Option<bool>,
) -> Result<Value, String> {
    let selected_dir = selected_dir.trim().to_string();
    if selected_dir.is_empty() {
        return Err("Folder passport belum dipilih.".to_string());
    }

    let worker_paths = locate_worker_paths()?;
    let mut command = Command::new(&worker_paths.command_executable);
    configure_worker_tesseract_environment(&mut command, &worker_paths.repo_root);
    command
        .current_dir(&worker_paths.working_dir)
        .env("PYTHONUNBUFFERED", "1");

    if pdf_batch_mode.unwrap_or(false) {
        command.env("PASSPORT_PDF_BATCH_MODE", "1");
    }

    if let Some(worker_script) = &worker_paths.worker_script {
        command.arg("-u").arg(worker_script);
    }

    command
        .arg("--prepare")
        .arg(&selected_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }

    let output = command.output().map_err(|err| {
        format!(
            "Gagal menjalankan prepare worker {}: {err}",
            worker_paths.command_executable.display()
        )
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut prepared_session: Option<Value> = None;
    let mut worker_failure: Option<String> = None;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(payload) = serde_json::from_str::<Value>(trimmed) else {
            log_diagnostic(format!("prepare worker log: {trimmed}"));
            continue;
        };
        match payload.get("event").and_then(Value::as_str).unwrap_or("") {
            "prepare_complete" => {
                prepared_session = payload.get("session").cloned();
            }
            "prepare_failed" => {
                worker_failure = payload
                    .get("message")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
            "prepare_log" | "scan_log" => {
                if let Some(message) = payload.get("message").and_then(Value::as_str) {
                    log_diagnostic(format!("prepare worker: {message}"));
                }
            }
            "scan_error" => {
                if let Some(message) = payload.get("message").and_then(Value::as_str) {
                    worker_failure = Some(message.to_string());
                }
            }
            _ => {}
        }
    }

    if let Some(session) = prepared_session {
        return Ok(session);
    }

    if let Some(message) = worker_failure {
        return Err(message);
    }

    if !output.status.success() {
        let message = if stderr.trim().is_empty() {
            format!(
                "Prepare worker berhenti dengan kode {:?}.",
                output.status.code()
            )
        } else {
            stderr.trim().to_string()
        };
        return Err(message);
    }

    Err("Prepare worker selesai tanpa mengirim daftar foto.".to_string())
}

#[tauri::command]
fn save_prepared_passport_image(
    prepared_manifest_path: String,
    item_id: String,
    source_image_path: String,
    data_url: String,
    crop: Value,
    rotation_degrees: Option<i64>,
) -> Result<Value, String> {
    let manifest_path = resolve_prepared_manifest_path(&prepared_manifest_path)?;
    let content = fs::read_to_string(&manifest_path).map_err(|err| {
        format!(
            "Gagal membaca prepared manifest {}: {err}",
            manifest_path.display()
        )
    })?;
    let mut manifest: Value = serde_json::from_str(&content)
        .map_err(|err| format!("Prepared manifest tidak valid: {err}"))?;
    if manifest.get("schemaVersion").and_then(Value::as_str) != Some("passport-prepared-inputs-v1")
    {
        return Err("Prepared manifest tidak dikenali.".to_string());
    }

    let output_dir = manifest_path
        .parent()
        .ok_or_else(|| "Lokasi prepared manifest tidak valid.".to_string())?
        .join("edited-images");
    fs::create_dir_all(&output_dir).map_err(|err| {
        format!(
            "Gagal membuat folder edited image {}: {err}",
            output_dir.display()
        )
    })?;

    let bytes = decode_image_data_url(&data_url)?;
    let base_name = crop_file_base_name(&item_id, "", &source_image_path);
    let output_path = output_dir.join(format!("{base_name}.jpg"));
    fs::write(&output_path, bytes).map_err(|err| {
        format!(
            "Gagal menyimpan foto prepared {}: {err}",
            output_path.display()
        )
    })?;
    let resolved = fs::canonicalize(&output_path).unwrap_or(output_path);
    let edited_path = path_to_display_string(&resolved);
    let rotation = rotation_degrees.unwrap_or(0);

    let items = manifest
        .get_mut("items")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Prepared manifest tidak memiliki daftar items.".to_string())?;
    let mut found = false;
    for item in items {
        let is_target = item
            .get("id")
            .and_then(Value::as_str)
            .map(|value| value == item_id.trim())
            .unwrap_or(false);
        if !is_target {
            continue;
        }
        let Some(map) = item.as_object_mut() else {
            continue;
        };
        map.insert("editedPath".to_string(), Value::String(edited_path.clone()));
        map.insert("rotationDegrees".to_string(), json!(rotation));
        map.insert("cropMetadata".to_string(), crop.clone());
        found = true;
        break;
    }

    if !found {
        return Err("Prepared item tidak ditemukan.".to_string());
    }

    let serialized = serde_json::to_string_pretty(&manifest)
        .map_err(|err| format!("Gagal menyiapkan prepared manifest: {err}"))?;
    fs::write(&manifest_path, serialized).map_err(|err| {
        format!(
            "Gagal menyimpan prepared manifest {}: {err}",
            manifest_path.display()
        )
    })?;

    Ok(manifest)
}

#[tauri::command]
fn remove_prepared_passport_image(
    prepared_manifest_path: String,
    item_id: String,
) -> Result<Value, String> {
    let manifest_path = resolve_prepared_manifest_path(&prepared_manifest_path)?;
    let content = fs::read_to_string(&manifest_path).map_err(|err| {
        format!(
            "Gagal membaca prepared manifest {}: {err}",
            manifest_path.display()
        )
    })?;
    let mut manifest: Value = serde_json::from_str(&content)
        .map_err(|err| format!("Prepared manifest tidak valid: {err}"))?;
    if manifest.get("schemaVersion").and_then(Value::as_str) != Some("passport-prepared-inputs-v1")
    {
        return Err("Prepared manifest tidak dikenali.".to_string());
    }

    let trimmed_item_id = item_id.trim();
    let removed_item = {
        let items = manifest
            .get_mut("items")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| "Prepared manifest tidak memiliki daftar items.".to_string())?;
        let Some(index) = items.iter().position(|item| {
            item.get("id")
                .and_then(Value::as_str)
                .map(|value| value == trimmed_item_id)
                .unwrap_or(false)
        }) else {
            return Err("Prepared item tidak ditemukan.".to_string());
        };

        items.remove(index)
    };

    move_removed_prepared_files(&manifest_path, &removed_item, trimmed_item_id, "removed-images")?;

    let next_image_count =
        if let Some(items) = manifest.get_mut("items").and_then(Value::as_array_mut) {
            for (index, item) in items.iter_mut().enumerate() {
                if let Some(map) = item.as_object_mut() {
                    map.insert("index".to_string(), json!(index + 1));
                }
            }
            Some(items.len())
        } else {
            None
        };

    if let Some(map) = manifest.as_object_mut() {
        if let Some(count) = next_image_count {
            map.insert("imageCount".to_string(), json!(count));
        }
        let removed_log = map
            .entry("removedItems".to_string())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(list) = removed_log.as_array_mut() {
            list.push(removed_item);
        }
    }

    let serialized = serde_json::to_string_pretty(&manifest)
        .map_err(|err| format!("Gagal menyiapkan prepared manifest: {err}"))?;
    fs::write(&manifest_path, serialized).map_err(|err| {
        format!(
            "Gagal menyimpan prepared manifest {}: {err}",
            manifest_path.display()
        )
    })?;

    Ok(manifest)
}

#[tauri::command]
fn endorse_prepared_passport_image(
    prepared_manifest_path: String,
    item_id: String,
) -> Result<Value, String> {
    let manifest_path = resolve_prepared_manifest_path(&prepared_manifest_path)?;
    let content = fs::read_to_string(&manifest_path).map_err(|err| {
        format!(
            "Gagal membaca prepared manifest {}: {err}",
            manifest_path.display()
        )
    })?;
    let mut manifest: Value = serde_json::from_str(&content)
        .map_err(|err| format!("Prepared manifest tidak valid: {err}"))?;
    if manifest.get("schemaVersion").and_then(Value::as_str) != Some("passport-prepared-inputs-v1")
    {
        return Err("Prepared manifest tidak dikenali.".to_string());
    }

    let trimmed_item_id = item_id.trim();
    let removed_item = {
        let items = manifest
            .get_mut("items")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| "Prepared manifest tidak memiliki daftar items.".to_string())?;
        let Some(index) = items.iter().position(|item| {
            item.get("id")
                .and_then(Value::as_str)
                .map(|value| value == trimmed_item_id)
                .unwrap_or(false)
        }) else {
            return Err("Prepared item tidak ditemukan.".to_string());
        };

        items.remove(index)
    };

    move_removed_prepared_files(&manifest_path, &removed_item, trimmed_item_id, "endorsement-images")?;

    let next_image_count =
        if let Some(items) = manifest.get_mut("items").and_then(Value::as_array_mut) {
            for (index, item) in items.iter_mut().enumerate() {
                if let Some(map) = item.as_object_mut() {
                    map.insert("index".to_string(), json!(index + 1));
                }
            }
            Some(items.len())
        } else {
            None
        };

    if let Some(map) = manifest.as_object_mut() {
        if let Some(count) = next_image_count {
            map.insert("imageCount".to_string(), json!(count));
        }
        let removed_log = map
            .entry("removedItems".to_string())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(list) = removed_log.as_array_mut() {
            list.push(removed_item);
        }
    }

    let serialized = serde_json::to_string_pretty(&manifest)
        .map_err(|err| format!("Gagal menyiapkan prepared manifest: {err}"))?;
    fs::write(&manifest_path, serialized).map_err(|err| {
        format!(
            "Gagal menyimpan prepared manifest {}: {err}",
            manifest_path.display()
        )
    })?;

    Ok(manifest)
}

#[tauri::command]
fn stop_scan(app: AppHandle, state: State<'_, ScanState>) -> Result<(), String> {
    let in_progress = state
        .in_progress
        .lock()
        .map_err(|_| "Gagal membaca status scan.".to_string())
        .map(|value| *value)?;
    if !in_progress {
        return Err("Tidak ada proses scan yang sedang berjalan.".to_string());
    }

    {
        let mut requested = state
            .cancel_requested
            .lock()
            .map_err(|_| "Gagal mengunci status stop scan.".to_string())?;
        *requested = true;
    }

    let _ = app.emit(
        "scan-event",
        json!({
            "event": "scan_cancel_requested",
            "message": "Permintaan stop scan dikirim. Worker OCR sedang dihentikan."
        }),
    );

    terminate_active_child(&state.active_child)?;
    Ok(())
}

#[tauri::command]
fn open_path_location(path: String) -> Result<(), String> {
    let raw_path = path.trim();
    if raw_path.is_empty() {
        return Err("Lokasi file belum tersedia.".to_string());
    }

    let candidate = PathBuf::from(raw_path);
    let metadata = fs::metadata(&candidate).ok();
    let folder = if metadata
        .as_ref()
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        candidate.clone()
    } else {
        candidate
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "Folder lokasi file tidak ditemukan.".to_string())?
    };

    if !folder.is_dir() {
        return Err(format!(
            "Folder lokasi file tidak ditemukan: {}",
            folder.display()
        ));
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer.exe");
        if metadata
            .as_ref()
            .map(|metadata| metadata.is_file())
            .unwrap_or(false)
        {
            command.arg(format!("/select,{}", candidate.to_string_lossy()));
        } else {
            command.arg(&folder);
        }
        command.creation_flags(0x08000000);
        command
            .spawn()
            .map_err(|err| format!("Gagal membuka Explorer: {err}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        if metadata
            .as_ref()
            .map(|metadata| metadata.is_file())
            .unwrap_or(false)
        {
            command.arg("-R").arg(&candidate);
        } else {
            command.arg(&folder);
        }
        command
            .spawn()
            .map_err(|err| format!("Gagal membuka Finder: {err}"))?;
        return Ok(());
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&folder)
            .spawn()
            .map_err(|err| format!("Gagal membuka file manager: {err}"))?;
        Ok(())
    }
}

#[tauri::command]
fn load_manifest(manifest_path: String) -> Result<Value, String> {
    let path = PathBuf::from(manifest_path);
    let content = fs::read_to_string(&path)
        .map_err(|err| format!("Gagal membaca manifest {}: {err}", path.display()))?;
    serde_json::from_str(&content).map_err(|err| format!("Manifest tidak valid: {err}"))
}

#[tauri::command]
fn save_manifest(manifest_path: String, manifest_data: Value) -> Result<(), String> {
    let path = PathBuf::from(manifest_path.trim());
    if path.as_os_str().is_empty() || !is_manifest_file(&path) {
        return Err("Lokasi manifest tidak valid.".to_string());
    }

    manifest_data
        .get("members")
        .and_then(Value::as_array)
        .ok_or_else(|| "Manifest tidak memiliki daftar members.".to_string())?;

    let serialized = serde_json::to_string_pretty(&manifest_data)
        .map_err(|err| format!("Gagal menyiapkan manifest untuk disimpan: {err}"))?;
    fs::write(&path, serialized)
        .map_err(|err| format!("Gagal menyimpan manifest {}: {err}", path.display()))?;
    Ok(())
}

#[tauri::command]
fn find_manifest_path(base_path: String) -> Result<Option<String>, String> {
    let base_path = PathBuf::from(base_path.trim());
    if base_path.as_os_str().is_empty() {
        return Ok(None);
    }

    if base_path.is_file() && is_manifest_file(&base_path) {
        return Ok(Some(base_path.to_string_lossy().to_string()));
    }

    if !base_path.is_dir() {
        return Ok(None);
    }

    let direct_manifest = base_path.join("manifest.json");
    if direct_manifest.is_file() {
        return Ok(Some(direct_manifest.to_string_lossy().to_string()));
    }

    let mut best_candidate: Option<(usize, PathBuf, std::time::SystemTime)> = None;
    let mut stack: Vec<(PathBuf, usize)> = vec![(base_path, 0)];
    let max_depth = 6usize;

    while let Some((current_dir, depth)) = stack.pop() {
        if depth > max_depth {
            continue;
        }

        let entries = match fs::read_dir(&current_dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if depth < max_depth && !should_skip_manifest_search_dir(&path) {
                    stack.push((path, depth + 1));
                }
                continue;
            }

            if !path.is_file() || !is_manifest_file(&path) {
                continue;
            }

            let modified = entry
                .metadata()
                .and_then(|meta| meta.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            match &best_candidate {
                None => {
                    best_candidate = Some((depth, path, modified));
                }
                Some((best_depth, _best_path, best_modified))
                    if depth < *best_depth
                        || (depth == *best_depth && modified > *best_modified) =>
                {
                    best_candidate = Some((depth, path, modified));
                }
                _ => {}
            }
        }
    }

    Ok(best_candidate.map(|(_, path, _)| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn resolve_passport_image_path(
    manifest_path: String,
    image_path: String,
    file_name: String,
) -> Result<Option<String>, String> {
    for candidate in passport_image_candidates(&manifest_path, &image_path, &file_name) {
        if !is_supported_image_file(&candidate) {
            continue;
        }
        let resolved = fs::canonicalize(&candidate).unwrap_or(candidate);
        return Ok(Some(path_to_display_string(&resolved)));
    }

    Ok(None)
}

#[tauri::command]
fn load_passport_image_data(
    manifest_path: String,
    image_path: String,
    file_name: String,
) -> Result<Option<PassportImageData>, String> {
    for candidate in passport_image_candidates(&manifest_path, &image_path, &file_name) {
        if !is_supported_image_file(&candidate) {
            continue;
        }

        let bytes = fs::read(&candidate).map_err(|err| {
            format!(
                "Gagal membaca gambar passport {}: {err}",
                candidate.display()
            )
        })?;
        let mime_type = image_mime_type(&candidate).ok_or_else(|| {
            format!(
                "Tipe gambar passport tidak didukung: {}",
                candidate.display()
            )
        })?;
        let resolved = fs::canonicalize(&candidate).unwrap_or(candidate);
        let encoded = general_purpose::STANDARD.encode(bytes);

        return Ok(Some(PassportImageData {
            path: path_to_display_string(&resolved),
            data_url: format!("data:{mime_type};base64,{encoded}"),
        }));
    }

    Ok(None)
}

#[tauri::command]
fn save_cropped_passport_image(
    manifest_path: String,
    member_id: String,
    file_name: String,
    source_image_path: String,
    data_url: String,
    crop: Value,
) -> Result<SavedPassportCrop, String> {
    let manifest = PathBuf::from(manifest_path.trim());
    if manifest.as_os_str().is_empty() || !is_manifest_file(&manifest) {
        return Err("Lokasi manifest tidak valid.".to_string());
    }
    let output_dir = manifest
        .parent()
        .ok_or_else(|| "Lokasi output crop tidak valid.".to_string())?
        .join("nusuk-crops");
    fs::create_dir_all(&output_dir)
        .map_err(|err| format!("Gagal membuat folder crop {}: {err}", output_dir.display()))?;

    let bytes = decode_image_data_url(&data_url)?;
    let base_name = crop_file_base_name(&member_id, &file_name, &source_image_path);
    let output_path = output_dir.join(format!("{base_name}.jpg"));
    fs::write(&output_path, bytes)
        .map_err(|err| format!("Gagal menyimpan crop {}: {err}", output_path.display()))?;

    let resolved = fs::canonicalize(&output_path).unwrap_or(output_path);
    let relative_path =
        repo_relative_path(&resolved).unwrap_or_else(|| path_to_display_string(&resolved));
    log_diagnostic(format!(
        "Saved cropped passport image for member {} with crop metadata {}",
        member_id.trim(),
        crop
    ));
    Ok(SavedPassportCrop {
        path: path_to_display_string(&resolved),
        relative_path,
    })
}

fn decode_image_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let trimmed = data_url.trim();
    let (meta, payload) = trimmed
        .split_once(',')
        .ok_or_else(|| "Payload crop tidak valid.".to_string())?;
    let normalized_meta = meta.to_ascii_lowercase();
    if !normalized_meta.starts_with("data:image/") || !normalized_meta.contains(";base64") {
        return Err("Payload crop harus berupa data URL gambar base64.".to_string());
    }
    if !(normalized_meta.contains("image/jpeg") || normalized_meta.contains("image/jpg")) {
        return Err("Hasil crop harus berformat JPEG.".to_string());
    }
    let bytes = general_purpose::STANDARD
        .decode(payload)
        .map_err(|err| format!("Payload crop tidak bisa dibaca: {err}"))?;
    if bytes.is_empty() {
        return Err("Hasil crop kosong.".to_string());
    }
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("Hasil crop terlalu besar.".to_string());
    }
    Ok(bytes)
}

fn crop_file_base_name(member_id: &str, file_name: &str, source_image_path: &str) -> String {
    let source_stem = Path::new(file_name.trim())
        .file_stem()
        .or_else(|| Path::new(source_image_path.trim()).file_stem())
        .and_then(|value| value.to_str())
        .unwrap_or("passport");
    let member_suffix = sanitize_file_segment(member_id)
        .chars()
        .take(8)
        .collect::<String>();
    let stem = sanitize_file_segment(source_stem);
    if member_suffix.is_empty() {
        format!("{stem}-crop")
    } else {
        format!("{stem}-{member_suffix}-crop")
    }
}

fn move_removed_prepared_files(
    manifest_path: &Path,
    item: &Value,
    item_id: &str,
    target_dir_name: &str,
) -> Result<(), String> {
    let prepared_dir = manifest_path
        .parent()
        .ok_or_else(|| "Lokasi prepared manifest tidak valid.".to_string())?;
    let removed_dir = prepared_dir.join(target_dir_name);
    fs::create_dir_all(&removed_dir).map_err(|err| {
        format!(
            "Gagal membuat folder {} {}: {err}",
            target_dir_name,
            removed_dir.display()
        )
    })?;

    let source_type = item
        .get("sourceType")
        .and_then(Value::as_str)
        .unwrap_or("image")
        .to_ascii_lowercase();
    let mut candidates = Vec::new();
    if let Some(path) = item.get("editedPath").and_then(Value::as_str) {
        candidates.push(path.to_string());
    }
    if let Some(path) = item.get("scanPath").and_then(Value::as_str) {
        candidates.push(path.to_string());
    }
    if source_type == "image" {
        if let Some(path) = item.get("sourcePath").and_then(Value::as_str) {
            candidates.push(path.to_string());
        }
    }

    let mut seen = HashSet::new();
    for candidate in candidates {
        let source_path = PathBuf::from(candidate.trim());
        if source_path.as_os_str().is_empty() || !source_path.is_file() {
            continue;
        }
        let key = source_path.to_string_lossy().to_ascii_lowercase();
        if !seen.insert(key) {
            continue;
        }
        move_file_to_removed_dir(&source_path, &removed_dir, item_id)?;
    }

    Ok(())
}

fn move_file_to_removed_dir(
    source_path: &Path,
    removed_dir: &Path,
    item_id: &str,
) -> Result<(), String> {
    let file_name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("passport.jpg");
    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("passport");
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    let safe_item = sanitize_file_segment(item_id);
    let safe_stem = sanitize_file_segment(stem);
    let mut target_path = removed_dir.join(format!("{safe_item}-{safe_stem}{extension}"));
    let mut counter = 2;
    while target_path.exists() {
        target_path = removed_dir.join(format!("{safe_item}-{safe_stem}-{counter}{extension}"));
        counter += 1;
    }

    fs::rename(source_path, &target_path)
        .or_else(|rename_err| {
            fs::copy(source_path, &target_path)
                .and_then(|_| fs::remove_file(source_path))
                .map_err(|copy_err| {
                    std::io::Error::new(
                        copy_err.kind(),
                        format!("rename: {rename_err}; copy/remove: {copy_err}"),
                    )
                })
        })
        .map_err(|err| {
            format!(
                "Gagal memindahkan foto {} ke folder tujuan: {err}",
                file_name
            )
        })?;
    Ok(())
}

fn sanitize_file_segment(value: &str) -> String {
    let mut output = String::new();
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
            output.push(ch);
        } else if ch == ' ' || ch == '.' {
            output.push('-');
        }
        if output.len() >= 80 {
            break;
        }
    }
    let cleaned = output.trim_matches('-').to_string();
    if cleaned.is_empty() {
        "passport".to_string()
    } else {
        cleaned
    }
}

fn repo_relative_path(path: &Path) -> Option<String> {
    let worker_paths = locate_worker_paths().ok()?;
    let relative = path.strip_prefix(worker_paths.repo_root).ok()?;
    Some(relative.to_string_lossy().replace('\\', "/"))
}

fn path_to_display_string(path: &Path) -> String {
    strip_windows_extended_prefix(&path.to_string_lossy())
}

fn strip_windows_extended_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    path.to_string()
}

fn passport_image_candidates(
    manifest_path: &str,
    image_path: &str,
    file_name: &str,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    let manifest = PathBuf::from(manifest_path.trim());
    let image = image_path.trim();
    let file_name = file_name.trim();

    let mut push_candidate = |path: PathBuf| {
        let candidate = fs::canonicalize(&path).unwrap_or(path);
        let key = candidate.to_string_lossy().to_ascii_lowercase();
        if seen.insert(key) {
            candidates.push(candidate);
        }
    };

    if !image.is_empty() {
        let image_path = PathBuf::from(image);
        if image_path.is_absolute() {
            push_candidate(image_path);
        } else {
            for ancestor in manifest.parent().map(ancestor_chain).unwrap_or_default() {
                push_candidate(ancestor.join(image));
            }
            if let Ok(worker_paths) = locate_worker_paths() {
                push_candidate(worker_paths.repo_root.join(image));
            }
            if let Ok(current_dir) = std::env::current_dir() {
                push_candidate(current_dir.join(image));
            }
        }
    }

    if !file_name.is_empty() {
        if let Some(parent) = manifest.parent() {
            push_candidate(parent.join("passports").join(file_name));
            push_candidate(parent.join("passport").join(file_name));
            push_candidate(
                parent
                    .join(".passport-assistant-pdf-images")
                    .join(file_name),
            );
            push_candidate(
                parent
                    .join(".passport-assistant-prepared")
                    .join("edited-images")
                    .join(file_name),
            );
            push_candidate(parent.join(file_name));
        }
    }

    candidates
}

fn is_supported_image_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    image_mime_type(path).is_some()
}

fn image_mime_type(path: &Path) -> Option<&'static str> {
    path.extension()
        .and_then(|value| value.to_str())
        .and_then(|value| match value.to_ascii_lowercase().as_str() {
            "jpg" | "jpeg" => Some("image/jpeg"),
            "png" => Some("image/png"),
            _ => None,
        })
}

fn should_skip_manifest_search_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    matches!(
        name,
        ".git" | ".venv" | "__pycache__" | "node_modules" | "target"
    )
}

#[tauri::command]
fn create_nusuk_batch(
    manifest_path: String,
    selected_ids: Vec<String>,
    manifest_data: Option<Value>,
) -> Result<String, String> {
    let path = PathBuf::from(&manifest_path);
    let manifest: Value = if let Some(payload) = manifest_data {
        payload
    } else {
        let content = fs::read_to_string(&path)
            .map_err(|err| format!("Gagal membaca manifest {}: {err}", path.display()))?;
        serde_json::from_str(&content).map_err(|err| format!("Manifest tidak valid: {err}"))?
    };

    let selected_id_set: HashSet<String> = selected_ids
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();

    let members = manifest
        .get("members")
        .and_then(Value::as_array)
        .ok_or_else(|| "Manifest tidak memiliki daftar members.".to_string())?;

    let filtered_members: Vec<Value> = members
        .iter()
        .filter(|member| match member {
            Value::Object(map) => should_include_member_for_batch(map, &selected_id_set),
            _ => false,
        })
        .cloned()
        .collect();

    if filtered_members.is_empty() {
        return Err("Tidak ada passport yang siap dimasukkan ke batch Nusuk.".to_string());
    }

    let output_dir = path
        .parent()
        .ok_or_else(|| "Lokasi manifest tidak valid.".to_string())?;
    let output_path = output_dir.join("nusuk-entry-batch.json");
    let payload = json!({
        "schemaVersion": "nusuk-entry-batch-v1",
        "groupId": manifest.get("groupId").cloned().unwrap_or(Value::String(String::new())),
        "manifestPath": manifest_path,
        "generatedBy": "entrymate-by-ghaniya",
        "members": filtered_members
    });

    let serialized = serde_json::to_string_pretty(&payload)
        .map_err(|err| format!("Gagal menyiapkan batch Nusuk: {err}"))?;
    fs::write(&output_path, serialized)
        .map_err(|err| format!("Gagal menulis batch Nusuk {}: {err}", output_path.display()))?;

    Ok(output_path.to_string_lossy().to_string())
}

fn member_review_status(map: &serde_json::Map<String, Value>) -> String {
    map.get("reviewStatus")
        .or_else(|| map.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_uppercase()
}

fn should_include_member_for_batch(
    map: &serde_json::Map<String, Value>,
    selected_id_set: &HashSet<String>,
) -> bool {
    if member_review_status(map) != "VALID" {
        return false;
    }
    if !member_review_confirmed(map) {
        return false;
    }
    if selected_id_set.is_empty() {
        return true;
    }
    map.get("id")
        .and_then(Value::as_str)
        .map(|id| selected_id_set.contains(id))
        .unwrap_or(false)
}

fn member_review_confirmed(map: &serde_json::Map<String, Value>) -> bool {
    map.get("reviewConfirmed")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn run_worker_process(
    app: &AppHandle,
    worker_paths: &WorkerPaths,
    selected_dir: &str,
    ocr_mode: &str,
    prepared_manifest_path: &str,
    active_child: Arc<Mutex<Option<Child>>>,
    cancel_requested: Arc<Mutex<bool>>,
) -> Result<(), String> {
    let mut command = Command::new(&worker_paths.command_executable);
    configure_worker_tesseract_environment(&mut command, &worker_paths.repo_root);
    command
        .current_dir(&worker_paths.working_dir)
        .env("PYTHONUNBUFFERED", "1");

    if let Some(worker_script) = &worker_paths.worker_script {
        command.arg("-u").arg(worker_script);
    }

    command
        .arg(selected_dir)
        .arg(ocr_mode)
        .env("PASSPORT_OCR_PROFILE", ocr_mode);

    if !prepared_manifest_path.trim().is_empty() {
        command.arg(prepared_manifest_path.trim());
    }

    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }

    let mut child = command.spawn().map_err(|err| {
        format!(
            "Gagal menjalankan worker OCR {}: {err}",
            worker_paths.command_executable.display()
        )
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Worker Python tidak mengeluarkan stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Worker Python tidak mengeluarkan stderr.".to_string())?;
    {
        let mut active = active_child
            .lock()
            .map_err(|_| "Gagal menyimpan handle worker Python.".to_string())?;
        *active = Some(child);
    }
    if is_cancel_requested(&cancel_requested) {
        terminate_active_child(&active_child)?;
    }

    let stderr_handle = thread::spawn(move || collect_stderr(stderr));
    let mut saw_complete = false;
    let mut saw_failure = false;

    for line_result in BufReader::new(stdout).lines() {
        let line = match line_result {
            Ok(value) => value,
            Err(err) => {
                let was_cancelled = is_cancel_requested(&cancel_requested);
                let _ = terminate_active_child(&active_child);
                let _ = wait_for_active_child(&active_child);
                let stderr_output = stderr_handle
                    .join()
                    .unwrap_or_else(|_| String::from("Gagal membaca stderr worker Python."));
                if was_cancelled {
                    emit_scan_stopped(app);
                    return Ok(());
                }
                if !stderr_output.trim().is_empty() {
                    emit_scan_error(
                        app,
                        "WORKER_STDERR_STREAM_FAILURE",
                        stderr_output.trim().to_string(),
                        "worker_stdout",
                        true,
                    );
                }
                return Err(format!("Gagal membaca output worker: {err}"));
            }
        };
        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<Value>(&line) {
            Ok(payload) => {
                if payload.get("event").and_then(Value::as_str) == Some("scan_complete") {
                    saw_complete = true;
                }
                if payload.get("event").and_then(Value::as_str) == Some("scan_failed") {
                    saw_failure = true;
                }
                let _ = app.emit("scan-event", payload);
            }
            Err(_) => {
                let _ = app.emit(
                    "scan-event",
                    json!({ "event": "scan_log", "message": line }),
                );
            }
        }
    }

    let status = wait_for_active_child(&active_child)?
        .ok_or_else(|| "Worker Python tidak ditemukan saat menunggu proses selesai.".to_string())?;
    let stderr_output = stderr_handle
        .join()
        .unwrap_or_else(|_| String::from("Gagal membaca stderr worker Python."));
    let was_cancelled = is_cancel_requested(&cancel_requested);

    if was_cancelled && !saw_complete {
        emit_scan_stopped(app);
        return Ok(());
    }

    if !status.success() && !saw_failure {
        let message = if stderr_output.trim().is_empty() {
            format!("Worker Python berhenti dengan kode {:?}.", status.code())
        } else {
            stderr_output.trim().to_string()
        };
        emit_scan_error(app, "WORKER_NON_ZERO_EXIT", message, "worker_exit", true);
    }

    if status.success() && !saw_complete {
        return Err("Worker Python selesai tanpa mengirim hasil akhir scan.".to_string());
    }

    Ok(())
}

fn configure_worker_tesseract_environment(command: &mut Command, repo_root: &Path) {
    let Some(tesseract_cmd) = resolve_bundled_tesseract_cmd(repo_root) else {
        return;
    };

    command.env("TESSERACT_CMD", &tesseract_cmd);
    if let Some(tesseract_dir) = tesseract_cmd.parent() {
        prepend_command_path(command, "PATH", tesseract_dir);
        let tessdata_dir = tesseract_dir.join("tessdata");
        if tessdata_dir.is_dir() {
            command.env("TESSDATA_PREFIX", tessdata_dir);
        }
    }
}

fn resolve_bundled_tesseract_cmd(repo_root: &Path) -> Option<PathBuf> {
    let executable_name = if cfg!(target_os = "windows") {
        "tesseract.exe"
    } else {
        "tesseract"
    };

    [
        repo_root.join("tesseract").join(executable_name),
        repo_root.join("Tesseract-OCR").join(executable_name),
        repo_root
            .join("python-ocr")
            .join("tesseract")
            .join(executable_name),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

fn prepend_command_path(command: &mut Command, env_name: &str, directory: &Path) {
    if !directory.is_dir() {
        return;
    }

    let mut paths = vec![directory.to_path_buf()];
    if let Some(current_path) = std::env::var_os(env_name) {
        paths.extend(std::env::split_paths(&current_path));
    }

    if let Ok(joined_path) = std::env::join_paths(paths) {
        command.env(env_name, joined_path);
    }
}

fn terminate_active_child(active_child: &Arc<Mutex<Option<Child>>>) -> Result<(), String> {
    let mut guard = active_child
        .lock()
        .map_err(|_| "Gagal mengunci proses worker Python.".to_string())?;
    if let Some(child) = guard.as_mut() {
        terminate_child(child)?;
    }
    Ok(())
}

fn wait_for_active_child(
    active_child: &Arc<Mutex<Option<Child>>>,
) -> Result<Option<ExitStatus>, String> {
    let mut child = {
        let mut guard = active_child
            .lock()
            .map_err(|_| "Gagal mengambil proses worker Python.".to_string())?;
        guard.take()
    };
    match child.as_mut() {
        Some(child) => child
            .wait()
            .map(Some)
            .map_err(|err| format!("Gagal menunggu worker Python selesai: {err}")),
        None => Ok(None),
    }
}

fn terminate_child(child: &mut Child) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|err| format!("Gagal memeriksa status worker Python: {err}"))?
        .is_some()
    {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("taskkill");
        command
            .arg("/PID")
            .arg(child.id().to_string())
            .arg("/T")
            .arg("/F")
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command.creation_flags(0x08000000);
        if command
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
        {
            return Ok(());
        }
    }

    match child.kill() {
        Ok(()) => Ok(()),
        Err(err) => {
            if child
                .try_wait()
                .map_err(|wait_err| {
                    format!("Gagal memeriksa ulang status worker Python: {wait_err}")
                })?
                .is_some()
            {
                return Ok(());
            }
            Err(format!("Gagal menghentikan worker Python: {err}"))
        }
    }
}

fn is_cancel_requested(cancel_requested: &Arc<Mutex<bool>>) -> bool {
    cancel_requested.lock().map(|value| *value).unwrap_or(false)
}

fn normalize_ocr_mode(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    let profile = match normalized.as_str() {
        "" => "speed",
        "speed" => "speed",
        "balanced" => "balanced",
        "heavy" | "accuracy" => "heavy",
        _ => {
            return Err(format!(
                "Mode OCR tidak dikenal: {value}. Pilih speed, balanced, atau heavy."
            ))
        }
    };
    Ok(profile.to_string())
}

fn collect_stderr(stderr: impl std::io::Read) -> String {
    let reader = BufReader::new(stderr);
    reader
        .lines()
        .filter_map(Result::ok)
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_manifest_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("manifest.json"))
        .unwrap_or(false)
}

fn resolve_prepared_manifest_path(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path.trim());
    if candidate.as_os_str().is_empty() {
        return Err("Lokasi prepared manifest tidak valid.".to_string())
    }
    let manifest_path = if candidate.is_dir() {
        candidate
            .join(".passport-assistant-prepared")
            .join("prepared-inputs.json")
    } else {
        candidate
    };
    if !manifest_path.is_file() {
        return Err(format!(
            "Prepared manifest tidak ditemukan: {}",
            manifest_path.display()
        ));
    }
    Ok(manifest_path)
}

fn locate_worker_paths() -> Result<WorkerPaths, String> {
    let mut candidates = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.extend(ancestor_chain(&current_dir));
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.extend(ancestor_chain(exe_dir));
        }
    }

    let mut visited = HashSet::new();
    for candidate in candidates {
        let normalized = candidate.to_string_lossy().to_string();
        if !visited.insert(normalized) {
            continue;
        }

        if let Some(worker_executable) = resolve_worker_executable(&candidate) {
            return Ok(WorkerPaths {
                repo_root: candidate.clone(),
                command_executable: worker_executable.clone(),
                worker_script: None,
                working_dir: worker_executable
                    .parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| candidate.clone()),
            });
        }

        let python_root = candidate.join("python-ocr");
        let worker_script = python_root.join("scan_worker.py");
        let windows_python = python_root.join(".venv").join("Scripts").join("python.exe");
        let unix_python = python_root.join(".venv").join("bin").join("python");

        let python_executable = if windows_python.is_file() {
            windows_python
        } else if unix_python.is_file() {
            unix_python
        } else {
            continue;
        };

        if worker_script.is_file() {
            return Ok(WorkerPaths {
                repo_root: candidate,
                command_executable: python_executable,
                worker_script: Some(worker_script),
                working_dir: python_root,
            });
        }
    }

    Err("Worker OCR tidak ditemukan. Paket release harus membawa python-ocr-dist/scan_worker.exe, atau development repo harus memiliki python-ocr/.venv.".to_string())
}

fn resolve_worker_executable(repo_root: &Path) -> Option<PathBuf> {
    let executable_name = if cfg!(target_os = "windows") {
        "scan_worker.exe"
    } else {
        "scan_worker"
    };

    [
        repo_root.join("python-ocr-dist").join(executable_name),
        repo_root
            .join("python-ocr-dist")
            .join("scan_worker")
            .join(executable_name),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

fn ancestor_chain(path: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut current = Some(path);
    while let Some(value) = current {
        paths.push(value.to_path_buf());
        current = value.parent();
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Map;

    #[test]
    fn member_review_status_prefers_review_status() {
        let mut member = Map::new();
        member.insert("status".to_string(), Value::String("VALID".to_string()));
        member.insert(
            "reviewStatus".to_string(),
            Value::String("NEEDS_REVIEW".to_string()),
        );

        assert_eq!(member_review_status(&member), "NEEDS_REVIEW");
    }

    #[test]
    fn member_review_status_falls_back_to_legacy_status() {
        let mut member = Map::new();
        member.insert("status".to_string(), Value::String("VALID".to_string()));

        assert_eq!(member_review_status(&member), "VALID");
    }

    #[test]
    fn normalize_ocr_mode_accepts_desktop_modes() {
        assert_eq!(normalize_ocr_mode("").unwrap(), "speed");
        assert_eq!(normalize_ocr_mode("speed").unwrap(), "speed");
        assert_eq!(normalize_ocr_mode("balanced").unwrap(), "balanced");
        assert_eq!(normalize_ocr_mode("heavy").unwrap(), "heavy");
        assert_eq!(normalize_ocr_mode("accuracy").unwrap(), "heavy");
        assert!(normalize_ocr_mode("unknown").is_err());
    }

    #[test]
    fn passport_image_candidates_include_generated_image_dirs() {
        let parent = std::env::temp_dir().join("entrymate-candidate-test");
        let manifest = parent.join("manifest.json");
        let candidates =
            passport_image_candidates(&manifest.to_string_lossy(), "", "passport-page.jpg");

        assert!(candidates.contains(
            &parent
                .join(".passport-assistant-pdf-images")
                .join("passport-page.jpg")
        ));
        assert!(candidates.contains(
            &parent
                .join(".passport-assistant-prepared")
                .join("edited-images")
                .join("passport-page.jpg")
        ));
    }

    #[test]
    fn batch_filter_requires_valid_status_even_when_selected() {
        let selected_ids = HashSet::from(["ready".to_string(), "error".to_string()]);
        let mut ready_member = Map::new();
        ready_member.insert("id".to_string(), Value::String("ready".to_string()));
        ready_member.insert(
            "reviewStatus".to_string(),
            Value::String("VALID".to_string()),
        );
        ready_member.insert("reviewConfirmed".to_string(), Value::Bool(true));
        let mut error_member = Map::new();
        error_member.insert("id".to_string(), Value::String("error".to_string()));
        error_member.insert(
            "reviewStatus".to_string(),
            Value::String("ERROR".to_string()),
        );
        error_member.insert("reviewConfirmed".to_string(), Value::Bool(true));

        assert!(should_include_member_for_batch(
            &ready_member,
            &selected_ids
        ));
        assert!(!should_include_member_for_batch(
            &error_member,
            &selected_ids
        ));
    }

    #[test]
    fn batch_filter_defaults_to_all_valid_members_when_none_selected() {
        let selected_ids = HashSet::new();
        let mut ready_member = Map::new();
        ready_member.insert(
            "reviewStatus".to_string(),
            Value::String("VALID".to_string()),
        );
        ready_member.insert("reviewConfirmed".to_string(), Value::Bool(true));
        let mut review_member = Map::new();
        review_member.insert(
            "reviewStatus".to_string(),
            Value::String("NEEDS_REVIEW".to_string()),
        );
        review_member.insert("reviewConfirmed".to_string(), Value::Bool(true));

        assert!(should_include_member_for_batch(
            &ready_member,
            &selected_ids
        ));
        assert!(!should_include_member_for_batch(
            &review_member,
            &selected_ids
        ));
    }

    #[test]
    fn batch_filter_requires_review_confirmation() {
        let selected_ids = HashSet::new();
        let mut ready_member = Map::new();
        ready_member.insert(
            "reviewStatus".to_string(),
            Value::String("VALID".to_string()),
        );

        assert!(!should_include_member_for_batch(
            &ready_member,
            &selected_ids
        ));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_webview2_runtime();

    let renderer_health = RendererHealth::default();
    let renderer_health_for_setup = renderer_health.clone();
    let renderer_health_for_window_events = renderer_health.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ScanState::default())
        .manage(renderer_health)
        .setup(move |app| {
            log_diagnostic("tauri setup complete");
            start_renderer_watchdog(app.handle().clone(), renderer_health_for_setup.clone());
            Ok(())
        })
        .on_page_load(|webview, payload| {
            log_diagnostic(format!(
                "page load {:?} label={} url={}",
                payload.event(),
                webview.label(),
                payload.url()
            ));
        })
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::Focused(focused) = event {
                if let Ok(mut window_focused) =
                    renderer_health_for_window_events.window_focused.lock()
                {
                    *window_focused = *focused;
                }
            }
            log_diagnostic(format!(
                "window event label={} event={event:?}",
                window.label()
            ));
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            renderer_heartbeat,
            window_minimize,
            window_start_dragging,
            window_toggle_maximize,
            window_close,
            prepare_passport_images,
            start_scan,
            stop_scan,
            open_path_location,
            load_manifest,
            save_manifest,
            find_manifest_path,
            resolve_passport_image_path,
            load_passport_image_data,
            save_cropped_passport_image,
            save_prepared_passport_image,
            remove_prepared_passport_image,
            endorse_prepared_passport_image,
            create_nusuk_batch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
