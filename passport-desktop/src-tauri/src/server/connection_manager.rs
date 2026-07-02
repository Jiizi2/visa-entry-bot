use crate::transport::websocket::ClientId;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::sync::RwLock;
use tokio::sync::mpsc;

#[derive(Clone, Debug)]
pub struct ClientConnection {
    pub id: ClientId,
    pub addr: SocketAddr,
    pub connected_at: chrono::DateTime<chrono::Utc>,
    pub sender: mpsc::UnboundedSender<String>,
    pub handshake_completed: bool,
    pub browser: Option<String>,
    pub extension_version: Option<String>,
    pub outgoing_sequence: Arc<AtomicU64>,
    pub incoming_sequence: Arc<AtomicU64>,
}

pub struct ConnectionManager {
    clients: RwLock<HashMap<ClientId, ClientConnection>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            clients: RwLock::new(HashMap::new()),
        }
    }

    pub fn register_client(&self, id: ClientId, sender: mpsc::UnboundedSender<String>, addr: SocketAddr) {
        let mut clients = self.clients.write().unwrap();
        let connection = ClientConnection {
            id,
            addr,
            connected_at: chrono::Utc::now(),
            sender,
            handshake_completed: false,
            browser: None,
            extension_version: None,
            outgoing_sequence: Arc::new(AtomicU64::new(0)),
            incoming_sequence: Arc::new(AtomicU64::new(0)),
        };
        clients.insert(id, connection);
        println!("[Transport] Klien terhubung: {} (Address: {})", id, addr);
    }

    pub fn unregister_client(&self, id: ClientId) -> Option<ClientConnection> {
        let mut clients = self.clients.write().unwrap();
        let removed = clients.remove(&id);
        if let Some(ref conn) = removed {
            println!("[Transport] Klien terputus: {} (Address: {})", id, conn.addr);
        }
        removed
    }

    pub fn complete_handshake(&self, id: ClientId, browser: String, extension_version: String) -> bool {
        let mut clients = self.clients.write().unwrap();
        if let Some(conn) = clients.get_mut(&id) {
            conn.handshake_completed = true;
            conn.browser = Some(browser);
            conn.extension_version = Some(extension_version);
            println!("[Protocol] Handshake selesai untuk klien: {}", id);
            true
        } else {
            false
        }
    }

    pub fn is_client_ready(&self, id: ClientId) -> bool {
        let clients = self.clients.read().unwrap();
        clients.get(&id).map(|c| c.handshake_completed).unwrap_or(false)
    }

    pub fn send_to(&self, id: ClientId, text: String) -> Result<(), String> {
        let clients = self.clients.read().unwrap();
        if let Some(conn) = clients.get(&id) {
            conn.sender.send(text).map_err(|e| format!("Ggal mengirim ke channel: {:?}", e))
        } else {
            Err(format!("Klien dengan ID {} tidak terdaftar.", id))
        }
    }

    pub fn broadcast(&self, text: String) {
        let clients = self.clients.read().unwrap();
        for (id, conn) in clients.iter() {
            if let Err(e) = conn.sender.send(text.clone()) {
                eprintln!("[Transport] Gagal broadcast ke klien {}: {:?}", id, e);
            }
        }
    }

    pub fn get_client_info(&self, id: ClientId) -> Option<ClientConnection> {
        let clients = self.clients.read().unwrap();
        clients.get(&id).cloned()
    }

    pub fn get_active_client_ids(&self) -> Vec<ClientId> {
        let clients = self.clients.read().unwrap();
        clients.keys().cloned().collect()
    }

    pub fn next_outgoing_sequence(&self, id: ClientId) -> u64 {
        let clients = self.clients.read().unwrap();
        if let Some(conn) = clients.get(&id) {
            conn.outgoing_sequence.fetch_add(1, Ordering::SeqCst) + 1
        } else {
            1
        }
    }

    pub fn check_incoming_sequence(&self, id: ClientId, sequence: u64) -> bool {
        let clients = self.clients.read().unwrap();
        if let Some(conn) = clients.get(&id) {
            let current = conn.incoming_sequence.load(Ordering::SeqCst);
            if sequence > current {
                conn.incoming_sequence.store(sequence, Ordering::SeqCst);
                true
            } else {
                false
            }
        } else {
            false
        }
    }
}
