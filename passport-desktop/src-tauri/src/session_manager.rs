use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSession {
    pub session_id: String,
    pub resume_token: String,
    pub status: SessionState,
    pub current_member_id: Option<String>,
    pub workspace_path: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub progress_current: u32,
    pub progress_total: u32,
    pub current_step: Option<String>,
    pub manifest_version: u32,
    pub manifest_hash: String,
    pub manifest_path: String,
    pub failures: Vec<serde_json::Value>,
    pub revision: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEvent {
    pub timestamp: String,
    pub session_id: String,
    pub revision: u64,
    pub description: String,
}

#[derive(Debug, Default)]
pub struct SessionMetrics {
    pub snapshots_generated: AtomicU64,
    pub snapshots_restored: AtomicU64,
    pub resumes_successful: AtomicU64,
    pub resumes_failed: AtomicU64,
    pub heartbeats_lost: AtomicU64,
    pub recovery_timeouts: AtomicU64,
    pub sequence_dropped: AtomicU64,
    pub journal_overflow: AtomicU64,
}

pub struct SessionManager {
    active_session: RwLock<Option<AutomationSession>>,
    journal: RwLock<Vec<JournalEvent>>,
    pub metrics: SessionMetrics,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            active_session: RwLock::new(None),
            journal: RwLock::new(Vec::new()),
            metrics: SessionMetrics::default(),
        }
    }

    pub fn create_session(&self, session_id: String, workspace_path: String) -> Result<AutomationSession, String> {
        let mut active = self.active_session.write().unwrap();
        if active.is_some() {
            return Err("Sesi otomatisasi lain sedang aktif.".to_string());
        }

        let resume_token = uuid::Uuid::new_v4().to_string();
        let session = AutomationSession {
            session_id,
            resume_token,
            status: SessionState::Created,
            current_member_id: None,
            workspace_path,
            created_at: chrono::Utc::now(),
            progress_current: 0,
            progress_total: 0,
            current_step: None,
            manifest_version: 1,
            manifest_hash: String::new(),
            manifest_path: String::new(),
            failures: Vec::new(),
            revision: 1,
        };

        *active = Some(session.clone());
        println!("[Session] Sesi baru berhasil diinisialisasi: {}", session.session_id);

        self.add_journal_entry(
            &session.session_id,
            session.revision,
            "Sesi otomatisasi baru diinisialisasi".to_string(),
        );

        Ok(session)
    }

    pub fn get_session(&self) -> Option<AutomationSession> {
        let active = self.active_session.read().unwrap();
        active.clone()
    }

    pub fn update_snapshot<F>(&self, update_fn: F) -> Result<AutomationSession, String>
    where
        F: FnOnce(&mut AutomationSession),
    {
        let mut active = self.active_session.write().unwrap();
        if let Some(ref mut session) = *active {
            update_fn(session);
            session.revision += 1;
            let cloned = session.clone();
            
            let desc = format!("State update (status: {:?}, progress: {}/{}, member: {:?})", 
                cloned.status, cloned.progress_current, cloned.progress_total, cloned.current_member_id);
            drop(active);
            self.add_journal_entry(&cloned.session_id, cloned.revision, desc);
            
            Ok(cloned)
        } else {
            Err("Tidak ada sesi aktif.".to_string())
        }
    }

    pub fn update_status(&self, status: SessionState) -> Result<(), String> {
        self.update_snapshot(|s| {
            s.status = status;
        }).map(|_| ())
    }

    pub fn update_current_member(&self, member_id: Option<String>) -> Result<(), String> {
        self.update_snapshot(|s| {
            s.current_member_id = member_id;
        }).map(|_| ())
    }

    pub fn close_session(&self) {
        let mut active = self.active_session.write().unwrap();
        if let Some(ref session) = *active {
            println!("[Session] Sesi ditutup: {}", session.session_id);
            self.add_journal_entry(&session.session_id, session.revision, "Sesi otomatisasi ditutup".to_string());
        }
        *active = None;
    }

    pub fn add_journal_entry(&self, session_id: &str, revision: u64, description: String) {
        let mut journal = self.journal.write().unwrap();
        let event = JournalEvent {
            timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            session_id: session_id.to_string(),
            revision,
            description,
        };
        journal.push(event);
        if journal.len() > 200 {
            journal.remove(0);
            self.metrics.journal_overflow.fetch_add(1, Ordering::SeqCst);
        }
    }

    pub fn get_journal(&self) -> Vec<JournalEvent> {
        let journal = self.journal.read().unwrap();
        journal.clone()
    }
}
