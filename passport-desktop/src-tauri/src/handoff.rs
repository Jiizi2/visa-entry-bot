use crate::{protocol::{Envelope, MessageType}, server::connection_manager::ConnectionManager, transport::websocket::ClientId};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tokio::sync::oneshot;

#[derive(Default)]
pub struct HandoffManager {
    pending: Mutex<HashMap<(ClientId, String), oneshot::Sender<Envelope>>>,
    pub operation: tokio::sync::Mutex<()>,
}

impl HandoffManager {
    pub fn resolve(&self, client: ClientId, envelope: &Envelope) -> bool {
        if !matches!(envelope.r#type, MessageType::NusukContext | MessageType::BatchLoaded | MessageType::Error) { return false; }
        let Some(reply) = &envelope.reply_to_message_id else { return false; };
        if let Some(sender) = self.pending.lock().unwrap().remove(&(client, reply.clone())) {
            let _ = sender.send(envelope.clone());
            return true;
        }
        false
    }

    pub fn disconnect(&self, client: ClientId) {
        self.pending.lock().unwrap().retain(|(id, _), _| *id != client);
    }

    pub async fn request(&self, cm: &ConnectionManager, client: ClientId, kind: MessageType, session: &str, payload: Value) -> Result<Envelope, String> {
        let message_id = uuid::Uuid::new_v4().to_string();
        let envelope = Envelope {
            protocol_version: 1, r#type: kind, message_id: message_id.clone(), session_id: session.into(),
            correlation_id: message_id.clone(), timestamp: chrono::Utc::now().to_rfc3339(),
            sequence: cm.next_outgoing_sequence(client), reply_to_message_id: None, payload,
        };
        let (sender, receiver) = oneshot::channel();
        let key = (client, message_id);
        self.pending.lock().unwrap().insert(key.clone(), sender);
        let text = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;
        if let Err(error) = cm.send_to(client, text) {
            self.pending.lock().unwrap().remove(&key);
            return Err(error);
        }
        let timeout = match envelope.r#type { MessageType::GetNusukContext => 5, MessageType::OpenNusuk => 10, _ => 22 };
        let result = tokio::time::timeout(Duration::from_secs(timeout), receiver).await;
        self.pending.lock().unwrap().remove(&key);
        let reply = result.map_err(|_| "Extension belum mengonfirmasi penerimaan. Periksa tab Nusuk lalu coba lagi; data dan progress tetap tersimpan.".to_string())?
            .map_err(|_| "Koneksi extension terputus. Aktifkan kembali browser yang digunakan lalu coba lagi.".to_string())?;
        if reply.r#type == MessageType::Error {
            return Err(reply.payload["message"].as_str().unwrap_or("Extension belum siap.").to_string());
        }
        Ok(reply)
    }
}

#[tauri::command]
pub fn get_automation_status(
    cm: tauri::State<'_, std::sync::Arc<ConnectionManager>>,
    sm: tauri::State<'_, std::sync::Arc<crate::session_manager::SessionManager>>,
) -> Value {
    json!({ "connected": !cm.get_ready_client_ids().is_empty(), "session": sm.get_session() })
}

#[tauri::command]
pub async fn prepare_nusuk_handoff(
    cm: tauri::State<'_, std::sync::Arc<ConnectionManager>>,
    sm: tauri::State<'_, std::sync::Arc<crate::session_manager::SessionManager>>,
    hm: tauri::State<'_, std::sync::Arc<HandoffManager>>,
    members: Vec<Value>, manifest_path: String, client_id: Option<String>, tab_id: Option<u64>,
) -> Result<Value, String> {
    prepare(&cm, &sm, &hm, members, manifest_path, client_id, tab_id).await
}

async fn prepare(
    cm: &std::sync::Arc<ConnectionManager>, sm: &std::sync::Arc<crate::session_manager::SessionManager>,
    hm: &std::sync::Arc<HandoffManager>, members: Vec<Value>, manifest_path: String,
    client_id: Option<String>, tab_id: Option<u64>,
) -> Result<Value, String> {
    use crate::session_manager::SessionState;
    let _operation = hm.operation.try_lock().map_err(|_| "Perpindahan ke Nusuk masih diproses.".to_string())?;
    let clients: Vec<_> = cm.get_ready_client_ids().into_iter().filter(|id| cm.get_client_info(*id).is_some_and(|c| c.supports_handoff)).collect();
    if clients.is_empty() {
        return Ok(json!({ "status": if cm.get_ready_client_ids().is_empty() { "extension_required" } else { "extension_update_required" } }));
    }
    let old = sm.get_session();
    let hash = crate::fnv1a_hash(&serde_json::to_string(&members).map_err(|e| e.to_string())?);
    let same_batch = old.as_ref().is_some_and(|s| s.manifest_hash == hash && s.manifest_path == manifest_path);
    let active = old.as_ref().is_some_and(|s| matches!(s.status, SessionState::Running | SessionState::Paused));
    if active && !same_batch { return Err("Pekerjaan lain masih berjalan di Nusuk. Selesaikan atau akhiri pekerjaan tersebut dari extension sebelum mengirim batch ini.".into()); }
    let requested = client_id.map(|id| id.parse::<ClientId>().map_err(|_| "Browser yang dipilih tidak valid.".to_string())).transpose()?;
    let mut contexts = Vec::new();
    // Query all profiles concurrently so an inactive profile does not hold up the others.
    let queries: Vec<_> = clients.iter().map(|id| {
        let (cm, hm) = (cm.clone(), hm.clone()); let id = *id;
        tauri::async_runtime::spawn(async move { (id, hm.request(&cm, id, MessageType::GetNusukContext, "", json!({})).await) })
    }).collect();
    for query in queries {
        if let Ok((id, Ok(reply))) = query.await { contexts.push((id, reply.payload)); }
    }
    if contexts.is_empty() { return Err("Extension terhubung, tetapi belum merespons. Buka extension EntryMate di browser yang sudah login lalu coba lagi.".into()); }
    let mut choices = Vec::new();
    for (index, (id, context)) in contexts.iter().enumerate() {
        if let Some(tabs) = context["tabs"].as_array() {
            for tab in tabs { let mut tab = tab.clone(); tab["clientId"] = json!(id.to_string()); tab["browserLabel"] = json!(format!("Browser {}", index + 1)); choices.push(tab); }
        }
    }
    let associated = if same_batch { old.as_ref().and_then(|s| contexts.iter().find(|(_,c)| c["sessionId"].as_str() == Some(&s.session_id)).map(|(id,_)| *id)) } else { None };
    if same_batch && old.as_ref().is_some_and(|s| s.status != SessionState::Created) && associated.is_none() {
        return Err("Browser yang menyimpan pekerjaan ini belum terhubung. Buka kembali browser asal dan aktifkan extension; progress tetap tersimpan.".into());
    }
    let (client, selected_tab) = if let Some(id) = requested {
        if !contexts.iter().any(|(c,_)| *c == id) { return Err("Browser tersebut sudah terputus. Pilih kembali browser yang aktif.".into()); }
        if same_batch && associated.is_some_and(|c| c != id) { return Err("Pekerjaan ini tersimpan di browser lain. Gunakan browser asal untuk melanjutkan.".into()); }
        (id, tab_id)
    } else if let Some(id) = associated {
        let context = &contexts.iter().find(|(c,_)| *c == id).unwrap().1;
        (id, context["selectedTabId"].as_u64())
    } else if choices.len() == 1 {
        (choices[0]["clientId"].as_str().unwrap().parse().unwrap(), choices[0]["tabId"].as_u64())
    } else if choices.len() > 1 {
        return Ok(json!({ "status": "choose_tab", "tabs": choices }));
    } else if contexts.len() > 1 {
        return Ok(json!({ "status": "choose_tab", "tabs": contexts.iter().enumerate().map(|(i,(id,_))| json!({ "clientId": id.to_string(), "browserLabel": format!("Browser {}", i+1), "title": "Buka Nusuk di browser ini" })).collect::<Vec<_>>() }));
    } else { (contexts[0].0, None) };
    let context = hm.request(&cm, client, MessageType::OpenNusuk, "", json!({ "tabId": selected_tab, "preserveSession": same_batch })).await?.payload;
    if context["status"] == "choose_tab" { return Ok(json!({ "status": "choose_tab", "tabs": choices })); }
    let page_status = context["status"].as_str().unwrap_or("loading");
    // A stale content script needs explicit user refresh before any new data is sent.
    if page_status == "needs_refresh" { return Ok(json!({ "status": "needs_refresh" })); }
    if same_batch && old.as_ref().is_some_and(|s| s.status != SessionState::Created) {
        return Ok(json!({ "status": "accepted", "pageStatus": page_status, "session": sm.get_session() }));
    }
    if members.is_empty() { return Err("Batch jamaah masih kosong.".into()); }
    if !same_batch {
        sm.close_session();
        sm.create_session(uuid::Uuid::new_v4().to_string(), manifest_path.clone())?;
    }
    let session = sm.update_snapshot(|s| {
        s.manifest_hash = hash; s.manifest_path = manifest_path.clone(); s.manifest_members = members.clone();
        s.progress_total = members.len() as u32; s.target_client_id = Some(client);
    })?;
    hm.request(&cm, client, MessageType::LoadBatch, &session.session_id, json!({ "members": members, "manifestPath": manifest_path, "resumeToken": session.resume_token })).await?;
    Ok(json!({ "status": "accepted", "pageStatus": page_status, "session": sm.get_session() }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use crate::session_manager::{SessionManager, SessionState};

    fn fake_extension(cm: &Arc<ConnectionManager>, sm: &Arc<SessionManager>, hm: &Arc<HandoffManager>, tab_ids: Vec<u64>, reject_batch: bool) -> Arc<Mutex<Vec<MessageType>>> {
        let id = ClientId::new_v4(); let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        cm.register_client(id, sender, "127.0.0.1:10001".parse().unwrap());
        cm.complete_handshake(id, "chrome".into(), "test".into()); cm.set_handoff_support(id, true); cm.complete_ready(id);
        let commands = Arc::new(Mutex::new(Vec::new())); let captured = commands.clone();
        let (sm, hm) = (sm.clone(), hm.clone());
        tokio::spawn(async move {
            let mut session_id = String::new();
            while let Some(text) = receiver.recv().await {
                let request: Envelope = serde_json::from_str(&text).unwrap(); captured.lock().unwrap().push(request.r#type.clone());
                let mut response = request.clone(); response.reply_to_message_id = Some(request.message_id);
                response.r#type = MessageType::NusukContext;
                response.payload = json!({ "sessionId": session_id, "selectedTabId": if session_id.is_empty() { None } else { tab_ids.first().copied() }, "tabs": tab_ids.iter().map(|id| json!({"tabId": id, "title": "Nusuk", "pageStatus": "ready"})).collect::<Vec<_>>() });
                if request.r#type == MessageType::OpenNusuk { response.payload["status"] = json!("ready"); }
                if request.r#type == MessageType::LoadBatch {
                    if reject_batch { response.r#type = MessageType::Error; response.payload = json!({"message": "Halaman belum menerima data"}); }
                    else { session_id = request.session_id; sm.update_status(SessionState::BatchLoaded).unwrap(); response.r#type = MessageType::BatchLoaded; }
                }
                hm.resolve(id, &response);
            }
        });
        commands
    }

    #[tokio::test]
    async fn disconnected_extension_does_not_create_a_session() {
        let (cm, sm, hm) = (Arc::new(ConnectionManager::new()), Arc::new(SessionManager::new()), Arc::new(HandoffManager::default()));
        let result = prepare(&cm, &sm, &hm, vec![json!({"id":"a"})], "manifest".into(), None, None).await.unwrap();
        assert_eq!(result["status"], "extension_required"); assert!(sm.get_session().is_none());
    }

    #[tokio::test]
    async fn repeated_handoff_preserves_accepted_batch_and_never_starts_entry() {
        let (cm, sm, hm) = (Arc::new(ConnectionManager::new()), Arc::new(SessionManager::new()), Arc::new(HandoffManager::default()));
        let commands = fake_extension(&cm, &sm, &hm, vec![10], false);
        let result = prepare(&cm, &sm, &hm, vec![json!({"id":"a"})], "manifest".into(), None, None).await.unwrap();
        assert_eq!(result["status"], "accepted"); let session = sm.get_session().unwrap();
        prepare(&cm, &sm, &hm, vec![json!({"id":"a"})], "manifest".into(), None, None).await.unwrap();
        assert_eq!(sm.get_session().unwrap().session_id, session.session_id);
        let commands = commands.lock().unwrap();
        assert_eq!(commands.iter().filter(|t| **t == MessageType::LoadBatch).count(), 1);
        assert!(!commands.contains(&MessageType::Start));
    }

    #[tokio::test]
    async fn several_tabs_require_choice_without_sending_batch() {
        let (cm, sm, hm) = (Arc::new(ConnectionManager::new()), Arc::new(SessionManager::new()), Arc::new(HandoffManager::default()));
        let commands = fake_extension(&cm, &sm, &hm, vec![10,20], false);
        let result = prepare(&cm, &sm, &hm, vec![json!({"id":"a"})], "manifest".into(), None, None).await.unwrap();
        assert_eq!(result["status"], "choose_tab"); assert_eq!(result["tabs"].as_array().unwrap().len(), 2);
        assert_eq!(*commands.lock().unwrap(), vec![MessageType::GetNusukContext]); assert!(sm.get_session().is_none());
    }

    #[tokio::test]
    async fn rejected_batch_is_never_reported_as_accepted_and_retry_keeps_session() {
        let (cm, sm, hm) = (Arc::new(ConnectionManager::new()), Arc::new(SessionManager::new()), Arc::new(HandoffManager::default()));
        fake_extension(&cm, &sm, &hm, vec![10], true);
        assert!(prepare(&cm, &sm, &hm, vec![json!({"id":"a"})], "manifest".into(), None, None).await.is_err());
        let session = sm.get_session().unwrap(); assert_eq!(session.status, SessionState::Created);
        assert!(prepare(&cm, &sm, &hm, vec![json!({"id":"a"})], "manifest".into(), None, None).await.is_err());
        assert_eq!(sm.get_session().unwrap().session_id, session.session_id);
    }
    #[tokio::test]
    async fn response_must_match_client_and_request() {
        let manager = HandoffManager::default(); let id = ClientId::new_v4();
        let (sender, receiver) = oneshot::channel();
        manager.pending.lock().unwrap().insert((id, "request".into()), sender);
        let mut reply = Envelope { protocol_version: 1, r#type: MessageType::NusukContext, message_id: "reply".into(), session_id: "".into(), correlation_id: "".into(), timestamp: "".into(), sequence: 1, reply_to_message_id: Some("request".into()), payload: json!({}) };
        assert!(!manager.resolve(ClientId::new_v4(), &reply));
        reply.reply_to_message_id = Some("another".into()); assert!(!manager.resolve(id, &reply));
        reply.reply_to_message_id = Some("request".into()); assert!(manager.resolve(id, &reply));
        assert_eq!(receiver.await.unwrap().message_id, "reply"); assert!(!manager.resolve(id, &reply));
    }
}
