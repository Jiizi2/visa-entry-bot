use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MessageType {
    // Commands (Desktop -> Extension)
    CreateSession,
    LoadBatch,
    SessionSnapshot,
    Start,
    Next,
    Pause,
    Stop,
    Ping,
    HelloAck,

    // Events (Extension -> Desktop)
    Hello,
    Ready,
    Running,
    CurrentMember,
    CurrentStep,
    Progress,
    FailureUpdated,
    MemberCompleted,
    SessionCompleted,
    Pong,

    // Responses
    Ack,
    SessionCreated,
    BatchLoaded,

    // Errors
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    pub protocol_version: u32,
    pub r#type: MessageType,
    pub message_id: String,
    pub session_id: String,
    pub correlation_id: String,
    pub timestamp: String, // ISO 8601 UTC
    pub sequence: u64,     // Connection-specific sequence number
    pub reply_to_message_id: Option<String>,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloPayload {
    pub extension_version: String,
    pub browser: String,
    pub capabilities: Capabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub supports_debugger: bool,
    pub supports_screenshot: bool,
    pub supports_resume: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloAckPayload {
    pub auth_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionPayload {
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCreatedPayload {
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberProfile {
    pub profesi: Option<String>,
    pub status_nikah: Option<String>,
    pub tipe_passport: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: String,
    pub name: String,
    pub passport_number: String,
    pub passport_image_path: String,
    pub companion_id: Option<String>,
    pub resolved_profile: Option<MemberProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadBatchPayload {
    pub members: Vec<Member>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshotPayload {
    pub snapshot_version: u32,
    pub session_id: String,
    pub resume_token: String,
    pub status: String,
    pub current_member_id: Option<String>,
    pub progress_current: u32,
    pub progress_total: u32,
    pub manifest_version: u32,
    pub manifest_hash: String,
    pub manifest_path: String,
    pub failures: Vec<serde_json::Value>,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyPayload {
    pub current_url: String,
    pub session_id: Option<String>,
    pub resume_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningPayload {
    pub current_member_index: u32,
    pub progress: ProgressInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressInfo {
    pub current: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentMemberPayload {
    pub member_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentStepPayload {
    pub step_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    pub current: u32,
    pub total: u32,
    pub status: Option<String>,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailureUpdatedPayload {
    pub member_id: String,
    pub reason: String,
    pub failed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberCompletedPayload {
    pub member_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCompletedPayload {
    pub total_success: u32,
    pub total_failed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
    pub details: Option<serde_json::Value>,
}
