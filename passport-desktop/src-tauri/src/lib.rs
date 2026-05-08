use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Default)]
struct ScanState {
    in_progress: Arc<Mutex<bool>>,
    active_child: Arc<Mutex<Option<Child>>>,
    cancel_requested: Arc<Mutex<bool>>,
}

struct WorkerPaths {
    repo_root: PathBuf,
    python_executable: PathBuf,
    worker_script: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PassportImageData {
    path: String,
    data_url: String,
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
) -> Result<(), String> {
    let selected_dir = selected_dir.trim().to_string();
    if selected_dir.is_empty() {
        return Err("Folder passport belum dipilih.".to_string());
    }

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
        return Ok(Some(resolved.to_string_lossy().to_string()));
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
            path: resolved.to_string_lossy().to_string(),
            data_url: format!("data:{mime_type};base64,{encoded}"),
        }));
    }

    Ok(None)
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
        let key = path.to_string_lossy().to_ascii_lowercase();
        if seen.insert(key) {
            candidates.push(path);
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
        }
    }

    if !file_name.is_empty() {
        if let Some(parent) = manifest.parent() {
            push_candidate(parent.join("passports").join(file_name));
            push_candidate(parent.join("passport").join(file_name));
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
        "generatedBy": "passport-desktop",
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
    active_child: Arc<Mutex<Option<Child>>>,
    cancel_requested: Arc<Mutex<bool>>,
) -> Result<(), String> {
    let mut command = Command::new(&worker_paths.python_executable);
    command
        .current_dir(worker_paths.repo_root.join("python-ocr"))
        .arg("-u")
        .arg(&worker_paths.worker_script)
        .arg(selected_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }

    let mut child = command.spawn().map_err(|err| {
        format!(
            "Gagal menjalankan worker Python {}: {err}",
            worker_paths.python_executable.display()
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
                python_executable,
                worker_script,
            });
        }
    }

    Err("Folder python-ocr atau virtualenv Python tidak ditemukan. Pastikan repo ini lengkap dan venv OCR sudah siap.".to_string())
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
    tauri::Builder::default()
        .manage(ScanState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_scan,
            stop_scan,
            load_manifest,
            save_manifest,
            find_manifest_path,
            resolve_passport_image_path,
            load_passport_image_data,
            create_nusuk_batch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
