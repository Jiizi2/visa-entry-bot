use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Default)]
struct ScanState {
    in_progress: Arc<Mutex<bool>>,
}

#[derive(Default)]
struct NusukAutomationState {
    active_pid: Arc<Mutex<Option<u32>>>,
}

struct WorkerPaths {
    repo_root: PathBuf,
    python_executable: PathBuf,
    worker_script: PathBuf,
}

const MAX_CAPTURED_LOG_LINES: usize = 250;
const EXT_BRIDGE_MAX_EVENTS: usize = 400;
const EXT_BRIDGE_DEFAULT_PORT: u16 = 17340;
const CONTRACT_BRIDGE_DIR_NAME: &str = "bridge-contract";

#[derive(Clone)]
struct BridgeCommand {
    id: u64,
    created_at_ms: u128,
    command: String,
    payload: Value,
    target_client_id: Option<String>,
}

struct ExtensionBridgeData {
    running: bool,
    port: u16,
    next_command_id: u64,
    pending_commands: VecDeque<BridgeCommand>,
    events: VecDeque<Value>,
    known_clients: HashMap<String, u128>,
}

impl Default for ExtensionBridgeData {
    fn default() -> Self {
        Self {
            running: false,
            port: EXT_BRIDGE_DEFAULT_PORT,
            next_command_id: 1,
            pending_commands: VecDeque::new(),
            events: VecDeque::new(),
            known_clients: HashMap::new(),
        }
    }
}

#[derive(Default)]
struct ExtensionBridgeState {
    inner: Arc<Mutex<ExtensionBridgeData>>,
}

fn emit_scan_error(
    app: &AppHandle,
    code: &str,
    message: String,
    stage: &str,
    fatal: bool,
) {
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

#[tauri::command]
async fn run_nusuk_automation(
    app: AppHandle,
    automation_state: State<'_, NusukAutomationState>,
    batch_path: String,
    nusuk_url: String,
) -> Result<String, String> {
    {
        let guard = automation_state
            .active_pid
            .lock()
            .map_err(|_| "State automation sedang terkunci.".to_string())?;
        if guard.is_some() {
            return Err("Automation Nusuk sedang berjalan. Hentikan proses aktif terlebih dahulu.".to_string());
        }
    }

    let active_pid = automation_state.active_pid.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_nusuk_automation_sync(app, active_pid, batch_path, nusuk_url)
    })
    .await
    .map_err(|err| format!("Task automation Nusuk gagal dijalankan: {err}"))?
}

fn run_nusuk_automation_sync(
    app: AppHandle,
    active_pid_state: Arc<Mutex<Option<u32>>>,
    batch_path: String,
    nusuk_url: String,
) -> Result<String, String> {
    let batch = PathBuf::from(batch_path.trim());
    if !batch.is_file() {
        return Err(format!(
            "File batch Nusuk tidak ditemukan: {}",
            batch.display()
        ));
    }

    let url = nusuk_url.trim();
    if url.is_empty() {
        return Err("URL Nusuk kosong. Isi URL terlebih dahulu.".to_string());
    }

    let repo_root = locate_repo_root()?;
    let desktop_root = repo_root.join("passport-desktop");
    let script_path = desktop_root.join("scripts").join("nusuk-click-automation.mjs");
    if !script_path.is_file() {
        return Err(format!(
            "Script automation Nusuk tidak ditemukan: {}",
            script_path.display()
        ));
    }

    let node_executable = locate_node_executable()?;
    let mut command = Command::new(&node_executable);
    command
        .current_dir(&desktop_root)
        .arg(&script_path)
        .arg("--batch")
        .arg(&batch)
        .arg("--url")
        .arg(url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }

    let mut child = command.spawn().map_err(|err| {
        format!(
            "Gagal menjalankan automation JS (node). Path node: {}. Detail: {err}",
            node_executable.display()
        )
    })?;
    let child_pid = child.id();
    if let Ok(mut guard) = active_pid_state.lock() {
        *guard = Some(child_pid);
    }

    let stdout = match child.stdout.take() {
        Some(value) => value,
        None => {
            if let Ok(mut guard) = active_pid_state.lock() {
                *guard = None;
            }
            return Err("Automation JS tidak mengeluarkan stdout.".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(value) => value,
        None => {
            if let Ok(mut guard) = active_pid_state.lock() {
                *guard = None;
            }
            return Err("Automation JS tidak mengeluarkan stderr.".to_string());
        }
    };

    let app_for_stdout = app.clone();
    let stdout_handle = thread::spawn(move || collect_automation_stream(stdout, &app_for_stdout, "info"));
    let app_for_stderr = app.clone();
    let stderr_handle = thread::spawn(move || collect_automation_stream(stderr, &app_for_stderr, "error"));

    let status = match child.wait() {
        Ok(value) => value,
        Err(err) => {
            if let Ok(mut guard) = active_pid_state.lock() {
                *guard = None;
            }
            return Err(format!("Gagal menunggu automation JS selesai: {err}"));
        }
    };

    let stdout_lines = stdout_handle.join().unwrap_or_default();
    let stderr_lines = stderr_handle.join().unwrap_or_default();
    let stdout_text = stdout_lines.join("\n").trim().to_string();
    let stderr_text = stderr_lines.join("\n").trim().to_string();
    let detail = if stdout_text.is_empty() && stderr_text.is_empty() {
        "Tidak ada log dari script automation.".to_string()
    } else if stdout_text.is_empty() {
        stderr_text
    } else if stderr_text.is_empty() {
        stdout_text
    } else {
        format!("{stdout_text}\n{stderr_text}")
    };

    if status.success() {
        if let Ok(mut guard) = active_pid_state.lock() {
            *guard = None;
        }
        Ok(detail)
    } else {
        if let Ok(mut guard) = active_pid_state.lock() {
            *guard = None;
        }
        Err(format!("Automation Nusuk gagal. {detail}"))
    }
}

#[tauri::command]
fn terminate_nusuk_automation(
    app: AppHandle,
    automation_state: State<'_, NusukAutomationState>,
) -> Result<String, String> {
    let pid = {
        let guard = automation_state
            .active_pid
            .lock()
            .map_err(|_| "State automation sedang terkunci.".to_string())?;
        *guard
    };

    let Some(pid) = pid else {
        return Ok("Tidak ada proses Auto Entry yang sedang berjalan.".to_string());
    };

    #[cfg(target_os = "windows")]
    let kill_status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|err| format!("Gagal menjalankan taskkill: {err}"))?;

    #[cfg(not(target_os = "windows"))]
    let kill_status = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|err| format!("Gagal menghentikan process: {err}"))?;

    if !kill_status.success() {
        return Err(format!("Terminate process gagal untuk PID {pid}."));
    }

    if let Ok(mut guard) = automation_state.active_pid.lock() {
        *guard = None;
    }

    let message = format!("Proses Auto Entry dihentikan (PID {pid}).");
    let _ = app.emit(
        "entry-event",
        json!({ "event": "entry_log", "level": "warn", "message": message }),
    );
    Ok(message)
}

fn collect_automation_stream(
    reader: impl std::io::Read,
    app: &AppHandle,
    level: &str,
) -> Vec<String> {
    let mut lines: VecDeque<String> = VecDeque::with_capacity(MAX_CAPTURED_LOG_LINES);
    for line in BufReader::new(reader).lines().map_while(Result::ok) {
        let trimmed = line.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        let _ = app.emit(
            "entry-event",
            json!({ "event": "entry_log", "level": level, "message": trimmed }),
        );
        lines.push_back(trimmed);
        if lines.len() > MAX_CAPTURED_LOG_LINES {
            let _ = lines.pop_front();
        }
    }
    lines.into_iter().collect()
}

fn resolve_contract_bridge_dir() -> Result<PathBuf, String> {
    let repo_root = locate_repo_root()?;
    Ok(repo_root.join("passport-desktop").join(CONTRACT_BRIDGE_DIR_NAME))
}

fn ensure_contract_bridge_dirs(base_dir: &Path) -> Result<(), String> {
    for dir in [
        base_dir.to_path_buf(),
        base_dir.join("commands"),
        base_dir.join("events"),
        base_dir.join("events-processed"),
    ] {
        fs::create_dir_all(&dir)
            .map_err(|err| format!("Gagal membuat folder bridge {}: {err}", dir.display()))?;
    }
    Ok(())
}

fn atomic_write_json(path: &Path, payload: &Value) -> Result<(), String> {
    let tmp_path = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(payload)
        .map_err(|err| format!("Gagal serialize JSON {}: {err}", path.display()))?;
    fs::write(&tmp_path, format!("{content}\n"))
        .map_err(|err| format!("Gagal menulis file sementara {}: {err}", tmp_path.display()))?;
    fs::rename(&tmp_path, path)
        .map_err(|err| format!("Gagal rename file sementara ke {}: {err}", path.display()))?;
    Ok(())
}

fn sorted_json_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("json"))
                    .unwrap_or(false)
        })
        .collect();
    files.sort();
    files
}

#[tauri::command]
fn contract_bridge_init() -> Result<Value, String> {
    let base_dir = resolve_contract_bridge_dir()?;
    ensure_contract_bridge_dirs(&base_dir)?;
    Ok(json!({
        "ok": true,
        "baseDir": base_dir.to_string_lossy().to_string(),
        "commandsDir": base_dir.join("commands").to_string_lossy().to_string(),
        "eventsDir": base_dir.join("events").to_string_lossy().to_string()
    }))
}

#[tauri::command]
fn contract_bridge_status() -> Result<Value, String> {
    let base_dir = resolve_contract_bridge_dir()?;
    ensure_contract_bridge_dirs(&base_dir)?;
    let commands_count = sorted_json_files(&base_dir.join("commands")).len();
    let events_count = sorted_json_files(&base_dir.join("events")).len();
    Ok(json!({
        "ok": true,
        "baseDir": base_dir.to_string_lossy().to_string(),
        "commandsPending": commands_count,
        "eventsPending": events_count
    }))
}

#[tauri::command]
fn contract_bridge_queue_command(
    command_type: String,
    payload: Option<Value>,
    target_client_id: Option<String>,
) -> Result<Value, String> {
    let command_type = command_type.trim().to_string();
    if command_type.is_empty() {
        return Err("command_type tidak boleh kosong.".to_string());
    }
    let base_dir = resolve_contract_bridge_dir()?;
    ensure_contract_bridge_dirs(&base_dir)?;
    let id = format!("cmd-{}-{}", unix_time_ms(), std::process::id());
    let file_path = base_dir.join("commands").join(format!("{id}.json"));
    let command = json!({
        "version": "1.0",
        "id": id,
        "type": command_type,
        "createdAtMs": unix_time_ms(),
        "payload": payload.unwrap_or_else(|| json!({})),
        "targetClientId": target_client_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        "status": "pending"
    });
    atomic_write_json(&file_path, &command)?;
    Ok(json!({
        "ok": true,
        "id": command.get("id").cloned().unwrap_or(Value::Null),
        "path": file_path.to_string_lossy().to_string()
    }))
}

#[tauri::command]
fn contract_bridge_get_events(limit: Option<usize>, consume: Option<bool>) -> Result<Vec<Value>, String> {
    let base_dir = resolve_contract_bridge_dir()?;
    ensure_contract_bridge_dirs(&base_dir)?;
    let events_dir = base_dir.join("events");
    let processed_dir = base_dir.join("events-processed");
    let consume_files = consume.unwrap_or(false);
    let max_items = limit.unwrap_or(50).clamp(1, 500);
    let files = sorted_json_files(&events_dir);
    let start = files.len().saturating_sub(max_items);
    let selected = &files[start..];
    let mut out = Vec::new();

    for file_path in selected {
        let raw = match fs::read_to_string(file_path) {
            Ok(text) => text,
            Err(_) => continue,
        };
        let parsed: Value = match serde_json::from_str(&raw) {
            Ok(value) => value,
            Err(_) => continue,
        };
        out.push(parsed);
        if consume_files {
            let file_name = match file_path.file_name() {
                Some(name) => name,
                None => continue,
            };
            let target = processed_dir.join(file_name);
            let _ = fs::rename(file_path, target);
        }
    }

    Ok(out)
}

fn unix_time_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis()
}

fn read_http_request(stream: &mut TcpStream) -> Result<(String, String, Vec<u8>), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|err| format!("set_read_timeout gagal: {err}"))?;

    let mut buffer = Vec::with_capacity(16 * 1024);
    let mut temp = [0_u8; 2048];
    let mut header_end: Option<usize> = None;
    while header_end.is_none() {
        let read_len = stream
            .read(&mut temp)
            .map_err(|err| format!("read stream gagal: {err}"))?;
        if read_len == 0 {
            break;
        }
        buffer.extend_from_slice(&temp[..read_len]);
        if let Some(pos) = find_subsequence(&buffer, b"\r\n\r\n") {
            header_end = Some(pos + 4);
        }
        if buffer.len() > 512 * 1024 {
            return Err("Request terlalu besar.".to_string());
        }
    }

    let header_end = header_end.ok_or_else(|| "Header HTTP tidak lengkap.".to_string())?;
    let header_text = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = header_text.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| "Request line kosong.".to_string())?
        .trim()
        .to_string();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();

    let content_length = header_text
        .lines()
        .find_map(|line| {
            let lower = line.to_ascii_lowercase();
            if !lower.starts_with("content-length:") {
                return None;
            }
            lower
                .split(':')
                .nth(1)
                .and_then(|value| value.trim().parse::<usize>().ok())
        })
        .unwrap_or(0);

    let mut body = if buffer.len() > header_end {
        buffer[header_end..].to_vec()
    } else {
        Vec::new()
    };
    while body.len() < content_length {
        let read_len = stream
            .read(&mut temp)
            .map_err(|err| format!("read body gagal: {err}"))?;
        if read_len == 0 {
            break;
        }
        body.extend_from_slice(&temp[..read_len]);
    }
    if body.len() > content_length {
        body.truncate(content_length);
    }
    Ok((method, path, body))
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|window| window == needle)
}

fn parse_query_value(path: &str, key: &str) -> Option<String> {
    let query = path.split_once('?')?.1;
    for pair in query.split('&') {
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        if raw_key == key {
            return Some(raw_value.replace('+', " "));
        }
    }
    None
}

fn http_json_response(status: &str, payload: Value) -> Vec<u8> {
    let body = serde_json::to_string(&payload).unwrap_or_else(|_| "{\"ok\":false}".to_string());
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
    .into_bytes()
}

fn register_bridge_event(
    app: &AppHandle,
    shared: &Arc<Mutex<ExtensionBridgeData>>,
    event_payload: Value,
) {
    let mut with_meta = event_payload;
    if let Value::Object(ref mut map) = with_meta {
        map.insert("receivedAtMs".to_string(), json!(unix_time_ms()));
    }
    if let Ok(mut guard) = shared.lock() {
        guard.events.push_back(with_meta.clone());
        while guard.events.len() > EXT_BRIDGE_MAX_EVENTS {
            let _ = guard.events.pop_front();
        }
    }
    let _ = app.emit("extension-bridge-event", with_meta);
}

fn handle_extension_bridge_connection(
    app: &AppHandle,
    shared: &Arc<Mutex<ExtensionBridgeData>>,
    mut stream: TcpStream,
) {
    let response_bytes = match read_http_request(&mut stream) {
        Ok((method, path, body)) => {
            if method.eq_ignore_ascii_case("OPTIONS") {
                http_json_response("200 OK", json!({ "ok": true }))
            } else if method.eq_ignore_ascii_case("GET") && path.starts_with("/health") {
                let port = shared
                    .lock()
                    .ok()
                    .map(|guard| guard.port)
                    .unwrap_or(EXT_BRIDGE_DEFAULT_PORT);
                http_json_response("200 OK", json!({ "ok": true, "port": port }))
            } else if method.eq_ignore_ascii_case("GET") && path.starts_with("/api/next-command") {
                let client_id = parse_query_value(&path, "client_id")
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                let mut next: Option<BridgeCommand> = None;
                if let Ok(mut guard) = shared.lock() {
                    if !client_id.is_empty() {
                        guard.known_clients.insert(client_id.clone(), unix_time_ms());
                    }
                    let selected_idx = guard.pending_commands.iter().position(|item| {
                        item.target_client_id
                            .as_ref()
                            .map(|target| target == &client_id)
                            .unwrap_or(true)
                    });
                    if let Some(idx) = selected_idx {
                        next = guard.pending_commands.remove(idx);
                    }
                }

                if let Some(item) = next {
                    http_json_response(
                        "200 OK",
                        json!({
                            "ok": true,
                            "command": {
                                "id": item.id,
                                "createdAtMs": item.created_at_ms,
                                "type": item.command,
                                "payload": item.payload,
                                "targetClientId": item.target_client_id,
                            }
                        }),
                    )
                } else {
                    http_json_response("200 OK", json!({ "ok": true, "command": Value::Null }))
                }
            } else if method.eq_ignore_ascii_case("POST") && path.starts_with("/api/register") {
                let payload: Value = serde_json::from_slice(&body).unwrap_or_else(|_| json!({}));
                let client_id = payload
                    .get("clientId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                if !client_id.is_empty() {
                    if let Ok(mut guard) = shared.lock() {
                        guard.known_clients.insert(client_id, unix_time_ms());
                    }
                }
                register_bridge_event(
                    app,
                    shared,
                    json!({
                        "event": "client_registered",
                        "source": "extension",
                        "payload": payload
                    }),
                );
                http_json_response("200 OK", json!({ "ok": true }))
            } else if method.eq_ignore_ascii_case("POST") && path.starts_with("/api/event") {
                let payload: Value = serde_json::from_slice(&body).unwrap_or_else(|_| json!({}));
                register_bridge_event(
                    app,
                    shared,
                    json!({
                        "event": "extension_event",
                        "source": "extension",
                        "payload": payload
                    }),
                );
                http_json_response("200 OK", json!({ "ok": true }))
            } else {
                http_json_response(
                    "404 Not Found",
                    json!({
                        "ok": false,
                        "error": "Endpoint tidak ditemukan",
                        "path": path
                    }),
                )
            }
        }
        Err(err) => http_json_response(
            "400 Bad Request",
            json!({ "ok": false, "error": err }),
        ),
    };

    let _ = stream.write_all(&response_bytes);
    let _ = stream.flush();
}

fn start_extension_bridge_thread(
    app: AppHandle,
    shared: Arc<Mutex<ExtensionBridgeData>>,
    port: u16,
) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", port))
        .map_err(|err| format!("Gagal bind extension bridge di 127.0.0.1:{port}: {err}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|err| format!("Gagal set nonblocking listener: {err}"))?;

    thread::spawn(move || {
        loop {
            let is_running = shared
                .lock()
                .ok()
                .map(|guard| guard.running)
                .unwrap_or(false);
            if !is_running {
                break;
            }

            match listener.accept() {
                Ok((stream, _addr)) => {
                    handle_extension_bridge_connection(&app, &shared, stream);
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(60));
                }
                Err(_err) => {
                    thread::sleep(Duration::from_millis(120));
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn start_extension_bridge(
    app: AppHandle,
    bridge_state: State<'_, ExtensionBridgeState>,
    port: Option<u16>,
) -> Result<Value, String> {
    let requested_port = port.unwrap_or(EXT_BRIDGE_DEFAULT_PORT);
    let shared = bridge_state.inner.clone();
    {
        let mut guard = shared
            .lock()
            .map_err(|_| "State extension bridge sedang terkunci.".to_string())?;
        if guard.running {
            return Ok(json!({
                "running": true,
                "port": guard.port,
                "url": format!("http://127.0.0.1:{}", guard.port)
            }));
        }
        guard.running = true;
        guard.port = requested_port;
    }

    if let Err(err) = start_extension_bridge_thread(app.clone(), shared.clone(), requested_port) {
        if let Ok(mut guard) = shared.lock() {
            guard.running = false;
        }
        return Err(err);
    }

    let _ = app.emit(
        "entry-event",
        json!({
            "event": "entry_log",
            "level": "info",
            "message": format!("Extension bridge aktif di http://127.0.0.1:{requested_port}")
        }),
    );
    Ok(json!({
        "running": true,
        "port": requested_port,
        "url": format!("http://127.0.0.1:{requested_port}")
    }))
}

#[tauri::command]
fn stop_extension_bridge(
    bridge_state: State<'_, ExtensionBridgeState>,
) -> Result<Value, String> {
    let mut guard = bridge_state
        .inner
        .lock()
        .map_err(|_| "State extension bridge sedang terkunci.".to_string())?;
    guard.running = false;
    Ok(json!({ "running": false, "port": guard.port }))
}

#[tauri::command]
fn extension_bridge_status(
    bridge_state: State<'_, ExtensionBridgeState>,
) -> Result<Value, String> {
    let guard = bridge_state
        .inner
        .lock()
        .map_err(|_| "State extension bridge sedang terkunci.".to_string())?;
    Ok(json!({
        "running": guard.running,
        "port": guard.port,
        "pendingCommands": guard.pending_commands.len(),
        "knownClients": guard.known_clients.len(),
        "events": guard.events.len()
    }))
}

#[tauri::command]
fn queue_extension_command(
    bridge_state: State<'_, ExtensionBridgeState>,
    command_type: String,
    payload: Option<Value>,
    target_client_id: Option<String>,
) -> Result<Value, String> {
    let command_type = command_type.trim().to_string();
    if command_type.is_empty() {
        return Err("command_type tidak boleh kosong.".to_string());
    }
    let mut guard = bridge_state
        .inner
        .lock()
        .map_err(|_| "State extension bridge sedang terkunci.".to_string())?;
    let command_id = guard.next_command_id;
    guard.next_command_id = guard.next_command_id.saturating_add(1);
    guard.pending_commands.push_back(BridgeCommand {
        id: command_id,
        created_at_ms: unix_time_ms(),
        command: command_type.clone(),
        payload: payload.unwrap_or_else(|| json!({})),
        target_client_id: target_client_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    });
    Ok(json!({
        "ok": true,
        "id": command_id,
        "type": command_type,
        "pendingCommands": guard.pending_commands.len()
    }))
}

#[tauri::command]
fn get_extension_bridge_events(
    bridge_state: State<'_, ExtensionBridgeState>,
    limit: Option<usize>,
) -> Result<Vec<Value>, String> {
    let guard = bridge_state
        .inner
        .lock()
        .map_err(|_| "State extension bridge sedang terkunci.".to_string())?;
    let max_items = limit.unwrap_or(50).clamp(1, 500);
    let len = guard.events.len();
    let start = len.saturating_sub(max_items);
    Ok(guard.events.iter().skip(start).cloned().collect())
}

fn locate_node_executable() -> Result<PathBuf, String> {
    if let Ok(raw_path) = std::env::var("NODE_EXE") {
        let candidate = PathBuf::from(raw_path.trim());
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    if let Some(path) = find_node_from_path_var() {
        return Ok(path);
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(path) = find_node_with_where() {
            return Ok(path);
        }
    }

    if let Some(path) = find_node_from_common_locations() {
        return Ok(path);
    }

    Err("Node.js tidak ditemukan. Install Node.js atau set env NODE_EXE ke path node.exe.".to_string())
}

fn find_node_from_path_var() -> Option<PathBuf> {
    let path_var = std::env::var("PATH").ok()?;
    let mut candidates = Vec::new();
    for dir in std::env::split_paths(&path_var) {
        candidates.push(dir.join("node"));
        #[cfg(target_os = "windows")]
        candidates.push(dir.join("node.exe"));
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[cfg(target_os = "windows")]
fn find_node_with_where() -> Option<PathBuf> {
    let output = Command::new("where")
        .arg("node")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .map(|line| PathBuf::from(line.trim()))
        .find(|candidate| candidate.is_file())
}

fn find_node_from_common_locations() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(&local_app_data).join("Programs").join("nodejs").join("node.exe"));
    }
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        candidates.push(PathBuf::from(&program_files).join("nodejs").join("node.exe"));
    }
    if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
        candidates.push(PathBuf::from(&program_files_x86).join("nodejs").join("node.exe"));
    }
    if let Ok(nvm_symlink) = std::env::var("NVM_SYMLINK") {
        candidates.push(PathBuf::from(&nvm_symlink).join("node.exe"));
    }
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        candidates.push(PathBuf::from(&user_profile).join("scoop").join("apps").join("nodejs").join("current").join("node.exe"));
    }

    candidates.into_iter().find(|candidate| candidate.is_file())
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

    {
        let mut in_progress = scan_flag
            .lock()
            .map_err(|_| "Gagal mengunci status scan.".to_string())?;
        if *in_progress {
            return Err("Scan sedang berjalan. Tunggu proses saat ini selesai.".to_string());
        }
        *in_progress = true;
    }

    thread::spawn(move || {
        let result = run_worker_process(&app, &worker_paths, &selected_dir);
        if let Err(message) = result {
            emit_scan_error(&app, "RUST_SCAN_PROCESS_FAILED", message, "start_scan", true);
        }

        if let Ok(mut in_progress) = scan_flag.lock() {
            *in_progress = false;
        }
    });

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
                    if depth < *best_depth || (depth == *best_depth && modified > *best_modified) =>
                {
                    best_candidate = Some((depth, path, modified));
                }
                _ => {}
            }
        }
    }

    Ok(best_candidate.map(|(_, path, _)| path.to_string_lossy().to_string()))
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
            Value::Object(map) if selected_id_set.is_empty() => {
                map.get("status").and_then(Value::as_str) == Some("VALID")
            }
            Value::Object(map) => map
                .get("id")
                .and_then(Value::as_str)
                .map(|id| selected_id_set.contains(id))
                .unwrap_or(false),
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

fn run_worker_process(
    app: &AppHandle,
    worker_paths: &WorkerPaths,
    selected_dir: &str,
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

    let stderr_handle = thread::spawn(move || collect_stderr(stderr));
    let mut saw_complete = false;
    let mut saw_failure = false;

    for line_result in BufReader::new(stdout).lines() {
        let line = match line_result {
            Ok(value) => value,
            Err(err) => {
                let _ = child.kill();
                let _ = child.wait();
                let stderr_output = stderr_handle
                    .join()
                    .unwrap_or_else(|_| String::from("Gagal membaca stderr worker Python."));
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

    let status = child
        .wait()
        .map_err(|err| format!("Gagal menunggu worker Python selesai: {err}"))?;
    let stderr_output = stderr_handle
        .join()
        .unwrap_or_else(|_| String::from("Gagal membaca stderr worker Python."));

    if !status.success() && !saw_failure {
        let message = if stderr_output.trim().is_empty() {
            format!("Worker Python berhenti dengan kode {:?}.", status.code())
        } else {
            stderr_output.trim().to_string()
        };
        emit_scan_error(
            app,
            "WORKER_NON_ZERO_EXIT",
            message,
            "worker_exit",
            true,
        );
    }

    if status.success() && !saw_complete {
        return Err("Worker Python selesai tanpa mengirim hasil akhir scan.".to_string());
    }

    Ok(())
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

fn locate_repo_root() -> Result<PathBuf, String> {
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

        if candidate.join("python-ocr").is_dir() && candidate.join("passport-desktop").is_dir() {
            return Ok(candidate);
        }
    }

    Err("Root repo tidak ditemukan. Pastikan folder python-ocr dan passport-desktop tersedia.".to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ScanState::default())
        .manage(NusukAutomationState::default())
        .manage(ExtensionBridgeState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_scan,
            load_manifest,
            find_manifest_path,
            create_nusuk_batch,
            run_nusuk_automation,
            terminate_nusuk_automation,
            start_extension_bridge,
            stop_extension_bridge,
            extension_bridge_status,
            queue_extension_command,
            get_extension_bridge_events,
            contract_bridge_init,
            contract_bridge_status,
            contract_bridge_queue_command,
            contract_bridge_get_events
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
