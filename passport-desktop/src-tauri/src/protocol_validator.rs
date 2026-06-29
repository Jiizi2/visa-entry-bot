use crate::protocol::{Envelope, ErrorPayload};
use serde_json::Value;

pub const CURRENT_PROTOCOL_VERSION: u32 = 1;

pub struct ProtocolValidator;

impl ProtocolValidator {
    pub fn validate(raw_json: &str) -> Result<Envelope, ErrorPayload> {
        // Step 1: Parse to generic JSON Value first to inspect structure
        let val: Value = match serde_json::from_str(raw_json) {
            Ok(v) => v,
            Err(e) => {
                return Err(ErrorPayload {
                    code: "ERR_INVALID_JSON".to_string(),
                    message: format!("Format JSON tidak valid: {}", e),
                    recoverable: true,
                    details: None,
                });
            }
        };

        // Step 2: Validate protocol version compatibility before parsing envelope fully
        if let Some(version_val) = val.get("protocolVersion") {
            if let Some(version) = version_val.as_u64() {
                if version as u32 != CURRENT_PROTOCOL_VERSION {
                    return Err(ErrorPayload {
                        code: "ERR_INCOMPATIBLE_PROTOCOL".to_string(),
                        message: format!(
                            "Versi protokol tidak didukung. Server menggunakan v{}, klien mengirim v{}.",
                            CURRENT_PROTOCOL_VERSION, version
                        ),
                        recoverable: false,
                        details: None,
                    });
                }
            } else {
                return Err(ErrorPayload {
                    code: "ERR_INVALID_ENVELOPE".to_string(),
                    message: "Parameter 'protocolVersion' harus berupa angka.".to_string(),
                    recoverable: true,
                    details: None,
                });
            }
        } else {
            return Err(ErrorPayload {
                code: "ERR_INVALID_ENVELOPE".to_string(),
                message: "Parameter 'protocolVersion' tidak ditemukan dalam envelope.".to_string(),
                recoverable: true,
                details: None,
            });
        }

        // Step 3: Parse into Envelope struct
        let envelope: Envelope = match serde_json::from_value(val) {
            Ok(env) => env,
            Err(e) => {
                return Err(ErrorPayload {
                    code: "ERR_INVALID_ENVELOPE".to_string(),
                    message: format!("Envelope pesan tidak lengkap atau tidak valid: {}", e),
                    recoverable: true,
                    details: None,
                });
            }
        };

        // Step 4: Validate required basic parameters
        if envelope.message_id.trim().is_empty() {
            return Err(ErrorPayload {
                code: "ERR_INVALID_ENVELOPE".to_string(),
                message: "Parameter 'messageId' tidak boleh kosong.".to_string(),
                recoverable: true,
                details: None,
            });
        }

        if envelope.timestamp.trim().is_empty() {
            return Err(ErrorPayload {
                code: "ERR_INVALID_ENVELOPE".to_string(),
                message: "Parameter 'timestamp' tidak boleh kosong.".to_string(),
                recoverable: true,
                details: None,
            });
        }

        Ok(envelope)
    }
}
