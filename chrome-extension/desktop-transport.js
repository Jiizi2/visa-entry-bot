// One transport per extension, owned by the background service worker.
(function () {
  function createDesktopTransport({ WebSocket, getUrl, version, save, notify, deliver, initial = {}, timers = globalThis, now = Date.now, uuid = () => crypto.randomUUID() }) {
    const ports = [9001, 9002, 9003, 9004, 9005];
    let portIndex = Math.max(0, ports.indexOf(initial.port));
    let socket = null;
    let retryTimer = null;
    let deadline = null;
    let heartbeat = null;
    let sequence = 0;
    let receivedSequence = 0;
    let readyMessageId = "";
    let lastSeen = now();
    let lastTick = now();
    let recoveryStarted = null;
    let saveChain = Promise.resolve();
    let messageChain = Promise.resolve();
    let pending = initial.pending || [];
    let snapshot = null;
    const state = {
      connectionState: "disconnected",
      activeSessionId: initial.activeSessionId || "",
      resumeToken: initial.resumeToken || "",
      port: ports[portIndex],
      reconnectCount: 0,
      heartbeatTimeout: 0,
      rttValues: [],
      droppedSeq: 0,
      duplicatePackets: 0,
      recoverySuccess: 0,
      recoveryTime: 0,
    };

    function persist() {
      const saved = { activeSessionId: state.activeSessionId, resumeToken: state.resumeToken, port: state.port, pending: pending.slice() };
      saveChain = saveChain.catch(() => {}).then(() => save(saved));
      return saveChain;
    }

    function setState(value) {
      state.connectionState = value;
      notify({ ...state });
    }

    function resetSession() {
      state.activeSessionId = state.resumeToken = "";
      snapshot = null;
      pending = [];
      void persist();
      notify({ ...state });
    }

    function clearTimers() {
      timers.clearTimeout(retryTimer);
      timers.clearTimeout(deadline);
      timers.clearInterval(heartbeat);
      retryTimer = deadline = heartbeat = null;
    }

    function send(type, payload = {}, replyTo, correlationId) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return null;
      const messageId = uuid();
      socket.send(JSON.stringify({
        protocolVersion: 1, type, messageId,
        sessionId: state.activeSessionId,
        correlationId: correlationId || uuid(),
        timestamp: new Date(now()).toISOString(), sequence: ++sequence,
        ...(replyTo ? { replyToMessageId: replyTo } : {}), payload,
      }));
      return messageId;
    }

    async function sendReady(ws = socket) {
      const currentUrl = await getUrl();
      if (socket !== ws || ws?.readyState !== WebSocket.OPEN) return;
      readyMessageId = send("READY", { currentUrl, sessionId: state.activeSessionId || null, resumeToken: state.resumeToken || null });
      if (state.activeSessionId && recoveryStarted === null) recoveryStarted = now();
      timers.clearTimeout(deadline);
      deadline = timers.setTimeout(() => fail(ws), 10000);
    }

    function fail(ws) {
      if (ws !== socket) return;
      clearTimers();
      socket = null;
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try { ws.close(); } catch (_) {}
      state.reconnectCount++;
      setState("disconnected");
      // Try the successful port first after a loss; scan quickly if unavailable.
      if (ws.wasReady !== true) portIndex = (portIndex + 1) % ports.length;
      retryTimer = timers.setTimeout(connect, ws.wasReady ? 500 : portIndex === 0 ? 3000 : 250);
    }

    function startHeartbeat(ws) {
      heartbeat = timers.setInterval(() => {
        if (ws !== socket) return;
        const time = now();
        // Give Chrome/Windows time to deliver buffered replies after sleep.
        if (time - lastTick > 30000) lastSeen = time;
        lastTick = time;
        if (time - lastSeen > 45000) {
          state.heartbeatTimeout++;
          fail(ws);
          return;
        }
        try { send("PING", { clientTime: time }); } catch (_) { fail(ws); }
      }, 10000);
    }

    function flushPending() {
      const queued = pending;
      if (queued.length === 0) return false;
      pending = [];
      for (const event of queued) {
        send(event.type, event.payload);
        if (event.type === "STOP") { resetSession(); break; }
      }
      void persist();
      return queued.length > 0;
    }

    async function receive(ws, raw) {
      if (ws !== socket) return;
      const envelope = JSON.parse(raw);
      if (envelope.sequence && envelope.sequence <= receivedSequence) {
        if (envelope.sequence === receivedSequence) state.duplicatePackets++;
        else state.droppedSeq++;
        notify({ ...state });
        return;
      }
      receivedSequence = envelope.sequence || receivedSequence;
      lastSeen = now();
      switch (envelope.type) {
        case "HELLO_ACK":
          setState(state.activeSessionId ? "recovering" : "authenticating");
          startHeartbeat(ws);
          await sendReady(ws);
          break;
        case "ACK":
          if (envelope.replyToMessageId === readyMessageId) {
            timers.clearTimeout(deadline);
            if (envelope.payload.sessionReset) {
              state.activeSessionId = state.resumeToken = "";
              snapshot = null;
              pending = [];
            }
            ws.wasReady = true;
            setState("ready");
            await persist();
            flushPending();
          }
          break;
        case "SESSION_SNAPSHOT":
          timers.clearTimeout(deadline);
          state.activeSessionId = envelope.payload.sessionId;
          state.resumeToken = envelope.payload.resumeToken;
          snapshot = envelope.payload;
          ws.wasReady = true;
          if (recoveryStarted !== null) {
            state.recoveryTime = now() - recoveryStarted;
            state.recoverySuccess++;
            recoveryStarted = null;
          }
          setState("ready");
          await persist();
          // Replay offline progress before recovering execution from a snapshot.
          if (flushPending()) { await sendReady(ws); return; }
          await deliver(envelope);
          break;
        case "CREATE_SESSION":
        case "LOAD_BATCH":
          state.activeSessionId = envelope.sessionId || envelope.payload.sessionId || state.activeSessionId;
          state.resumeToken = envelope.payload.resumeToken || state.resumeToken;
          if (envelope.type === "LOAD_BATCH") {
            snapshot = { sessionId: state.activeSessionId, resumeToken: state.resumeToken, status: "CREATED", manifestMembers: envelope.payload.members, manifestPath: envelope.payload.manifestPath, revision: 0 };
          }
          await persist();
          if (await deliver(envelope) !== false) {
            if (snapshot && envelope.type === 'LOAD_BATCH') snapshot.status = 'BATCH_LOADED';
            send(envelope.type === "LOAD_BATCH" ? "BATCH_LOADED" : "SESSION_CREATED", { status: "initialized" }, envelope.messageId, envelope.correlationId);
          }
          break;
        case "START":
        case "NEXT":
        case "PAUSE":
        case "STOP":
          if (await deliver(envelope) !== false) {
            if (snapshot && ["START", "NEXT"].includes(envelope.type)) snapshot.status = "RUNNING";
            if (envelope.type === "STOP") resetSession();
            send("ACK", {}, envelope.messageId, envelope.correlationId);
          }
          break;
        case "PING":
          send("PONG", envelope.payload, envelope.messageId, envelope.correlationId);
          break;
        case "PONG":
          if (typeof envelope.payload.clientTime === "number") {
            state.rttValues = [...state.rttValues, now() - envelope.payload.clientTime].slice(-50);
            notify({ ...state });
          }
          break;
        default:
          await deliver(envelope);
      }
    }

    function connect() {
      // Repeated wakeups, panel opens and retries must not replace a live socket.
      if (socket && socket.readyState <= WebSocket.OPEN) return;
      clearTimers();
      state.port = ports[portIndex];
      setState("connecting");
      const ws = socket = new WebSocket(`ws://127.0.0.1:${state.port}`);
      sequence = receivedSequence = 0;
      recoveryStarted = null;
      lastSeen = lastTick = now();
      deadline = timers.setTimeout(() => fail(ws), 8000);
      ws.onopen = () => {
        if (ws !== socket) return;
        setState("authenticating");
        send("HELLO", { extensionVersion: version, browser: "chrome", capabilities: { supportsDebugger: true, supportsScreenshot: false, supportsResume: true, supportsHandoff: true } });
      };
      ws.onmessage = event => {
        messageChain = messageChain.catch(() => {}).then(() => receive(ws, event.data)).catch(error => console.error("[Transport]", error));
      };
      ws.onclose = ws.onerror = () => fail(ws);
    }

    function sendEvent(event) {
      const { eventType: type, ...payload } = event;
      if (!["RUNNING", "CURRENT_MEMBER", "CURRENT_STEP", "PROGRESS", "FAILURE_UPDATED", "MEMBER_COMPLETED", "SESSION_COMPLETED", "STOP"].includes(type)) return;
      // Manual JSON entry has no desktop session to report progress to.
      if (!state.activeSessionId && type !== "STOP") return;
      if (type === "STOP") snapshot = null;
      if (snapshot) {
        if (type === 'RUNNING') snapshot.status = 'RUNNING';
        if (type === "CURRENT_MEMBER") { snapshot.currentMemberId = payload.memberId; snapshot.status = "RUNNING"; }
        if (type === "PROGRESS") Object.assign(snapshot, { progressCurrent: payload.current, progressTotal: payload.total, status: payload.status || snapshot.status });
        if (type === "MEMBER_COMPLETED") {
          snapshot.completedMemberIds = [...new Set([...(snapshot.completedMemberIds || []), payload.memberId])];
          snapshot.currentMemberId = null;
        }
        if (type === "SESSION_COMPLETED") snapshot.status = "COMPLETED";
      }
      if (state.connectionState === "ready") {
        try {
          if (send(type, payload)) {
            if (type === "STOP") resetSession();
            return;
          }
        } catch (_) { fail(socket); }
      }
      // Keep critical completion events and the latest progress during a brief outage.
      if (["PROGRESS", "CURRENT_STEP"].includes(type)) pending = pending.filter(item => item.type !== type);
      pending.push({ type, payload });
      pending = pending.slice(-200);
      void persist();
      connect();
    }

    return { connect, sendEvent, sendReady, reply: send, getState: () => ({ ...state }), getSnapshot: () => snapshot };
  }

  globalThis.createDesktopTransport = createDesktopTransport;
})();
