use crate::automation_service::AutomationService;
use crate::protocol::{Envelope, MessageType};
use crate::server::connection_manager::ConnectionManager;
use crate::session_manager::{SessionManager, SessionState};
use crate::transport::websocket::ClientId;

pub struct MessageRouter;

impl MessageRouter {
    pub fn route(
        app: &tauri::AppHandle,
        envelope: Envelope,
        client_id: ClientId,
        cm: &ConnectionManager,
        sm: &SessionManager,
    ) -> Result<(), String> {
        if !matches!(envelope.r#type, MessageType::Ack | MessageType::Pong) {
            if let Some(session) = sm.get_session() {
                if envelope.session_id != session.session_id {
                    send_error(cm, client_id, "ERR_INVALID_SESSION", "Pesan berasal dari sesi entry yang berbeda.", &envelope);
                    return Err("Sesi entry tidak cocok.".to_string());
                }
                if session.target_client_id.is_some_and(|id| id != client_id) { return Err("Pekerjaan terikat ke browser lain.".into()); }
            }
        }
        let current_state = sm.get_session()
            .map(|s| s.status)
            .unwrap_or(SessionState::Idle);

        // Check if transition is valid
        let next_state = match AutomationService::validate_transition(current_state, &envelope.r#type) {
            Ok(state) => state,
            Err(err_msg) => {
                let parts: Vec<&str> = err_msg.split(':').collect();
                let code = if parts.len() > 1 { parts[0].trim() } else { "ERR_ILLEGAL_TRANSITION" };
                let msg = if parts.len() > 1 { parts[1].trim() } else { &err_msg };
                send_error(cm, client_id, code, msg, &envelope);
                return Err(err_msg);
            }
        };

        match envelope.r#type {
            MessageType::Running => {
                if current_state == SessionState::Completed && (envelope.payload["retryFailed"] != true || sm.get_session().is_none_or(|s| s.failures.is_empty())) {
                    return Err("Batch selesai hanya dapat mengulang jamaah yang gagal.".into());
                }
                let _ = sm.update_status(SessionState::Running);
            }
            MessageType::SessionCreated => {
                if let Ok(payload) = serde_json::from_value::<crate::protocol::SessionCreatedPayload>(envelope.payload.clone()) {
                    println!(
                        "[Session] Menerima SESSION_CREATED dari ekstensi dengan status: {}",
                        payload.status
                    );

                    let _ = sm.update_status(next_state);
                    send_envelope(cm, client_id, MessageType::Ack, &envelope.correlation_id,
                        serde_json::json!({}), Some(envelope.message_id.clone()));
                } else {
                    send_error(cm, client_id, "ERR_INVALID_PAYLOAD", "Payload SESSION_CREATED tidak valid.", &envelope);
                }
            }
            MessageType::BatchLoaded => {
                println!("[Session] Menerima BATCH_LOADED dari ekstensi.");
                let _ = sm.update_status(next_state);

                // Respond with ACK
                send_envelope(
                    cm,
                    client_id,
                    MessageType::Ack,
                    &envelope.correlation_id,
                    serde_json::json!({}),
                    Some(envelope.message_id.clone()),
                );
                println!("[Session] Batch data jamaah berhasil dimuat di ekstensi.");
            }
            MessageType::CurrentMember => {
                if let Ok(payload) = serde_json::from_value::<crate::protocol::CurrentMemberPayload>(envelope.payload.clone()) {
                    let _ = sm.update_snapshot(|s| {
                        s.current_member_id = Some(payload.member_id.clone());
                        s.status = SessionState::Running;
                    });
                    crate::event_dispatcher::EventDispatcher::dispatch_current_member(app, &payload.member_id);
                    send_envelope(cm, client_id, MessageType::Ack, &envelope.correlation_id, serde_json::json!({}), Some(envelope.message_id.clone()));
                } else {
                    send_error(cm, client_id, "ERR_INVALID_PAYLOAD", "Payload CURRENT_MEMBER tidak valid.", &envelope);
                }
            }
            MessageType::CurrentStep => {
                if let Ok(payload) = serde_json::from_value::<crate::protocol::CurrentStepPayload>(envelope.payload.clone()) {
                    let _ = sm.update_snapshot(|s| {
                        s.current_step = Some(payload.step_name.clone());
                    });
                    crate::event_dispatcher::EventDispatcher::dispatch_current_step(app, &payload.step_name);
                    send_envelope(cm, client_id, MessageType::Ack, &envelope.correlation_id, serde_json::json!({}), Some(envelope.message_id.clone()));
                } else {
                    send_error(cm, client_id, "ERR_INVALID_PAYLOAD", "Payload CURRENT_STEP tidak valid.", &envelope);
                }
            }
            MessageType::Progress => {
                if let Ok(payload) = serde_json::from_value::<crate::protocol::ProgressPayload>(envelope.payload.clone()) {
                    let _ = sm.update_snapshot(|s| {
                        // Connection sequences already reject duplicate/out-of-order
                        // packets. Client and desktop revisions are different counters.
                        s.progress_current = payload.current;
                        s.progress_total = payload.total;
                        if let Some(ref st) = payload.status {
                            s.status = match st.as_str() {
                                "RUNNING" => crate::session_manager::SessionState::Running,
                                "PAUSED" => crate::session_manager::SessionState::Paused,
                                "COMPLETED" => crate::session_manager::SessionState::Completed,
                                "IDLE" => crate::session_manager::SessionState::Idle,
                                _ => s.status,
                            };
                        }
                    });

                    let percent = (payload.current * 100) / std::cmp::max(payload.total, 1);
                    let message = format!("Passport {} / {}", payload.current, payload.total);
                    crate::event_dispatcher::EventDispatcher::dispatch_progress(app, percent, &message);
                    send_envelope(cm, client_id, MessageType::Ack, &envelope.correlation_id, serde_json::json!({}), Some(envelope.message_id.clone()));
                } else {
                    send_error(cm, client_id, "ERR_INVALID_PAYLOAD", "Payload PROGRESS tidak valid.", &envelope);
                }
            }
            MessageType::FailureUpdated => {
                if let Ok(payload) = serde_json::from_value::<crate::protocol::FailureUpdatedPayload>(envelope.payload.clone()) {
                    let _ = sm.update_snapshot(|s| {
                        s.failures.retain(|failure| failure["memberId"].as_str() != Some(&payload.member_id));
                        s.failures.push(serde_json::json!({
                            "memberId": payload.member_id,
                            "reason": payload.reason,
                            "failedAt": payload.failed_at,
                        }));
                    });
                    send_envelope(cm, client_id, MessageType::Ack, &envelope.correlation_id, serde_json::json!({}), Some(envelope.message_id.clone()));
                } else {
                    send_error(cm, client_id, "ERR_INVALID_PAYLOAD", "Payload FAILURE_UPDATED tidak valid.", &envelope);
                }
            }
            MessageType::MemberCompleted => {
                if let Ok(payload) = serde_json::from_value::<crate::protocol::MemberCompletedPayload>(envelope.payload.clone()) {
                    let _ = sm.update_snapshot(|s| {
                        if !s.completed_member_ids.contains(&payload.member_id) {
                            s.completed_member_ids.push(payload.member_id.clone());
                        }
                        s.failures.retain(|failure| failure["memberId"].as_str() != Some(&payload.member_id));
                        s.current_member_id = None;
                        s.current_step = None;
                    });
                    crate::event_dispatcher::EventDispatcher::dispatch_member_completed(app, &payload.member_id);
                    send_envelope(cm, client_id, MessageType::Ack, &envelope.correlation_id, serde_json::json!({}), Some(envelope.message_id.clone()));
                } else {
                    send_error(cm, client_id, "ERR_INVALID_PAYLOAD", "Payload MEMBER_COMPLETED tidak valid.", &envelope);
                }
            }
            MessageType::SessionCompleted => {
                let _ = sm.update_snapshot(|s| {
                    s.status = crate::session_manager::SessionState::Completed;
                    s.current_member_id = None;
                    s.current_step = None;
                });
                crate::event_dispatcher::EventDispatcher::dispatch_session_completed(app, &envelope.session_id);
                send_envelope(cm, client_id, MessageType::Ack, &envelope.correlation_id, serde_json::json!({}), Some(envelope.message_id.clone()));
            }
            MessageType::Stop => {
                sm.close_session();
                send_envelope(cm, client_id, MessageType::Ack, &envelope.correlation_id, serde_json::json!({}), Some(envelope.message_id.clone()));
            }
            MessageType::Ack | MessageType::Pong | MessageType::SessionSnapshot => {
                // No-op untuk pesan utilitas/snapshot
            }
            _ => {
                send_error(
                    cm,
                    client_id,
                    "ERR_NOT_IMPLEMENTED",
                    "Fitur orkestrasi pesan ini belum diimplementasikan di router.",
                    &envelope,
                );
            }
        }

        Ok(())
    }
}

fn send_envelope(
    cm: &ConnectionManager,
    client_id: ClientId,
    msg_type: MessageType,
    correlation_id: &str,
    payload: serde_json::Value,
    reply_to: Option<String>,
) {
    let sequence = cm.next_outgoing_sequence(client_id);
    let envelope = Envelope {
        protocol_version: 1,
        r#type: msg_type,
        message_id: uuid::Uuid::new_v4().to_string(),
        session_id: "".to_string(),
        correlation_id: correlation_id.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        sequence,
        reply_to_message_id: reply_to,
        payload,
    };
    if let Ok(text) = serde_json::to_string(&envelope) {
        let _ = cm.send_to(client_id, text);
    }
}

fn send_error(
    cm: &ConnectionManager,
    client_id: ClientId,
    code: &str,
    message: &str,
    reply_to_envelope: &Envelope,
) {
    let err_payload = crate::protocol::ErrorPayload {
        code: code.to_string(),
        message: message.to_string(),
        recoverable: true,
        details: None,
    };
    send_envelope(
        cm,
        client_id,
        MessageType::Error,
        &reply_to_envelope.correlation_id,
        serde_json::to_value(&err_payload).unwrap(),
        Some(reply_to_envelope.message_id.clone()),
    );
}
