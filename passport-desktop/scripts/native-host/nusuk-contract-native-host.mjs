#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..", "..");
const bridgeDir = process.env.NUSUK_CONTRACT_DIR
  ? path.resolve(process.env.NUSUK_CONTRACT_DIR)
  : path.join(repoRoot, "bridge-contract");
const commandsDir = path.join(bridgeDir, "commands");
const eventsDir = path.join(bridgeDir, "events");

async function ensureDirs() {
  await fs.mkdir(commandsDir, { recursive: true });
  await fs.mkdir(eventsDir, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteJson(filePath, payload) {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

function nowMs() {
  return Date.now();
}

function parseNativeMessageFromBuffer(buffer) {
  if (buffer.length < 4) {
    return null;
  }
  const bodyLength = buffer.readUInt32LE(0);
  if (buffer.length < 4 + bodyLength) {
    return null;
  }
  const body = buffer.subarray(4, 4 + bodyLength);
  let parsed;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    parsed = {};
  }
  return {
    message: parsed,
    consumed: 4 + bodyLength,
  };
}

function writeNativeMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(header);
  process.stdout.write(body);
}

async function findNextCommandForClient(clientId) {
  const entries = await fs.readdir(commandsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  for (const fileName of files) {
    const filePath = path.join(commandsDir, fileName);
    let payload;
    try {
      payload = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
      continue;
    }
    const status = String(payload.status || "").toLowerCase();
    if (status !== "pending") {
      continue;
    }
    const targetClientId = String(payload.targetClientId || "").trim();
    if (targetClientId && targetClientId !== clientId) {
      continue;
    }
    payload.status = "in_progress";
    payload.pickedAtMs = nowMs();
    payload.pickedByClientId = clientId;
    await atomicWriteJson(filePath, payload);
    return payload;
  }
  return null;
}

async function pushEvent(message) {
  const id = `evt-${nowMs()}-${Math.random().toString(16).slice(2, 8)}`;
  const payload = {
    version: "1.0",
    id,
    createdAtMs: nowMs(),
    type: String(message.eventType || "event"),
    source: String(message.source || "extension"),
    clientId: String(message.clientId || "").trim(),
    payload: message.payload && typeof message.payload === "object" ? message.payload : {},
  };
  const eventPath = path.join(eventsDir, `${id}.json`);
  await atomicWriteJson(eventPath, payload);
  return payload;
}

async function handleMessage(message) {
  await ensureDirs();
  const messageType = String(message?.type || "").trim().toLowerCase();

  if (messageType === "register_client") {
    const payload = await pushEvent({
      eventType: "client_registered",
      source: String(message.source || "extension"),
      clientId: String(message.clientId || ""),
      payload: {
        tabs: Array.isArray(message.tabs) ? message.tabs : [],
      },
    });
    return { ok: true, eventId: payload.id };
  }

  if (messageType === "push_event") {
    const payload = await pushEvent(message);
    return { ok: true, eventId: payload.id };
  }

  if (messageType === "pull_command") {
    const clientId = String(message.clientId || "").trim();
    if (!clientId) {
      return { ok: false, error: "clientId kosong" };
    }
    const command = await findNextCommandForClient(clientId);
    return { ok: true, command };
  }

  if (messageType === "health") {
    return {
      ok: true,
      bridgeDir,
      commandsDir,
      eventsDir,
    };
  }

  return { ok: false, error: `Message type tidak dikenali: ${messageType}` };
}

let incomingBuffer = Buffer.alloc(0);
process.stdin.on("data", async (chunk) => {
  incomingBuffer = Buffer.concat([incomingBuffer, chunk]);
  while (true) {
    const parsed = parseNativeMessageFromBuffer(incomingBuffer);
    if (!parsed) {
      break;
    }
    incomingBuffer = incomingBuffer.subarray(parsed.consumed);
    try {
      const response = await handleMessage(parsed.message);
      writeNativeMessage(response);
    } catch (error) {
      writeNativeMessage({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});

if (!(await fileExists(bridgeDir))) {
  await ensureDirs();
}
