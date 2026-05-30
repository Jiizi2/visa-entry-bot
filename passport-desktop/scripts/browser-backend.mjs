import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const repoRoot = resolve(appRoot, "..");
const srcRoot = join(appRoot, "src");
const clients = new Set();
const args = parseArgs(process.argv.slice(2));
const scanState = {
  inProgress: false,
  child: null,
  cancelRequested: false,
  stderrLines: [],
  sawComplete: false,
  sawFailure: false,
  stdoutBuffer: "",
};

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, { ok: false, error: errorMessage(error) });
  });
});

server.listen(args.port, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : args.port;
  const url = `http://127.0.0.1:${port}/index.html`;
  console.log(`browser-backend listening at ${url}`);
  if (!args.noOpen) {
    openBrowser(url);
  }
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => {
  if (scanState.child) {
    terminateChildTree(scanState.child.pid);
  }
});

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/api/events") {
    return handleEvents(request, response);
  }
  if (request.method === "GET" && url.pathname === "/api/file") {
    return serveFilePath(response, url.searchParams.get("path") || "");
  }
  if (request.method === "POST" && url.pathname === "/api/open-directory") {
    const body = await readJsonBody(request);
    const selected = await openDirectoryDialog(body?.options || {});
    return sendJson(response, 200, { ok: true, result: selected });
  }
  if (request.method === "POST" && url.pathname === "/api/invoke") {
    const body = await readJsonBody(request);
    const result = await handleInvoke(body?.command, body?.args || {});
    return sendJson(response, 200, { ok: true, result });
  }
  if (request.method === "GET" || request.method === "HEAD") {
    return serveStatic(response, url.pathname, request.method === "HEAD");
  }
  sendText(response, 405, "Method not allowed");
}

function handleEvents(request, response) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  response.write(": connected\n\n");
  clients.add(response);
  request.on("close", () => {
    clients.delete(response);
  });
}

async function handleInvoke(command, args) {
  switch (String(command || "")) {
    case "prepare_passport_images":
      return preparePassportImages(args.selectedDir);
    case "start_scan":
      return startScan(args);
    case "stop_scan":
      return stopScan();
    case "load_manifest":
      return loadManifest(args.manifestPath);
    case "save_manifest":
      return saveManifest(args.manifestPath, args.manifestData);
    case "find_manifest_path":
      return findManifestPath(args.basePath);
    case "resolve_passport_image_path":
      return resolvePassportImagePath(args.manifestPath, args.imagePath, args.fileName);
    case "load_passport_image_data":
      return loadPassportImageData(args.manifestPath, args.imagePath, args.fileName);
    case "save_cropped_passport_image":
      return saveCroppedPassportImage(args);
    case "save_prepared_passport_image":
      return savePreparedPassportImage(args);
    case "create_nusuk_batch":
      return createNusukBatch(args.manifestPath, args.selectedIds, args.manifestData);
    default:
      throw new Error(`Command tidak dikenal: ${command}`);
  }
}

async function startScan(args) {
  const selectedDir = String(args?.selectedDir || "").trim();
  if (!selectedDir) {
    throw new Error("Folder passport belum dipilih.");
  }
  if (scanState.inProgress) {
    throw new Error("Scan sedang berjalan. Tunggu proses saat ini selesai.");
  }

  const ocrMode = normalizeOcrMode(args?.ocrMode);
  const preparedManifestPath = String(args?.preparedManifestPath || "").trim();
  const worker = locateWorkerPaths();
  scanState.inProgress = true;
  scanState.cancelRequested = false;
  scanState.stderrLines = [];
  scanState.sawComplete = false;
  scanState.sawFailure = false;
  scanState.stdoutBuffer = "";

  const child = spawn(
    worker.pythonExecutable,
    ["-u", worker.workerScript, selectedDir, ocrMode, ...(preparedManifestPath ? [preparedManifestPath] : [])],
    {
      cwd: join(worker.repoRoot, "python-ocr"),
      env: { ...process.env, PASSPORT_OCR_PROFILE: ocrMode },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  scanState.child = child;

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", handleWorkerStdout);
  child.stderr.on("data", (chunk) => {
    scanState.stderrLines.push(String(chunk || ""));
  });
  child.on("error", (error) => {
    emitFatalScanError("BROWSER_BACKEND_WORKER_START_FAILED", errorMessage(error), "worker_spawn");
    clearScanState();
  });
  child.on("close", (code) => {
    handleWorkerExit(code);
  });

  return null;
}

async function preparePassportImages(selectedDir) {
  const folder = String(selectedDir || "").trim();
  if (!folder) {
    throw new Error("Folder passport belum dipilih.");
  }
  const worker = locateWorkerPaths();
  let stdout = "";
  let stderr = "";
  try {
    const output = await execFilePromise(
      worker.pythonExecutable,
      ["-u", worker.workerScript, "--prepare", folder],
      {
        cwd: join(worker.repoRoot, "python-ocr"),
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 20,
      },
    );
    stdout = output.stdout;
    stderr = output.stderr;
  } catch (error) {
    stdout = error?.stdout || "";
    stderr = error?.stderr || errorMessage(error);
  }

  let session = null;
  let failure = "";
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const payload = JSON.parse(trimmed);
      if (payload?.event === "prepare_complete") {
        session = payload.session || null;
      } else if (payload?.event === "prepare_failed" || payload?.event === "scan_error") {
        failure = payload.message || failure;
      }
    } catch {
      // Plain logs are ignored here; the UI writes its own prepare status.
    }
  }

  if (session) {
    return session;
  }
  throw new Error(failure || String(stderr || "").trim() || "Prepare worker selesai tanpa mengirim daftar foto.");
}

function stopScan() {
  if (!scanState.inProgress || !scanState.child) {
    throw new Error("Tidak ada proses scan yang sedang berjalan.");
  }
  scanState.cancelRequested = true;
  emitScanEvent({
    event: "scan_cancel_requested",
    message: "Permintaan stop scan dikirim. Worker OCR sedang dihentikan.",
  });
  terminateChildTree(scanState.child.pid);
  return null;
}

function handleWorkerStdout(chunk) {
  scanState.stdoutBuffer += String(chunk || "");
  const lines = scanState.stdoutBuffer.split(/\r?\n/);
  scanState.stdoutBuffer = lines.pop() || "";
  for (const line of lines) {
    handleWorkerLine(line);
  }
}

function handleWorkerLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) {
    return;
  }
  try {
    const payload = JSON.parse(trimmed);
    if (payload?.event === "scan_complete") {
      scanState.sawComplete = true;
    }
    if (payload?.event === "scan_failed") {
      scanState.sawFailure = true;
    }
    emitScanEvent(payload);
  } catch {
    emitScanEvent({ event: "scan_log", message: trimmed });
  }
}

function handleWorkerExit(code) {
  if (scanState.stdoutBuffer.trim()) {
    handleWorkerLine(scanState.stdoutBuffer);
  }

  const stderr = scanState.stderrLines.join("").trim();
  if (scanState.cancelRequested && !scanState.sawComplete) {
    emitScanEvent({
      event: "scan_stopped",
      message: "Proses scan dihentikan oleh pengguna.",
    });
    clearScanState();
    return;
  }

  if (code !== 0 && !scanState.sawFailure) {
    const message = stderr || `Worker Python berhenti dengan kode ${code}.`;
    emitFatalScanError("BROWSER_BACKEND_WORKER_NON_ZERO_EXIT", message, "worker_exit");
  } else if (code === 0 && !scanState.sawComplete) {
    emitFatalScanError(
      "BROWSER_BACKEND_WORKER_MISSING_COMPLETE",
      "Worker Python selesai tanpa mengirim hasil akhir scan.",
      "worker_exit",
    );
  }
  clearScanState();
}

function emitFatalScanError(code, message, stage) {
  emitScanEvent({
    event: "scan_error",
    code,
    message,
    stage,
    fatal: true,
  });
  emitScanEvent({
    event: "scan_failed",
    message: `[${code}] ${message}`,
  });
}

function clearScanState() {
  scanState.inProgress = false;
  scanState.child = null;
  scanState.cancelRequested = false;
  scanState.stderrLines = [];
  scanState.sawComplete = false;
  scanState.sawFailure = false;
  scanState.stdoutBuffer = "";
}

function emitScanEvent(payload) {
  const data = JSON.stringify(payload);
  for (const client of clients) {
    client.write(`event: scan-event\ndata: ${data}\n\n`);
  }
}

async function loadManifest(manifestPath) {
  const path = requiredPath(manifestPath, "Manifest belum dipilih.");
  const content = await readFile(path, "utf8");
  return JSON.parse(content);
}

async function saveManifest(manifestPath, manifestData) {
  const path = requiredPath(manifestPath, "Lokasi manifest tidak valid.");
  if (!isManifestFile(path)) {
    throw new Error("Lokasi manifest tidak valid.");
  }
  if (!Array.isArray(manifestData?.members)) {
    throw new Error("Manifest tidak memiliki daftar members.");
  }
  await writeFile(path, `${JSON.stringify(manifestData, null, 2)}\n`, "utf8");
  return null;
}

async function findManifestPath(basePath) {
  const base = String(basePath || "").trim();
  if (!base) {
    return null;
  }
  if (!existsSync(base)) {
    return null;
  }
  const baseInfo = await stat(base);
  if (baseInfo.isFile() && await isPassportManifestFile(base)) {
    return base;
  }
  if (!baseInfo.isDirectory()) {
    return null;
  }

  const directManifest = join(base, "manifest.json");
  if (existsSync(directManifest) && await isPassportManifestFile(directManifest)) {
    return directManifest;
  }

  let best = null;
  const stack = [{ dir: base, depth: 0 }];
  while (stack.length) {
    const current = stack.pop();
    if (!current || current.depth > 6) {
      continue;
    }
    let entries = [];
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < 6 && !shouldSkipSearchDir(path)) {
          stack.push({ dir: path, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile() || !(await isPassportManifestFile(path))) {
        continue;
      }
      const modifiedMs = await safeModifiedMs(path);
      if (!best || current.depth < best.depth || (current.depth === best.depth && modifiedMs > best.modifiedMs)) {
        best = { path, depth: current.depth, modifiedMs };
      }
    }
  }
  return best?.path || null;
}

async function resolvePassportImagePath(manifestPath, imagePath, fileName) {
  for (const candidate of passportImageCandidates(manifestPath, imagePath, fileName)) {
    if (await isSupportedImage(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function loadPassportImageData(manifestPath, imagePath, fileName) {
  for (const candidate of passportImageCandidates(manifestPath, imagePath, fileName)) {
    const mimeType = imageMimeType(candidate);
    if (!mimeType || !(await isSupportedImage(candidate))) {
      continue;
    }
    const bytes = await readFile(candidate);
    return {
      path: candidate,
      dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    };
  }
  return null;
}

async function saveCroppedPassportImage(args = {}) {
  const manifestPath = requiredPath(args.manifestPath, "Lokasi manifest tidak valid.");
  if (!isManifestFile(manifestPath)) {
    throw new Error("Lokasi manifest tidak valid.");
  }
  const outputDir = join(dirname(manifestPath), "nusuk-crops");
  await mkdir(outputDir, { recursive: true });
  const bytes = decodeImageDataUrl(args.dataUrl);
  const fileBase = cropFileBaseName(args.memberId, args.fileName, args.sourceImagePath);
  const outputPath = join(outputDir, `${fileBase}.jpg`);
  await writeFile(outputPath, bytes);
  const relativePath = relative(repoRoot, outputPath).replace(/\\/g, "/");
  return {
    path: outputPath,
    relativePath: relativePath && !relativePath.startsWith("..") ? relativePath : outputPath,
  };
}

async function savePreparedPassportImage(args = {}) {
  const manifestPath = resolvePreparedManifestPath(args.preparedManifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest?.schemaVersion !== "passport-prepared-inputs-v1" || !Array.isArray(manifest.items)) {
    throw new Error("Prepared manifest tidak dikenali.");
  }

  const outputDir = join(dirname(manifestPath), "edited-images");
  await mkdir(outputDir, { recursive: true });
  const bytes = decodeImageDataUrl(args.dataUrl);
  const fileBase = cropFileBaseName(args.itemId, "", args.sourceImagePath);
  const outputPath = join(outputDir, `${fileBase}.jpg`);
  await writeFile(outputPath, bytes);

  const item = manifest.items.find((candidate) => String(candidate?.id || "") === String(args.itemId || ""));
  if (!item) {
    throw new Error("Prepared item tidak ditemukan.");
  }
  item.editedPath = outputPath;
  item.rotationDegrees = Number(args.rotationDegrees || 0);
  item.cropMetadata = args.crop && typeof args.crop === "object" ? args.crop : {};
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function resolvePreparedManifestPath(value) {
  const rawPath = requiredPath(value, "Lokasi prepared manifest tidak valid.");
  const candidate = resolve(rawPath);
  if (existsSync(candidate) && basename(candidate).toLowerCase() === "prepared-inputs.json") {
    return candidate;
  }
  const nested = join(candidate, ".passport-assistant-prepared", "prepared-inputs.json");
  if (existsSync(nested)) {
    return nested;
  }
  throw new Error(`Prepared manifest tidak ditemukan: ${rawPath}`);
}

function decodeImageDataUrl(value) {
  const text = String(value || "").trim();
  const match = /^data:image\/jpe?g;base64,(.+)$/i.exec(text);
  if (!match) {
    throw new Error("Payload crop harus berupa JPEG base64.");
  }
  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length) {
    throw new Error("Hasil crop kosong.");
  }
  if (bytes.length > 25 * 1024 * 1024) {
    throw new Error("Hasil crop terlalu besar.");
  }
  return bytes;
}

function cropFileBaseName(memberId, fileName, sourceImagePath) {
  const sourceStem = stripFileExtension(basename(String(fileName || sourceImagePath || "passport")));
  const memberSuffix = sanitizeFileSegment(memberId).slice(0, 8);
  const stem = sanitizeFileSegment(sourceStem);
  return memberSuffix ? `${stem}-${memberSuffix}-crop` : `${stem}-crop`;
}

function stripFileExtension(value) {
  return String(value || "").replace(/\.[^.\\/]+$/, "");
}

function sanitizeFileSegment(value) {
  const text = String(value || "").trim();
  const cleaned = text
    .replace(/[^a-z0-9 _.-]/gi, "")
    .replace(/[ .]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return cleaned || "passport";
}

function passportImageCandidates(manifestPath, imagePath, fileName) {
  const manifest = String(manifestPath || "").trim();
  const image = String(imagePath || "").trim();
  const file = String(fileName || "").trim();
  const candidates = [];
  const seen = new Set();
  const push = (path) => {
    if (!path) {
      return;
    }
    const key = resolve(path).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(resolve(path));
    }
  };

  if (image) {
    if (isAbsolute(image)) {
      push(image);
    } else {
      for (const ancestor of ancestorChain(dirname(manifest))) {
        push(join(ancestor, image));
      }
    }
  }

  if (file && manifest) {
    const parent = dirname(manifest);
    push(join(parent, "passports", file));
    push(join(parent, "passport", file));
    push(join(parent, file));
  }

  return candidates;
}

async function createNusukBatch(manifestPath, selectedIds, manifestData) {
  const path = requiredPath(manifestPath, "Lokasi manifest tidak valid.");
  const manifest = manifestData && typeof manifestData === "object"
    ? manifestData
    : await loadManifest(path);
  const members = Array.isArray(manifest?.members) ? manifest.members : null;
  if (!members) {
    throw new Error("Manifest tidak memiliki daftar members.");
  }

  const selected = new Set(
    (Array.isArray(selectedIds) ? selectedIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  const filteredMembers = members.filter((member) => shouldIncludeMemberForBatch(member, selected));
  if (!filteredMembers.length) {
    throw new Error("Tidak ada passport yang siap dimasukkan ke batch Nusuk.");
  }

  const outputPath = join(dirname(path), "nusuk-entry-batch.json");
  const payload = {
    schemaVersion: "nusuk-entry-batch-v1",
    groupId: manifest.groupId || "",
    manifestPath: path,
    generatedBy: "passport-desktop-browser",
    members: filteredMembers,
  };
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return outputPath;
}

function shouldIncludeMemberForBatch(member, selected) {
  if (!member || typeof member !== "object") {
    return false;
  }
  const status = String(member.reviewStatus || member.status || "").toUpperCase();
  if (status !== "VALID" || member.reviewConfirmed !== true) {
    return false;
  }
  if (!selected.size) {
    return true;
  }
  return selected.has(String(member.id || ""));
}

async function serveStatic(response, pathname, headOnly = false) {
  const cleanPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const target = resolve(srcRoot, `.${cleanPath}`);
  if (!isInside(target, srcRoot)) {
    return sendText(response, 403, "Forbidden");
  }
  if (!existsSync(target)) {
    return sendText(response, 404, "Not found");
  }
  const info = await stat(target);
  if (!info.isFile()) {
    return sendText(response, 404, "Not found");
  }
  response.writeHead(200, {
    "content-type": mimeTypeFor(target),
    "cache-control": "no-cache",
  });
  if (!headOnly) {
    response.end(await readFile(target));
  } else {
    response.end();
  }
}

async function serveFilePath(response, rawPath) {
  const filePath = String(rawPath || "").trim();
  if (!filePath || !existsSync(filePath)) {
    return sendText(response, 404, "Not found");
  }
  const info = await stat(filePath);
  if (!info.isFile()) {
    return sendText(response, 404, "Not found");
  }
  response.writeHead(200, {
    "content-type": mimeTypeFor(filePath),
    "cache-control": "no-cache",
  });
  response.end(await readFile(filePath));
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 1024 * 1024 * 20) {
      throw new Error("Payload terlalu besar.");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-cache",
  });
  response.end(JSON.stringify(body));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

function openDirectoryDialog(options) {
  if (process.platform !== "win32") {
    throw new Error("Dialog folder fallback baru tersedia untuk Windows.");
  }
  const title = String(options?.title || "Pilih folder passport").replace(/'/g, "''");
  const command = [
    "Add-Type -AssemblyName System.Windows.Forms",
    `$dialog = New-Object System.Windows.Forms.FolderBrowserDialog`,
    `$dialog.Description = '${title}'`,
    "$dialog.ShowNewFolderButton = $false",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
  ].join("; ");

  return new Promise((resolveDialog, rejectDialog) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", command],
      { windowsHide: false, timeout: 0 },
      (error, stdout) => {
        if (error) {
          rejectDialog(new Error(`Gagal membuka dialog folder: ${error.message}`));
          return;
        }
        const selected = String(stdout || "").trim();
        resolveDialog(selected || null);
      },
    );
  });
}

function execFilePromise(file, args, options = {}) {
  return new Promise((resolveExec, rejectExec) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        rejectExec(error);
        return;
      }
      resolveExec({ stdout, stderr });
    });
  });
}

function locateWorkerPaths() {
  const candidates = [
    repoRoot,
    process.cwd(),
    ...ancestorChain(process.cwd()),
    ...ancestorChain(appRoot),
  ];
  const seen = new Set();
  for (const candidate of candidates) {
    const root = resolve(candidate);
    if (seen.has(root.toLowerCase())) {
      continue;
    }
    seen.add(root.toLowerCase());
    const pythonRoot = join(root, "python-ocr");
    const workerScript = join(pythonRoot, "scan_worker.py");
    const pythonExecutable = process.platform === "win32"
      ? join(pythonRoot, ".venv", "Scripts", "python.exe")
      : join(pythonRoot, ".venv", "bin", "python");
    if (existsSync(workerScript) && existsSync(pythonExecutable)) {
      return { repoRoot: root, workerScript, pythonExecutable };
    }
  }
  throw new Error("Folder python-ocr atau virtualenv Python tidak ditemukan.");
}

function terminateChildTree(pid) {
  if (!pid) {
    return;
  }
  if (process.platform === "win32") {
    execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process may already be gone.
  }
}

function openBrowser(url) {
  const browser = findBrowserExecutable();
  if (browser) {
    const profileRoot = process.env.LOCALAPPDATA || tmpdir();
    const profileDir = join(profileRoot, "passport-desktop-browser-profile");
    const child = spawn(
      browser,
      [`--app=${url}`, `--user-data-dir=${profileDir}`, "--no-first-run"],
      { detached: true, stdio: "ignore", windowsHide: false },
    );
    child.unref();
    return;
  }

  if (process.platform === "win32") {
    execFile("cmd.exe", ["/c", "start", "", url], { windowsHide: true }, () => {});
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

function findBrowserExecutable() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  if (process.platform !== "win32") {
    return "";
  }
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function shutdown(code) {
  if (scanState.child) {
    terminateChildTree(scanState.child.pid);
  }
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 1000).unref();
}

function requiredPath(value, message) {
  const path = String(value || "").trim();
  if (!path) {
    throw new Error(message);
  }
  return path;
}

function normalizeOcrMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "balanced" || normalized === "heavy" || normalized === "accuracy") {
    return normalized === "accuracy" ? "heavy" : normalized;
  }
  return "speed";
}

function isManifestFile(path) {
  return basename(String(path || "")).toLowerCase() === "manifest.json";
}

async function isPassportManifestFile(path) {
  if (!isManifestFile(path)) {
    return false;
  }
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(parsed?.members);
  } catch {
    return false;
  }
}

async function isSupportedImage(path) {
  if (!imageMimeType(path) || !existsSync(path)) {
    return false;
  }
  const info = await stat(path).catch(() => null);
  return Boolean(info?.isFile());
}

function imageMimeType(path) {
  switch (extname(String(path || "")).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    default:
      return "";
  }
}

function shouldSkipSearchDir(path) {
  return new Set([".git", ".venv", "__pycache__", "node_modules", "target"]).has(basename(path));
}

async function safeModifiedMs(path) {
  return stat(path).then((info) => info.mtimeMs).catch(() => 0);
}

function ancestorChain(path) {
  const chain = [];
  let current = resolve(path || ".");
  while (current && !chain.includes(current)) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return chain;
}

function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function mimeTypeFor(path) {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function parseArgs(rawArgs) {
  const parsed = { port: 0, noOpen: false };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--no-open") {
      parsed.noOpen = true;
    } else if (arg === "--port") {
      parsed.port = Number(rawArgs[index + 1] || 0) || 0;
      index += 1;
    }
  }
  return parsed;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "Terjadi error yang tidak diketahui.");
}
