import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

function normalizeEnvPath(env) {
  let pathValue = "";
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "path") {
      if (env[key]) {
        pathValue = env[key];
      }
      delete env[key];
    }
  }
  env.PATH = pathValue;
}

const cargoBinCandidates = [
  process.env.CARGO_HOME ? join(process.env.CARGO_HOME, "bin") : null,
  process.env.USERPROFILE ? join(process.env.USERPROFILE, ".cargo", "bin") : null,
  process.env.HOME ? join(process.env.HOME, ".cargo", "bin") : null,
].filter(Boolean);

const cargoExecutableName = process.platform === "win32" ? "cargo.exe" : "cargo";
const discoveredCargoBin = cargoBinCandidates.find((candidate) =>
  existsSync(join(candidate, cargoExecutableName)),
);

const environment = { ...process.env };
normalizeEnvPath(environment);

if (discoveredCargoBin) {
  const existingPath = environment.PATH || "";
  const pathParts = existingPath.split(delimiter).filter(Boolean);
  if (!pathParts.includes(discoveredCargoBin)) {
    environment.PATH = [discoveredCargoBin, ...pathParts].join(delimiter);
  }
}

if (!discoveredCargoBin) {
  console.error(
    "Cargo tidak ditemukan. Pastikan Rust sudah terpasang via rustup dan cargo tersedia di ~/.cargo/bin.",
  );
  process.exit(1);
}

const tauriScript = join(process.cwd(), "node_modules", "@tauri-apps", "cli", "tauri.js");
if (!existsSync(tauriScript)) {
  console.error("Tauri CLI tidak ditemukan di node_modules. Jalankan npm install terlebih dahulu.");
  process.exit(1);
}

const args = process.argv.slice(2);
const needsWindowsToolchain = process.platform === "win32" && ["dev", "build", "bundle"].includes(args[0] || "");
const linkOnPath = process.platform === "win32" ? hasExecutableInPath("link.exe", environment.PATH) : true;
const vsDevCmd = process.platform === "win32" ? findVsDevCmd() : null;
const windowsCmd = process.platform === "win32" ? findWindowsCmd() : null;
const isDevCommand = (args[0] || "") === "dev";

if (needsWindowsToolchain && !linkOnPath && !vsDevCmd) {
  console.error([
    "MSVC linker Windows belum tersedia.",
    "",
    "Install Visual Studio Build Tools 2022 dengan workload C++/MSVC, lalu buka terminal baru dan jalankan lagi:",
    "winget install -e --id Microsoft.VisualStudio.2022.BuildTools --override \"--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended\"",
  ].join("\n"));
  process.exit(1);
}

if (needsWindowsToolchain && vsDevCmd && !windowsCmd) {
  console.error("cmd.exe tidak ditemukan. Pastikan environment Windows Anda memiliki ComSpec/SystemRoot yang valid.");
  process.exit(1);
}

const shouldLoadVsDevEnvironment = needsWindowsToolchain && Boolean(vsDevCmd);

try {
  const finalEnvironment = shouldLoadVsDevEnvironment
    ? await loadVsDevEnvironment({ baseEnv: environment, vsDevCmd, windowsCmd })
    : environment;
  if (process.platform === "win32") {
    ensureWindowsLibraryEnvironment(finalEnvironment);
  }

  const frontendServer = isDevCommand
    ? await startFrontendDevServer({ env: finalEnvironment })
    : null;

  const child = spawn(process.execPath, [tauriScript, ...args], {
    stdio: "inherit",
    env: finalEnvironment,
    shell: false,
  });

  child.on("exit", (code, signal) => {
    if (frontendServer && !frontendServer.killed) {
      frontendServer.kill();
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    if (frontendServer && !frontendServer.killed) {
      frontendServer.kill();
    }
    console.error(`Gagal menjalankan Tauri CLI: ${error.message}`);
    process.exit(1);
  });
} catch (error) {
  console.error(`Gagal menyiapkan environment MSVC: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

function hasExecutableInPath(executableName, pathValue) {
  return String(pathValue || "")
    .split(delimiter)
    .filter(Boolean)
    .some((part) => existsSync(join(part, executableName)));
}

function findVsDevCmd() {
  const roots = [
    "C:\\Program Files\\Microsoft Visual Studio",
    "C:\\Program Files (x86)\\Microsoft Visual Studio",
  ];
  const editions = ["BuildTools", "Community", "Professional", "Enterprise"];
  const versions = ["2022", "2019", "2017"];

  for (const root of roots) {
    for (const version of versions) {
      for (const edition of editions) {
        const candidate = join(root, version, edition, "Common7", "Tools", "VsDevCmd.bat");
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

function findWindowsCmd() {
  const candidates = [
    process.env.ComSpec,
    process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "cmd.exe") : null,
    process.env.windir ? join(process.env.windir, "System32", "cmd.exe") : null,
    "C:\\Windows\\System32\\cmd.exe",
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function ensureWindowsLibraryEnvironment(env) {
  const sdkRoot = env.WindowsSdkDir || "C:\\Program Files (x86)\\Windows Kits\\10\\";
  const sdkLibVersion = normalizeWindowsSdkVersion(
    env.WindowsSDKLibVersion || findLatestSdkVersion(join(sdkRoot, "Lib")),
  );
  const vcToolsDir = env.VCToolsInstallDir || findLatestVcToolsDir();

  const libCandidates = [
    vcToolsDir ? join(vcToolsDir, "lib", "x64") : null,
    sdkLibVersion ? join(sdkRoot, "Lib", sdkLibVersion, "ucrt", "x64") : null,
    sdkLibVersion ? join(sdkRoot, "Lib", sdkLibVersion, "um", "x64") : null,
  ].filter(Boolean);

  const libPathCandidates = [
    ...libCandidates,
    sdkLibVersion ? join(sdkRoot, "UnionMetadata", sdkLibVersion) : null,
    sdkLibVersion ? join(sdkRoot, "References", sdkLibVersion) : null,
  ].filter(Boolean);

  env.LIB = mergePathList(libCandidates, env.LIB);
  env.LIBPATH = mergePathList(libPathCandidates, env.LIBPATH);
}

async function loadVsDevEnvironment({ baseEnv, vsDevCmd, windowsCmd }) {
  const printEnvScript = join(process.cwd(), "scripts", "tauri-print-msvc-env.cmd");
  const { stdout } = await execFileAsync(windowsCmd, ["/d", "/c", printEnvScript], {
    env: {
      ...baseEnv,
      TAURI_MSVC_VSDEVCMD: vsDevCmd,
    },
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8,
  });

  const mergedEnvironment = { ...baseEnv };
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    if (!key) {
      continue;
    }
    mergedEnvironment[key] = value;
  }

  normalizeEnvPath(mergedEnvironment);
  return mergedEnvironment;
}

function normalizeWindowsSdkVersion(value) {
  const raw = String(value || "").trim().replace(/[\\/]+$/, "");
  return raw || "";
}

function findLatestSdkVersion(libRoot) {
  if (!existsSync(libRoot)) {
    return "";
  }

  return readdirSync(libRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareVersionDesc)[0] || "";
}

function findLatestVcToolsDir() {
  const root = "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC";
  if (!existsSync(root)) {
    return "";
  }

  const latest = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionDesc)[0];

  return latest ? join(root, latest) : "";
}

function compareVersionDesc(left, right) {
  const leftParts = String(left).split(".").map((part) => Number(part) || 0);
  const rightParts = String(right).split(".").map((part) => Number(part) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (rightParts[index] || 0) - (leftParts[index] || 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function mergePathList(preferredEntries, existingValue) {
  const existingEntries = String(existingValue || "")
    .split(delimiter)
    .filter(Boolean);

  const merged = [];
  for (const entry of [...preferredEntries, ...existingEntries]) {
    if (!entry || !existsSync(entry)) {
      continue;
    }
    if (!merged.includes(entry)) {
      merged.push(entry);
    }
  }

  return merged.join(delimiter);
}

async function startFrontendDevServer({ env }) {
  const viteBin = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
  const child = spawn(viteBin, ["--config", "vite.config.ts"], {
    stdio: ["ignore", "pipe", "inherit"],
    env,
    shell: true,
    cwd: process.cwd(),
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Vite dev server tidak merespons."));
    }, 15000);

    child.stdout.on("data", (chunk) => {
      const text = String(chunk || "");
      process.stdout.write(text);
      if (text.includes("Local:") || text.includes("localhost") || text.includes("127.0.0.1")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Vite dev server berhenti lebih awal dengan kode ${code ?? "null"}.`));
    });
  });

  return child;
}

