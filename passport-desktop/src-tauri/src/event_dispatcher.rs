use tauri::{AppHandle, Emitter};

pub struct EventDispatcher;

impl EventDispatcher {
    pub fn dispatch_current_member(app: &AppHandle, member_id: &str) {
        println!("[EventDispatcher] Menyebarkan CURRENT_MEMBER ke Frontend UI: {}", member_id);
        let _ = app.emit("automation-current-member", serde_json::json!({ "memberId": member_id }));
    }

    pub fn dispatch_current_step(app: &AppHandle, step: &str) {
        println!("[EventDispatcher] Menyebarkan CURRENT_STEP ke Frontend UI: {}", step);
        let _ = app.emit("automation-current-step", serde_json::json!({ "step": step }));
    }

    pub fn dispatch_progress(app: &AppHandle, percent: u32, message: &str) {
        println!("[EventDispatcher] Menyebarkan PROGRESS ke Frontend UI: {}% - {}", percent, message);
        let _ = app.emit("automation-progress", serde_json::json!({ "percent": percent, "message": message }));
    }

    pub fn dispatch_member_completed(app: &AppHandle, member_id: &str) {
        println!("[EventDispatcher] Menyebarkan MEMBER_COMPLETED ke Frontend UI: {}", member_id);
        let _ = app.emit("automation-member-completed", serde_json::json!({ "memberId": member_id }));
    }

    pub fn dispatch_session_completed(app: &AppHandle, session_id: &str) {
        println!("[EventDispatcher] Menyebarkan SESSION_COMPLETED ke Frontend UI: {}", session_id);
        let _ = app.emit("automation-session-completed", serde_json::json!({ "sessionId": session_id }));
    }
}
