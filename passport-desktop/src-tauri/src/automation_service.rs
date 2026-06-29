use crate::protocol::MessageType;
use crate::session_manager::SessionState;

pub struct AutomationService;

impl AutomationService {
    pub fn validate_transition(current: SessionState, trigger: &MessageType) -> Result<SessionState, String> {
        match (current, trigger) {
            (SessionState::Idle, MessageType::SessionCreated) => Ok(SessionState::Created),
            
            (SessionState::Created, MessageType::BatchLoaded) => Ok(SessionState::BatchLoaded),
            
            (SessionState::BatchLoaded, MessageType::Start) => Ok(SessionState::Running),
            (SessionState::BatchLoaded, MessageType::Next) => Ok(SessionState::Running),
            (SessionState::BatchLoaded, MessageType::SessionCompleted) => Ok(SessionState::Completed),
            
            (SessionState::Running, MessageType::Pause) => Ok(SessionState::Paused),
            (SessionState::Running, MessageType::MemberCompleted) => Ok(SessionState::BatchLoaded),
            
            (SessionState::Paused, MessageType::Start) => Ok(SessionState::Running),
            
            // Stop command can transition from any active state to Stopped/Idle
            (_, MessageType::Stop) => Ok(SessionState::Idle),
            
            // Error event can transition from any state to Failed
            (_, MessageType::Error) => Ok(SessionState::Failed),

            // No-op transitions for monitoring events during running state
            (SessionState::Running, MessageType::CurrentMember) => Ok(SessionState::Running),
            (SessionState::Running, MessageType::CurrentStep) => Ok(SessionState::Running),
            (SessionState::Running, MessageType::Progress) => Ok(SessionState::Running),

            // General utility events
            (_, MessageType::Ack) => Ok(current),
            (_, MessageType::Pong) => Ok(current),

            // Illegal transitions
            (SessionState::Idle, MessageType::Start) => {
                Err("ERR_NO_BATCH: Tidak dapat menjalankan otomatisasi sebelum membuat sesi dan memuat batch.".to_string())
            }
            (SessionState::Created, MessageType::Start) => {
                Err("ERR_NO_BATCH: Tidak dapat menjalankan otomatisasi sebelum memuat batch jamaah.".to_string())
            }
            (SessionState::Running, MessageType::Start) => {
                Err("ERR_ALREADY_RUNNING: Otomatisasi pengerjaan batch sedang berlangsung.".to_string())
            }
            (SessionState::Paused, MessageType::Next) => {
                Err("ERR_ILLEGAL_TRANSITION: Tidak dapat berpindah ke mutamer berikutnya dari kondisi Pause. Lakukan Resume (Start) terlebih dahulu.".to_string())
            }
            _ => {
                Err("ERR_ILLEGAL_TRANSITION: Transisi status sesi tidak valid dalam alur kerja.".to_string())
            }
        }
    }
}
