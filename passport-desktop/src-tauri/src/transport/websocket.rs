use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

pub type ClientId = Uuid;

#[derive(Debug)]
pub enum TransportEvent {
    Connect {
        client_id: ClientId,
        sender: mpsc::UnboundedSender<String>,
        addr: SocketAddr,
    },
    Disconnect {
        client_id: ClientId,
    },
    Message {
        client_id: ClientId,
        text: String,
    },
}

pub struct WebSocketServer {
    event_tx: mpsc::UnboundedSender<TransportEvent>,
}

impl WebSocketServer {
    pub fn new(event_tx: mpsc::UnboundedSender<TransportEvent>) -> Self {
        Self { event_tx }
    }

    pub async fn start(self: Arc<Self>, port_range: std::ops::RangeInclusive<u16>) -> Result<u16, String> {
        let mut listener = None;
        let mut active_port = 0;

        for port in port_range {
            let addr = SocketAddr::from(([127, 0, 0, 1], port));
            match TcpListener::bind(addr).await {
                Ok(l) => {
                    listener = Some(l);
                    active_port = port;
                    break;
                }
                Err(_) => {
                    // Try next port in range
                    continue;
                }
            }
        }

        let listener = listener.ok_or_else(|| {
            "Ggal melakukan binding pada rentang port port 9001-9005 lokal loopback.".to_string()
        })?;

        println!("[Transport] Server WebSocket mendengarkan pada ws://127.0.0.1:{}", active_port);

        let server_clone = self.clone();
        tokio::spawn(async move {
            while let Ok((stream, addr)) = listener.accept().await {
                let server = server_clone.clone();
                tokio::spawn(async move {
                    if let Err(e) = server.handle_connection(stream, addr).await {
                        eprintln!("[Transport] Error dalam penanganan koneksi: {:?}", e);
                    }
                });
            }
        });

        Ok(active_port)
    }

    async fn handle_connection(&self, stream: TcpStream, addr: SocketAddr) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let ws_stream = tokio_tungstenite::accept_async(stream).await?;
        let (mut ws_write, mut ws_read) = ws_stream.split();
        let client_id = Uuid::new_v4();

        // Channel for writing to this specific client
        let (write_tx, mut write_rx) = mpsc::unbounded_channel::<String>();

        // Notify of connection
        self.event_tx.send(TransportEvent::Connect {
            client_id,
            sender: write_tx,
            addr,
        })?;

        // Spawn a task to handle writing to the socket
        let write_task = tokio::spawn(async move {
            while let Some(msg) = write_rx.recv().await {
                if let Err(e) = ws_write.send(Message::Text(msg)).await {
                    eprintln!("[Transport] Gagal mengirim pesan ke klien {}: {:?}", client_id, e);
                    break;
                }
            }
            let _ = ws_write.close().await;
        });

        // Loop to handle reading from the socket
        while let Some(result) = ws_read.next().await {
            match result {
                Ok(msg) => match msg {
                    Message::Text(text) => {
                        let _ = self.event_tx.send(TransportEvent::Message {
                            client_id,
                            text,
                        });
                    }
                    Message::Binary(bin) => {
                        if let Ok(text) = String::from_utf8(bin) {
                            let _ = self.event_tx.send(TransportEvent::Message {
                                client_id,
                                text,
                            });
                        }
                    }
                    Message::Ping(payload) => {
                        // Tungstenite automatically responds to Pings, but we can log if needed
                        let _ = self.event_tx.send(TransportEvent::Message {
                            client_id,
                            text: format!("PING:{}", String::from_utf8_lossy(&payload)),
                        });
                    }
                    Message::Close(_) => {
                        break;
                    }
                    _ => {}
                },
                Err(e) => {
                    eprintln!("[Transport] Error membaca pesan dari klien {}: {:?}", client_id, e);
                    break;
                }
            }
        }

        // Clean up connection
        write_task.abort();
        let _ = self.event_tx.send(TransportEvent::Disconnect { client_id });
        Ok(())
    }
}
