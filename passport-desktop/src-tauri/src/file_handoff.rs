use std::{fs, path::PathBuf, sync::mpsc};
use tauri::{AppHandle, Window};

fn batch_file(batch_path: &str) -> Result<PathBuf, String> {
    let path = fs::canonicalize(batch_path).map_err(|error| format!("File JSON tidak ditemukan: {error}"))?;
    if path.file_name().and_then(|name| name.to_str()) != Some("nusuk-entry-batch.json") {
        return Err("Seret file JSON hasil export EntryMate.".into());
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("File JSON belum dapat dibaca: {error}"))?;
    let batch: serde_json::Value = serde_json::from_str(&content).map_err(|error| format!("File JSON tidak valid: {error}"))?;
    if batch["schemaVersion"] != "nusuk-entry-batch-v1" || !batch["members"].as_array().is_some_and(|members| !members.is_empty()) {
        return Err("File JSON tidak memiliki batch jamaah yang siap.".into());
    }
    Ok(path)
}

#[tauri::command]
pub async fn drag_nusuk_batch(app: AppHandle, window: Window, batch_path: String) -> Result<(), String> {
    let path = batch_file(&batch_path)?;
    let (sender, receiver) = mpsc::channel();
    // OLE/native drag must run on the window's UI thread. Copy leaves the export intact.
    app.run_on_main_thread(move || {
        #[cfg(target_os = "linux")]
        let raw_window = window.gtk_window();
        #[cfg(not(target_os = "linux"))]
        let raw_window = tauri::Result::Ok(window);
        let result = raw_window.map_err(|error| error.to_string()).and_then(|native| {
            drag::start_drag(
                &native,
                drag::DragItem::Files(vec![path]),
                drag::Image::Raw(include_bytes!("../icons/32x32.png").to_vec()),
                |_, _| {},
                drag::Options { mode: drag::DragMode::Copy, ..Default::default() },
            ).map_err(|error| error.to_string())
        });
        let _ = sender.send(result);
    }).map_err(|error| error.to_string())?;
    receiver.recv().map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dragging_requires_an_existing_nonempty_export_file() {
        let folder = std::env::temp_dir().join(format!("entrymate-drag-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&folder).unwrap();
        let path = folder.join("nusuk-entry-batch.json");
        let raw_path = path.to_string_lossy();
        assert!(batch_file(&raw_path).is_err());
        for invalid in ["{", r#"{"schemaVersion":"passport-manifest-v1","members":[{}]}"#, r#"{"schemaVersion":"nusuk-entry-batch-v1","members":[]}"#] {
            fs::write(&path, invalid).unwrap();
            assert!(batch_file(&raw_path).is_err());
        }
        fs::write(&path, r#"{"schemaVersion":"nusuk-entry-batch-v1","members":[{"id":"a-4"}]}"#).unwrap();
        assert_eq!(batch_file(&raw_path).unwrap(), fs::canonicalize(&path).unwrap());
        let other = folder.join("manifest.json");
        fs::rename(&path, &other).unwrap();
        assert!(batch_file(&other.to_string_lossy()).is_err());
        fs::remove_file(other).unwrap();
        fs::remove_dir(folder).unwrap();
    }
}
