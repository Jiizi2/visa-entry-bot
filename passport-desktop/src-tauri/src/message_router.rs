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
            MessageType::SessionCreated => {
                if let Ok(payload) = serde_json::from_value::<crate::protocol::SessionCreatedPayload>(envelope.payload.clone()) {
                    println!(
                        "[Session] Menerima SESSION_CREATED dari ekstensi dengan status: {}",
                        payload.status
                    );

                    // Initialize session in manager
                    match sm.create_session(envelope.session_id.clone(), "test-workspace-path".to_string()) {
                        Ok(_) => {
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
                            println!("[Session] Sesi otomatisasi baru aktif di kedua belah pihak.");

                            // Picu LOAD_BATCH otomatis untuk pengujian alur Sprint 3
                            let load_batch_payload = serde_json::json!({
                                "members": [
                                    {
                                        "id": "member-001",
                                        "name": "Ahmad Fulan",
                                        "passportNumber": "A9876543",
                                        "passportImagePath": "C:\\passports\\ahmad.jpg",
                                        "companionId": null,
                                        "resolvedProfile": null
                                    }
                                ]
                            });
                            send_envelope(
                                cm,
                                client_id,
                                MessageType::LoadBatch,
                                &envelope.correlation_id,
                                load_batch_payload,
                                None,
                            );
                            println!("[Session] Mengirim LOAD_BATCH otomatis untuk pengujian.");
                        }
                        Err(e) => {
                            send_error(cm, client_id, "ERR_SESSION_ALREADY_ACTIVE", &e, &envelope);
                        }
                    }
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

                // Picu START otomatis untuk pengujian alur Sprint 4
                send_envelope(
                    cm,
                    client_id,
                    MessageType::Start,
                    &envelope.correlation_id,
                    serde_json::json!({}),
                    None,
                );
                println!("[Session] Mengirim START otomatis ke ekstensi.");
                let _ = sm.update_status(crate::session_manager::SessionState::Running);
            }
            MessageType::CurrentMember => {
                if let Ok(payload) = serde_json::from_value::<crate::protocol::CurrentMemberPayload>(envelope.payload.clone()) {
                    let _ = sm.update_snapshot(|s| {
                        s.current_member_id = Some(payload.member_id.clone());
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
                    let mut is_stale = false;
                    let _ = sm.update_snapshot(|s| {
                        if payload.revision > s.revision {
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
                            s.revision = payload.revision;
                        } else {
                            is_stale = true;
                        }
                    });

                    if is_stale {
                        println!("[Session] Mengabaikan progress event karena revision usang: {}", payload.revision);
                        send_envelope(cm, client_id, MessageType::Ack, &envelope.correlation_id, serde_json::json!({}), Some(envelope.message_id.clone()));
                        return Ok(());
                    }

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
