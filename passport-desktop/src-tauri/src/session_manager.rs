use std::sync::RwLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    Idle,
    Created,
    BatchLoaded,
    Running,
    Paused,
    Completed,
    Stopped,
    Failed,
}

#[derive(Debug, Clone)]
pub struct AutomationSession {
    pub session_id: String,
    pub status: SessionState,
    pub current_member_id: Option<String>,
    pub workspace_path: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub struct SessionManager {
    active_session: RwLock<Option<AutomationSession>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            active_session: RwLock::new(None),
        }
    }

    pub fn create_session(&self, session_id: String, workspace_path: String) -> Result<AutomationSession, String> {
        let mut active = self.active_session.write().unwrap();
        if active.is_some() {
            return Err("Sesi otomatisasi lain sedang aktif.".to_string());
        }

        let session = AutomationSession {
            session_id,
            status: SessionState::Created,
            current_member_id: None,
            workspace_path,
            created_at: chrono::Utc::now(),
        };

        *active = Some(session.clone());
        println!("[Session] Sesi baru berhasil diinisialisasi: {}", session.session_id);
        Ok(session)
    }

    pub fn get_session(&self) -> Option<AutomationSession> {
        let active = self.active_session.read().unwrap();
        active.clone()
    }

    pub fn update_status(&self, status: SessionState) -> Result<(), String> {
        let mut active = self.active_session.write().unwrap();
        if let Some(ref mut session) = *active {
            let old_status = session.status;
            session.status = status;
            println!("[Session] Transisi status sesi {}: {:?} -> {:?}", session.session_id, old_status, status);
            Ok(())
        } else {
            Err("Tidak ada sesi aktif untuk memperbarui status.".to_string())
        }
    }

    pub fn update_current_member(&self, member_id: Option<String>) -> Result<(), String> {
        let mut active = self.active_session.write().unwrap();
        if let Some(ref mut session) = *active {
            session.current_member_id = member_id;
            Ok(())
        } else {
            Err("Tidak ada sesi aktif untuk memperbarui mutamer aktif.".to_string())
        }
    }

    pub fn close_session(&self) {
        let mut active = self.active_session.write().unwrap();
        if let Some(ref session) = *active {
            println!("[Session] Sesi ditutup: {}", session.session_id);
        }
        *active = None;
    }
}
