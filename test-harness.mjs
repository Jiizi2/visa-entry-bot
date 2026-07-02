// Test Harness for EntryMate WebSocket Protocol Handshake
// Run with: node --experimental-websocket test-harness.mjs

const ports = [9001, 9002, 9003, 9004, 9005];
let currentPortIndex = 0;

function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function runHandshake(port) {
  console.log(`[TestHarness] Mencoba menghubungkan ke ws://127.0.0.1:${port}...`);
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  let sequenceCounter = 0;
  let readyMessageId = null;
  let sessionCreatedMessageId = null;
  let batchLoadedMessageId = null;
  let currentMemberMessageId = null;
  let currentStepMessageId = null;
  let progressMessageId = null;
  let memberCompletedMessageId = null;
  let sessionCompletedMessageId = null;

  ws.onopen = () => {
    console.log(`[TestHarness] Terhubung ke server WebSocket pada port ${port}!`);

    // Send HELLO message
    const correlationId = generateUuid();
    const helloMsg = {
      protocolVersion: 1,
      type: "HELLO",
      messageId: generateUuid(),
      sessionId: "",
      correlationId: correlationId,
      timestamp: new Date().toISOString(),
      sequence: ++sequenceCounter,
      payload: {
        extensionVersion: "1.0.19",
        browser: "chrome",
        capabilities: {
          supportsDebugger: true,
          supportsScreenshot: false,
          supportsResume: true
        }
      }
    };

    console.log(`[TestHarness] Mengirim pesan HELLO...`);
    ws.send(JSON.stringify(helloMsg));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      console.log(`[TestHarness] Menerima pesan dari server: type=${msg.type} sequence=${msg.sequence}`);

      if (msg.type === "HELLO_ACK") {
        console.log(`[TestHarness] HELLO_ACK berhasil diterima! AuthToken: ${msg.payload.authToken}`);
        
        // Send READY message
        readyMessageId = generateUuid();
        const readyMsg = {
          protocolVersion: 1,
          type: "READY",
          messageId: readyMessageId,
          sessionId: "",
          correlationId: msg.correlationId || generateUuid(),
          timestamp: new Date().toISOString(),
          replyToMessageId: msg.messageId,
          sequence: ++sequenceCounter,
          payload: {
            currentUrl: "https://masar.nusuk.sa/en/mutamer/add",
            sessionId: "",
            resumeToken: ""
          }
        };

        console.log(`[TestHarness] Mengirim pesan READY...`);
        ws.send(JSON.stringify(readyMsg));
      } else if (msg.type === "CREATE_SESSION") {
        console.log(`[TestHarness] CREATE_SESSION diterima dari server! SessionID: ${msg.sessionId}`);
        
        // Send SESSION_CREATED response
        sessionCreatedMessageId = generateUuid();
        const sessionCreatedMsg = {
          protocolVersion: 1,
          type: "SESSION_CREATED",
          messageId: sessionCreatedMessageId,
          sessionId: msg.sessionId,
          correlationId: msg.correlationId || generateUuid(),
          timestamp: new Date().toISOString(),
          replyToMessageId: msg.messageId,
          sequence: ++sequenceCounter,
          payload: {
            status: "initialized"
          }
        };

        console.log(`[TestHarness] Mengirim respon SESSION_CREATED...`);
        ws.send(JSON.stringify(sessionCreatedMsg));
      } else if (msg.type === "LOAD_BATCH") {
        console.log(`[TestHarness] LOAD_BATCH diterima dari server! Jumlah mutamer: ${msg.payload.members?.length || 0}`);
        
        // Send BATCH_LOADED response
        batchLoadedMessageId = generateUuid();
        const batchLoadedMsg = {
          protocolVersion: 1,
          type: "BATCH_LOADED",
          messageId: batchLoadedMessageId,
          sessionId: msg.sessionId,
          correlationId: msg.correlationId || generateUuid(),
          timestamp: new Date().toISOString(),
          replyToMessageId: msg.messageId,
          sequence: ++sequenceCounter,
          payload: {}
        };

        console.log(`[TestHarness] Mengirim respon BATCH_LOADED...`);
        ws.send(JSON.stringify(batchLoadedMsg));
      } else if (msg.type === "START") {
        console.log(`[TestHarness] START diterima dari server!`);
        // Send ACK response
        const startAck = {
          protocolVersion: 1,
          type: "ACK",
          messageId: generateUuid(),
          sessionId: msg.sessionId,
          correlationId: msg.correlationId || generateUuid(),
          timestamp: new Date().toISOString(),
          replyToMessageId: msg.messageId,
          sequence: ++sequenceCounter,
          payload: {}
        };
        ws.send(JSON.stringify(startAck));

        // Begin sending automation progress events
        currentMemberMessageId = generateUuid();
        const currentMemberMsg = {
          protocolVersion: 1,
          type: "CURRENT_MEMBER",
          messageId: currentMemberMessageId,
          sessionId: msg.sessionId,
          correlationId: msg.correlationId || generateUuid(),
          timestamp: new Date().toISOString(),
          sequence: ++sequenceCounter,
          payload: {
            memberId: "member-001"
          }
        };
        console.log(`[TestHarness] Mengirim pesan CURRENT_MEMBER...`);
        ws.send(JSON.stringify(currentMemberMsg));
      } else if (msg.type === "ACK") {
        console.log(`[TestHarness] ACK diterima dari server untuk replyToMessageId: ${msg.replyToMessageId}`);
        if (msg.replyToMessageId === readyMessageId) {
          console.log(`[TestHarness] Handshake selesai, menunggu CREATE_SESSION...`);
        } else if (msg.replyToMessageId === sessionCreatedMessageId) {
          console.log(`[TestHarness] Sesi dibuat, menunggu LOAD_BATCH...`);
        } else if (msg.replyToMessageId === batchLoadedMessageId) {
          console.log(`[TestHarness] Batch loaded, menunggu START...`);
        } else if (msg.replyToMessageId === currentMemberMessageId) {
          currentStepMessageId = generateUuid();
          const currentStepMsg = {
            protocolVersion: 1,
            type: "CURRENT_STEP",
            messageId: currentStepMessageId,
            sessionId: msg.sessionId || "",
            correlationId: msg.correlationId || "",
            timestamp: new Date().toISOString(),
            sequence: ++sequenceCounter,
            payload: {
              stepName: "Mengisi Formulir Paspor"
            }
          };
          console.log(`[TestHarness] Mengirim pesan CURRENT_STEP...`);
          ws.send(JSON.stringify(currentStepMsg));
        } else if (msg.replyToMessageId === currentStepMessageId) {
          progressMessageId = generateUuid();
          const progressMsg = {
            protocolVersion: 1,
            type: "PROGRESS",
            messageId: progressMessageId,
            sessionId: msg.sessionId || "",
            correlationId: msg.correlationId || "",
            timestamp: new Date().toISOString(),
            sequence: ++sequenceCounter,
            payload: {
              current: 5,
              total: 10,
              status: "RUNNING",
              revision: 2
            }
          };
          console.log(`[TestHarness] Mengirim pesan PROGRESS...`);
          ws.send(JSON.stringify(progressMsg));
        } else if (msg.replyToMessageId === progressMessageId) {
          memberCompletedMessageId = generateUuid();
          const memberCompletedMsg = {
            protocolVersion: 1,
            type: "MEMBER_COMPLETED",
            messageId: memberCompletedMessageId,
            sessionId: msg.sessionId || "",
            correlationId: msg.correlationId || "",
            timestamp: new Date().toISOString(),
            sequence: ++sequenceCounter,
            payload: {
              memberId: "member-001"
            }
          };
          console.log(`[TestHarness] Mengirim pesan MEMBER_COMPLETED...`);
          ws.send(JSON.stringify(memberCompletedMsg));
        } else if (msg.replyToMessageId === memberCompletedMessageId) {
          sessionCompletedMessageId = generateUuid();
          const sessionCompletedMsg = {
            protocolVersion: 1,
            type: "SESSION_COMPLETED",
            messageId: sessionCompletedMessageId,
            sessionId: msg.sessionId || "",
            correlationId: msg.correlationId || "",
            timestamp: new Date().toISOString(),
            sequence: ++sequenceCounter,
            payload: {}
          };
          console.log(`[TestHarness] Mengirim pesan SESSION_COMPLETED...`);
          ws.send(JSON.stringify(sessionCompletedMsg));
        } else if (msg.replyToMessageId === sessionCompletedMessageId) {
          console.log(`[TestHarness] ✅ OTOMATISASI (AUTOMATION TRIGGER) SUKSES!`);
          ws.close();
          process.exit(0);
        }
      } else if (msg.type === "ERROR") {
        console.error(`[TestHarness] ❌ Menerima pesan ERROR dari server:`, msg.payload);
        ws.close();
        process.exit(1);
      }
    } catch (e) {
      console.error(`[TestHarness] Gagal memparsing pesan:`, e);
      ws.close();
      process.exit(1);
    }
  };

  ws.onerror = (err) => {
    console.error(`[TestHarness] Error koneksi pada port ${port}.`);
  };

  ws.onclose = () => {
    console.log(`[TestHarness] Koneksi ditutup pada port ${port}.`);
    currentPortIndex++;
    if (currentPortIndex < ports.length) {
      setTimeout(() => runHandshake(ports[currentPortIndex]), 1000);
    } else {
      console.error("[TestHarness] ❌ Gagal menghubungkan ke semua port. Pastikan aplikasi Desktop sedang berjalan.");
      process.exit(1);
    }
  };
}

// Start testing first port
runHandshake(ports[currentPortIndex]);
