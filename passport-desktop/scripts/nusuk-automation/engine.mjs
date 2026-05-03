#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import {
  deepValue,
  normalizeDateToIso,
  parseArgs,
} from "./core-utils.mjs";
import { isLikelyNextSelector, runStep } from "./step-actions.mjs";
import { executeMemberPageSteps, splitPerMemberStepsByPage } from "./page-groups.mjs";
import { buildPerMemberSteps } from "./page-templates.mjs";

const NEXT_BUTTON_CANDIDATE_SELECTORS = [
  ".d-flex.justify-content-end.align-items-center.gap-3 > button.btn.btn-primary:has-text('Next')",
  "action-btns.custom-action-buttons .d-flex.justify-content-end.align-items-center.gap-3 > button.btn.btn-primary:has-text('Next')",
  "action-btns.custom-action-buttons button.btn.btn-primary:has-text('Next')",
  "action-btns button.btn.btn-primary:has-text('Next')",
  ".action-buttons .navigation-buttons button:has-text('Next')",
];
const NEXT_BUTTON_SELECTOR = NEXT_BUTTON_CANDIDATE_SELECTORS.join(", ");
const VACCINATION_UPLOAD_SELECTOR = [
  "input[type='file'][formcontrolname='vaccinationPicture']",
  "input[type='file'][name='vaccinationPicture']",
  "input[type='file'][formcontrolname*='vaccin' i]",
  "input[type='file'][name*='vaccin' i]",
  "input[type='file'][id*='vaccin' i]",
  "input[type='file'][formcontrolname*='vaccine' i]",
  "input[type='file'][name*='vaccine' i]",
  "input[type='file'][id*='vaccine' i]",
  "input[type='file'][formcontrolname*='immun' i]",
  "input[type='file'][name*='immun' i]",
  "input[type='file'][id*='immun' i]",
].join(", ");
const DEBUG_SECOND_PAGE_ARABIC_ONLY = false;

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitMs(ms) {
  const timeout = Math.max(0, Number(ms) || 0);
  await new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

function logCheckpoint(type, detail = "") {
  const suffix = detail ? `|${detail}` : "";
  console.log(`CHECKPOINT_${type}${suffix}`);
}

function parseCdpPort(cdpUrl) {
  try {
    const parsed = new URL(cdpUrl);
    const rawPort = parsed.port ? Number(parsed.port) : 80;
    if (Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535) {
      return rawPort;
    }
  } catch {
    // ignore parse error; fallback below
  }
  return 9222;
}

function shouldTryEdgeAutoLaunch(error) {
  const message = String(error instanceof Error ? error.message : error || "").toLowerCase();
  return message.includes("econnrefused")
    || message.includes("connect")
    || message.includes("websocket url")
    || message.includes("fetch failed");
}

function edgeExecutableCandidates() {
  const candidates = [];
  if (process.env.EDGE_EXE) {
    candidates.push(process.env.EDGE_EXE.trim());
  }
  if (process.platform === "win32") {
    if (process.env["ProgramFiles"]) {
      candidates.push(path.join(process.env["ProgramFiles"], "Microsoft", "Edge", "Application", "msedge.exe"));
    }
    if (process.env["ProgramFiles(x86)"]) {
      candidates.push(path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"));
    }
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
  }
  if (process.platform === "darwin") {
    candidates.push("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
  }
  if (process.platform === "linux") {
    candidates.push("/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable", "microsoft-edge", "microsoft-edge-stable");
  }
  return candidates.filter(Boolean);
}

async function resolveEdgeExecutable() {
  for (const candidate of edgeExecutableCandidates()) {
    const text = String(candidate || "").trim();
    if (!text) {
      continue;
    }
    if (path.isAbsolute(text)) {
      if (await fileExists(text)) {
        return text;
      }
      continue;
    }
    return text;
  }
  return "";
}

async function tryLaunchEdgeForCdp({ cdpUrl, targetUrl, config }) {
  const port = parseCdpPort(cdpUrl);
  const edgeExecutable = await resolveEdgeExecutable();
  if (!edgeExecutable) {
    return false;
  }

  const userDataDir = String(config.edge_debug_user_data_dir ?? "").trim()
    || path.join(os.tmpdir(), "visa-entry-bot-edge-debug-profile");
  await fs.mkdir(userDataDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
  ];
  if (targetUrl) {
    args.push(targetUrl);
  }

  try {
    const child = spawn(edgeExecutable, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function connectCdpWithEdgeAutoLaunch({ cdpUrl, targetUrl, config }) {
  try {
    return await chromium.connectOverCDP(cdpUrl);
  } catch (firstError) {
    const shouldAutoLaunch = Boolean(config.auto_launch_edge_debug ?? true);
    if (!shouldAutoLaunch || !shouldTryEdgeAutoLaunch(firstError)) {
      throw firstError;
    }

    const launched = await tryLaunchEdgeForCdp({ cdpUrl, targetUrl, config });
    if (!launched) {
      throw firstError;
    }

    const retryCount = Math.max(1, Math.floor(Number(config.attach_retry_attempts ?? 12)));
    const retryDelayMs = Math.max(200, Math.floor(Number(config.attach_retry_delay_ms ?? 700)));
    let lastError = firstError;
    for (let attempt = 0; attempt < retryCount; attempt += 1) {
      await waitMs(retryDelayMs);
      try {
        return await chromium.connectOverCDP(cdpUrl);
      } catch (retryError) {
        lastError = retryError;
      }
    }
    throw lastError;
  }
}

async function ensureTemplate(configPath) {
  const template = {
    browser_mode: "launch",
    cdp_url: "http://127.0.0.1:9222",
    auto_launch_edge_debug: true,
    attach_retry_attempts: 12,
    attach_retry_delay_ms: 700,
    edge_debug_user_data_dir: "",
    launch_user_data_dir: "",
    navigate_on_start: false,
    headless: false,
    channel: "msedge",
    navigation_timeout_ms: 120000,
    action_timeout_ms: 30000,
    login_wait_selector: ".card .title",
    login_wait_timeout_ms: 120000,
    manual_login_checkpoint_enabled: true,
    manual_login_initial_probe_ms: 2500,
    manual_login_timeout_ms: 900000,
    speed_factor: 0.85,
    member_cooldown_min_ms: 5000,
    member_cooldown_max_ms: 9000,
    global_steps: [
      {
        action: "wait_for_selector",
        selector: ".card .title",
        timeout_ms: 10000,
      },
      {
        action: "wait_for_selector",
        selector: ".container__notes__upload__button input[type='file']",
        timeout_ms: 15000,
      },
    ],
    per_member_steps: buildPerMemberSteps(NEXT_BUTTON_SELECTOR),
  };

  await fs.writeFile(configPath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
  return template;
}

function resolvePreferredReleaseDate(member) {
  const passportIssueDate = String(deepValue(member, "passportExtracted.issueDate") || "").trim();
  const releaseDate = String(deepValue(member, "resolvedProfile.releaseDate") || "").trim();
  const issueDate = String(deepValue(member, "resolvedProfile.issueDate") || "").trim();
  const normalizedPassportIssue = normalizeDateToIso(passportIssueDate);
  const normalizedRelease = normalizeDateToIso(releaseDate);
  const normalizedIssue = normalizeDateToIso(issueDate);

  if (normalizedPassportIssue) {
    return passportIssueDate;
  }

  if (normalizedRelease && normalizedIssue && normalizedRelease !== normalizedIssue) {
    // Prefer issueDate when conflict exists; releaseDate can be stale.
    return issueDate;
  }
  return releaseDate || issueDate || "";
}

function normalizeUrlForCompare(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) {
    return { raw: "", host: "", path: "" };
  }
  try {
    const parsed = new URL(value);
    const pathValue = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    return {
      raw: parsed.toString().toLowerCase(),
      host: parsed.host.toLowerCase(),
      path: pathValue,
    };
  } catch {
    return { raw: value.toLowerCase(), host: "", path: "" };
  }
}

function isMatchingTargetPage(pageUrl, targetUrl) {
  const page = normalizeUrlForCompare(pageUrl);
  const target = normalizeUrlForCompare(targetUrl);
  if (!target.raw) {
    return Boolean(page.raw);
  }
  if (!page.raw) {
    return false;
  }
  if (page.raw.includes(target.raw)) {
    return true;
  }
  if (target.path && page.path && page.path.includes(target.path)) {
    if (!target.host || page.host === target.host) {
      return true;
    }
  }
  return false;
}

async function ensureLoginCheckpoint({
  page,
  loginWaitSelector,
  loginWaitTimeout,
  actionTimeout,
  browserMode,
  config,
}) {
  if (!loginWaitSelector) {
    if (loginWaitTimeout > 0) {
      await page.waitForTimeout(loginWaitTimeout);
    }
    return;
  }

  const manualCheckpointEnabled = Boolean(config.manual_login_checkpoint_enabled ?? browserMode === "launch");
  const initialProbeMs = Math.max(500, Math.floor(Number(config.manual_login_initial_probe_ms ?? 2500)));
  try {
    await page.waitForSelector(loginWaitSelector, { timeout: initialProbeMs });
    return;
  } catch (probeError) {
    if (!manualCheckpointEnabled) {
      await page.waitForSelector(loginWaitSelector, { timeout: loginWaitTimeout || actionTimeout });
      return;
    }
    const manualLoginTimeoutMs = Math.max(
      initialProbeMs,
      Math.floor(Number(config.manual_login_timeout_ms ?? Math.max(loginWaitTimeout, 900000)))
    );
    logCheckpoint("LOGIN_REQUIRED", "Selesaikan login atau CAPTCHA di browser yang baru dibuka. Automation akan lanjut otomatis.");
    try {
      await page.waitForSelector(loginWaitSelector, { timeout: manualLoginTimeoutMs });
    } catch (waitError) {
      throw new Error(
        `Login Nusuk belum selesai dalam ${Math.round(manualLoginTimeoutMs / 1000)} detik. Selesaikan login atau CAPTCHA lalu jalankan ulang Auto Entry. Detail: ${waitError instanceof Error ? waitError.message : String(waitError)}`
      );
    }
    logCheckpoint("LOGIN_RESOLVED", "Login terdeteksi. Automation dilanjutkan.");
  }
}


export async function main() {
  const args = parseArgs(process.argv);
  if (!args.batch) {
    throw new Error("Argumen --batch wajib diisi.");
  }
  if (!args.url) {
    throw new Error("Argumen --url wajib diisi.");
  }

  const batchPath = path.resolve(args.batch);
  const batchRaw = await fs.readFile(batchPath, "utf8");
  const batch = JSON.parse(batchRaw);
  const members = Array.isArray(batch.members) ? batch.members : [];
  if (!members.length) {
    throw new Error("Batch Nusuk kosong, tidak ada member untuk diproses.");
  }

  const configPath = path.join(path.dirname(batchPath), "nusuk-click-steps.json");
  const hasConfig = await fileExists(configPath);
  let config;
  if (!hasConfig) {
    config = await ensureTemplate(configPath);
    console.log(`Template langkah click dibuat di ${configPath}. Menjalankan template default...`);
  } else {
    const configRaw = await fs.readFile(configPath, "utf8");
    config = JSON.parse(configRaw);
  }
  config = normalizeConfigForNusuk(config);
  const actionTimeout = Number(config.action_timeout_ms ?? 30000);
  const navigationTimeout = Number(config.navigation_timeout_ms ?? 120000);
  const loginWaitSelector = String(config.login_wait_selector ?? "").trim();
  const loginWaitTimeout = Number(config.login_wait_timeout_ms ?? 120000);
  const speedFactor = resolveSpeedFactor(config.speed_factor);
  const memberCooldownMinMs = sanitizeDelayMs(config.member_cooldown_min_ms, 5000);
  const memberCooldownMaxMs = sanitizeDelayMs(config.member_cooldown_max_ms, 9000);
  const memberCooldownRange = normalizeMinMaxDelay(memberCooldownMinMs, memberCooldownMaxMs);
  const browserMode = String(config.browser_mode ?? "attach").trim().toLowerCase();
  const navigateOnStart = Boolean(config.navigate_on_start);
  const cdpUrl = String(config.cdp_url ?? "http://127.0.0.1:9222").trim();
  const targetUrl = String(args.url ?? "").trim();
  const launchUserDataDir = String(config.launch_user_data_dir ?? "").trim()
    || path.join(path.dirname(batchPath), ".nusuk-browser-profile");

  let browser;
  let context;
  let page;

  if (browserMode === "attach") {
    try {
      browser = await connectCdpWithEdgeAutoLaunch({
        cdpUrl,
        targetUrl,
        config,
      });
    } catch (error) {
      throw new Error(
        `Gagal attach ke Edge existing di ${cdpUrl}. Pastikan Edge jalan dengan remote debugging (contoh: --remote-debugging-port=9222). Detail: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const contexts = browser.contexts();
    if (!contexts.length) {
      throw new Error("Tidak ada context browser yang aktif di Edge existing.");
    }

    const pageEntries = contexts.flatMap((ctx) => ctx.pages().map((item) => ({ context: ctx, page: item })));
    const matchedEntry = pageEntries.find((entry) => isMatchingTargetPage(entry.page.url(), targetUrl));
    if (matchedEntry) {
      context = matchedEntry.context;
      page = matchedEntry.page;
    } else if (pageEntries.length) {
      context = pageEntries[0].context;
      page = pageEntries[0].page;
    } else {
      context = contexts[0];
      page = await context.newPage();
      if (targetUrl) {
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
      }
    }

    if (!page) {
      throw new Error("Tab Edge tidak ditemukan pada browser debug. Pastikan Edge dibuka dengan --remote-debugging-port=9222.");
    }

    await page.bringToFront();
    if (navigateOnStart && targetUrl) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
    }
  } else {
    context = await chromium.launchPersistentContext(launchUserDataDir, {
      headless: Boolean(config.headless),
      channel: String(config.channel ?? "").trim() || undefined,
      acceptDownloads: true,
    });
    browser = context.browser();
    const pages = context.pages();
    page = pages.find((item) => isMatchingTargetPage(item.url(), targetUrl)) || pages[0] || await context.newPage();
    await page.bringToFront();
    if (targetUrl && (navigateOnStart || !String(page.url() ?? "").trim())) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
    }
  }

  try {
    page.setDefaultTimeout(actionTimeout);
    page.setDefaultNavigationTimeout(navigationTimeout);
    await ensureLoginCheckpoint({
      page,
      loginWaitSelector,
      loginWaitTimeout,
      actionTimeout,
      browserMode,
      config,
    });

    const globalSteps = Array.isArray(config.global_steps) ? config.global_steps : [];
    const perMemberSteps = Array.isArray(config.per_member_steps) ? config.per_member_steps : [];
    const pageGroups = splitPerMemberStepsByPage(perMemberSteps, isLikelyNextSelector);

    for (let idx = 0; idx < globalSteps.length; idx += 1) {
      const step = globalSteps[idx];
      try {
        await runStep(
          page,
          step,
          {
            index: idx,
            repoRoot: path.resolve(process.cwd(), ".."),
            speedFactor,
          },
          actionTimeout
        );
      } catch (error) {
        console.log(`global_step[${idx}] fail: ${error instanceof Error ? error.message : String(error)}`);
        if (!step?.continue_on_error) {
          throw error;
        }
      }
    }

    for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
      if (memberIndex > 0) {
        const memberCooldownMs = randomInRange(
          memberCooldownRange.min,
          memberCooldownRange.max,
        );
        console.log(`Cooldown antar member ${Math.round(memberCooldownMs / 1000)}s untuk hindari rate-limit...`);
        await page.waitForTimeout(memberCooldownMs);
      }
      const member = members[memberIndex];
      const releaseDateRaw = String(deepValue(member, "resolvedProfile.releaseDate") || "").trim();
      const issueDateRaw = String(deepValue(member, "resolvedProfile.issueDate") || "").trim();
      const entryReleaseDate = resolvePreferredReleaseDate(member);
      const passportRef = String(
        deepValue(member, "resolvedProfile.passportNumber")
        || deepValue(member, "id")
        || "-"
      ).trim();
      console.log(
        `member[${memberIndex + 1}/${members.length}] ${passportRef} | releaseDate=${releaseDateRaw || "-"} | issueDate=${issueDateRaw || "-"} | used=${entryReleaseDate || "-"}`
      );
      const vaccinationFilePath = String(
        deepValue(member, "resolvedProfile.vaccinationCertificatePath")
        || member?.passportImagePath
        || ""
      ).trim();
      const memberLabel = `member[${memberIndex + 1}/${members.length}]`;
      const contextBase = {
        member,
        memberIndex,
        totalMembers: members.length,
        repoRoot: path.resolve(process.cwd(), ".."),
        vaccinationFilePath,
        entryReleaseDate,
        speedFactor,
      };
      for (const group of pageGroups) {
        await executeMemberPageSteps({
          page,
          pageName: group.name,
          memberLabel,
          stepEntries: group.steps,
          contextBase,
          actionTimeout,
          runStep,
        });
      }
    }

    console.log(`Automation selesai. Member diproses: ${members.length}.`);
  } finally {
    if (browserMode !== "attach") {
      await context.close();
    }
  }
}

function sanitizeDelayMs(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeMinMaxDelay(minValue, maxValue) {
  if (minValue <= maxValue) {
    return { min: minValue, max: maxValue };
  }
  return { min: maxValue, max: minValue };
}

function randomInRange(minValue, maxValue) {
  if (maxValue <= minValue) {
    return minValue;
  }
  return minValue + Math.floor(Math.random() * (maxValue - minValue + 1));
}

function resolveSpeedFactor(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  // Keep within safe range to avoid excessive speed that can destabilize UI sync.
  return Math.min(1.2, Math.max(0.5, parsed));
}

export function normalizeConfigForNusuk(config) {
  const normalized = config && typeof config === "object"
    ? { ...config }
    : {};
  const perMemberSteps = Array.isArray(normalized.per_member_steps)
    ? normalized.per_member_steps.map((step) => ({ ...(step || {}) }))
    : [];

  for (let i = 0; i < perMemberSteps.length; i += 1) {
    const step = perMemberSteps[i];
    const action = String(step.action ?? "").trim().toLowerCase();
    const selector = String(step.selector ?? "").trim();

    if (action === "wait_for_selector" && selector === ".popup.popup-small") {
      step.selector = ".popup.popup-small .popup-actions button:has-text('Proceed'):visible";
      step.timeout_ms = Number(step.timeout_ms ?? 120000);
    }

    if (action === "click" && selector === ".popup.popup-small .popup-actions button:has-text('Proceed')") {
      step.selector = ".popup.popup-small .popup-actions button:has-text('Proceed'):visible";
      step.timeout_ms = Number(step.timeout_ms ?? 30000);
    }

    if (
      action === "fill"
      && selector === "p-calendar[formcontrolname='passportIssueDate'] input[type='text']"
    ) {
      step.action = "set_calendar_date";
      step.popup_selector = String(step.popup_selector ?? ".p-datepicker");
      step.timeout_ms = Number(step.timeout_ms ?? 45000);
    }

    if (action === "set_calendar_date" && String(step.popup_selector ?? "").trim() === ".datepicker") {
      step.popup_selector = ".p-datepicker";
    }

    if (
      action === "set_calendar_date"
      && String(step.value ?? "").trim() === "{{member.resolvedProfile.releaseDate}}"
    ) {
      step.value = "{{entryReleaseDate}}";
    }

    if (
      (action === "wait_for_enabled" || action === "click")
      && String(step.selector ?? "").trim() === ".action-buttons .navigation-buttons button:has-text('Next')"
    ) {
      step.selector = NEXT_BUTTON_SELECTOR;
    }

    if (
      action === "fill"
      && /input\[placeholder=['"]Phone Number['"]\]/i.test(selector)
    ) {
      step.action = "set_phone_fields";
      step.selector = "input[formcontrolname='phone'], input[name='phone'], input[placeholder='Mobile Number'], input[placeholder='Phone Number'], input[placeholder*='Phone'], input[placeholder*='Mobile']";
    }

    if (
      action === "select_native_by_text"
      && (selector === "#birth-country" || String(step.option_kind ?? "").trim() === "birth_country")
    ) {
      step.action = "select_primeng_dropdown";
      step.selector = "select[formcontrolname='birthCountryId'], p-dropdown[formcontrolname='birthCountryId'] .p-dropdown:not(.p-disabled), p-dropdown[formcontrolname='birthCountryId'] .p-dropdown";
    }

    if (
      action === "select_native_by_text"
      && String(step.option_kind ?? "").trim() === "marital_status"
    ) {
      step.action = "select_primeng_dropdown";
      step.selector = "select[formcontrolname='martialStatusId'], select[formcontrolname='maritalStatusId'], p-dropdown[formcontrolname='martialStatusId'] .p-dropdown:not(.p-disabled), p-dropdown[formcontrolname='maritalStatusId'] .p-dropdown:not(.p-disabled), p-dropdown[formcontrolname='martialStatusId'] .p-dropdown, p-dropdown[formcontrolname='maritalStatusId'] .p-dropdown";
      delete step.nth;
    }

    if (
      action === "fill"
      && selector === "input[placeholder='Email']"
    ) {
      step.selector = "input[formcontrolname='email'], input[name='email'], input[placeholder='Email'], input[type='email'][placeholder='Email']";
    }

    if (
      action === "select_primeng_dropdown"
      && String(step.option_kind ?? "").trim() === "passport_type"
    ) {
      step.continue_on_error = false;
    }

    // Force-correct legacy step selectors by value path for Personal Information page.
    const valueExpr = String(step.value ?? "").trim();
    const optionExpr = String(step.option_text ?? "").trim();
    if (action === "fill" && valueExpr === "{{member.resolvedProfile.arabic.firstName}}") {
      step.selector = "div[formgroupname='firstName'] input[formcontrolname='ar'], input[formcontrolname='firstName.ar'], input[name='firstName.ar'], input[placeholder='First Name (Arabic)'], input[placeholder='First name (Arabic)'], input[placeholder*='Arabic'][placeholder*='First']";
    }
    if (action === "fill" && valueExpr === "{{member.resolvedProfile.arabic.fatherName}}") {
      step.selector = "div[formgroupname='secondName'] input[formcontrolname='ar'], input[placeholder=\"Father's Name (Arabic)\"], input[placeholder='Father Name (Arabic)'], input[placeholder*='Arabic'][placeholder*='Father']";
    }
    if (action === "fill" && valueExpr === "{{member.resolvedProfile.arabic.grandfatherName}}") {
      step.selector = "div[formgroupname='thirdName'] input[formcontrolname='ar'], input[placeholder='Grandfather Name (Arabic)'], input[placeholder*='Arabic'][placeholder*='Grand']";
    }
    if (action === "fill" && valueExpr === "{{member.resolvedProfile.arabic.familyName}}") {
      step.selector = "div[formgroupname='familyName'] input[formcontrolname='ar'], input[formcontrolname='familyName.ar'], input[name='familyName.ar'], input[placeholder='Family Name (Arabic)'], input[placeholder*='Arabic'][placeholder*='Family']";
    }
    if (action === "fill" && valueExpr === "{{member.resolvedProfile.firstName}}") {
      step.selector = "div[formgroupname='firstName'] input[formcontrolname='en'], input[formcontrolname='firstName.en'], input[name='firstName.en'], input[placeholder='First name'], input[placeholder='First Name']";
    }
    if (action === "fill" && valueExpr === "{{member.resolvedProfile.fatherName}}") {
      step.selector = "div[formgroupname='secondName'] input[formcontrolname='en'], input[placeholder='Father name'], input[placeholder='Father Name']";
    }
    if (action === "fill" && valueExpr === "{{member.resolvedProfile.grandfatherName}}") {
      step.selector = "div[formgroupname='thirdName'] input[formcontrolname='en'], input[placeholder='Grand father'], input[placeholder='Grandfather Name']";
    }
    if (action === "fill" && valueExpr === "{{member.resolvedProfile.familyName}}") {
      step.selector = "div[formgroupname='familyName'] input[formcontrolname='en'], input[formcontrolname='familyName.en'], input[name='familyName.en'], input[placeholder='Family Name']";
    }
    if (action === "fill" && valueExpr === "{{member.resolvedProfile.profession}}") {
      step.selector = "input[formcontrolname='profession'], input[name='profession'], input[placeholder='Profession']";
    }
    if (action === "fill" && valueExpr === "{{member.resolvedProfile.birthCity}}") {
      step.selector = "input[formcontrolname='birthCityName'], input[name='birthCityName'], input[placeholder='Birth City']";
    }
    if (action === "fill" && valueExpr === "{{member.resolvedProfile.email}}") {
      step.selector = "input[formcontrolname='email'], input[name='email'], input[placeholder='Email'], input[type='email'][placeholder='Email']";
    }
    if (
      action === "set_files"
      && valueExpr === "{{member.passportImagePath}}"
      && /form\s+input\[type=['"]file['"]\]/i.test(selector)
      && !selector.includes("container__notes__upload__button")
      && !/vaccination/i.test(selector)
      && /(personal|passportimage|passport)/i.test(selector)
    ) {
      step.selector = "input[type='file'][formcontrolname='passportImage'], input[type='file'][name='passportImage'], input[type='file'][formcontrolname='personalPicture'], input[type='file'][name='personalPicture']";
      delete step.nth;
    }
    if (
      action === "set_files"
      && valueExpr === "{{vaccinationFilePath}}"
    ) {
      if (/form\s+input\[type=['"]file['"]\]/i.test(selector) && !selector.includes("container__notes__upload__button")) {
        step.selector = VACCINATION_UPLOAD_SELECTOR;
      }
      step.value = "{{member.passportImagePath}}";
      delete step.nth;
    }
    if (
      (action === "set_files" || action === "wait_for_selector")
      && /input\s*\[\s*type\s*=\s*['"]file['"]\s*\]\s*\[(formcontrolname|name)\s*=\s*['"]vaccinationpicture['"]\s*\]/i.test(selector)
    ) {
      step.selector = VACCINATION_UPLOAD_SELECTOR;
      delete step.nth;
    }
    if (action === "select_primeng_dropdown" && (String(step.option_kind ?? "").trim() === "birth_country" || optionExpr === "{{member.resolvedProfile.birthCountry}}")) {
      step.selector = "select[formcontrolname='birthCountryId'], p-dropdown[formcontrolname='birthCountryId'] .p-dropdown:not(.p-disabled), p-dropdown[formcontrolname='birthCountryId'] .p-dropdown";
    }
    if (action === "select_primeng_dropdown" && (String(step.option_kind ?? "").trim() === "marital_status" || optionExpr === "{{member.resolvedProfile.maritalStatus}}")) {
      step.selector = "select[formcontrolname='martialStatusId'], select[formcontrolname='maritalStatusId'], p-dropdown[formcontrolname='martialStatusId'] .p-dropdown:not(.p-disabled), p-dropdown[formcontrolname='maritalStatusId'] .p-dropdown:not(.p-disabled), p-dropdown[formcontrolname='martialStatusId'] .p-dropdown, p-dropdown[formcontrolname='maritalStatusId'] .p-dropdown";
      delete step.nth;
    }
    if ((action === "set_phone_fields" || (action === "fill" && valueExpr === "{{member.resolvedProfile.mobileNumber}}"))) {
      step.action = "set_phone_fields";
      step.selector = "input[formcontrolname='phone'], input[name='phone'], input[formcontrolname='mobileNumber'], input[name='mobileNumber'], input[placeholder='Mobile Number'], input[placeholder='Phone Number'], input[placeholder*='Phone'], input[placeholder*='Mobile'], input[type='tel'], ngx-intl-tel-input input";
    }
  }

  const filteredPerMemberSteps = perMemberSteps.filter((step) => {
    const action = String(step?.action ?? "").trim().toLowerCase();
    const valueExpr = String(step?.value ?? "").trim();
    const selector = String(step?.selector ?? "").trim().toLowerCase();
    const isInitialPassportUpload = selector.includes("container__notes__upload__button");
    const isVaccinationUpload = selector.includes("vaccination");

    if (action === "fill" && (valueExpr === "{{member.resolvedProfile.iqamaNumber}}" || valueExpr === "{{member.resolvedProfile.iqamaExpiryDate}}")) {
      return false;
    }
    if ((action === "set_files" || action === "fill") && (selector.includes("residencypicture") || selector.includes("iqama"))) {
      return false;
    }
    if (action === "set_files" && !isInitialPassportUpload && !isVaccinationUpload) {
      // Kunci: selain upload passport awal, hanya upload Vaccination Certificate yang diizinkan.
      return false;
    }
    return true;
  });

  const hasVaccinationUploadStep = filteredPerMemberSteps.some((step) => {
    const action = String(step?.action ?? "").trim().toLowerCase();
    const selector = String(step?.selector ?? "").trim().toLowerCase();
    return action === "set_files" && selector.includes("vaccination");
  });
  if (!hasVaccinationUploadStep) {
    const vaccinationStep = {
      action: "set_files",
      selector: VACCINATION_UPLOAD_SELECTOR,
      nth: null,
      value: "{{member.passportImagePath}}",
    };
    const insertBeforeIdx = filteredPerMemberSteps.findIndex((step) => {
      const action = String(step?.action ?? "").trim().toLowerCase();
      const selector = String(step?.selector ?? "").trim().toLowerCase();
      return (action === "fill" && selector.includes("email"))
        || action === "set_phone_fields"
        || (action === "wait_for_selector" && selector.includes("disclosure form"));
    });
    if (insertBeforeIdx >= 0) {
      filteredPerMemberSteps.splice(insertBeforeIdx, 0, vaccinationStep);
    } else {
      filteredPerMemberSteps.push(vaccinationStep);
    }
  }

  const hasArabicMinimalStep = filteredPerMemberSteps.some((step) => String(step?.action ?? "").trim().toLowerCase() === "fill_arabic_minimal");
  if (!hasArabicMinimalStep) {
    const insertAfterIndex = filteredPerMemberSteps.findIndex((step) => {
      const action = String(step?.action ?? "").trim().toLowerCase();
      const selector = String(step?.selector ?? "").toLowerCase();
      return action === "wait_for_selector"
        && (selector.includes("first name (arabic)") || selector.includes("formgroupname='firstname'"));
    });
    if (insertAfterIndex >= 0) {
      filteredPerMemberSteps.splice(insertAfterIndex + 1, 0, {
        action: "fill_arabic_minimal",
        first_value: "{{member.resolvedProfile.arabic.firstName}}",
        family_value: "{{member.resolvedProfile.arabic.familyName}}",
        timeout_ms: 30000,
      });
    }
  }

  // Legacy config auto-fix:
  // Some older nusuk-click-steps.json mixes PAGE 2 fields into PAGE 1
  // (Arabic/Personal fields appear before first Next click).
  // Insert Next pair right after identity section so flow can move to PAGE 2.
  const firstNextClickIndexLegacy = filteredPerMemberSteps.findIndex((step) => {
    const action = String(step?.action ?? "").trim().toLowerCase();
    const selector = String(step?.selector ?? "").trim();
    return action === "click" && isLikelyNextSelector(selector);
  });
  const firstPersonalFieldIndex = filteredPerMemberSteps.findIndex((step) => {
    const action = String(step?.action ?? "").trim().toLowerCase();
    if (action !== "fill" && action !== "fill_arabic_minimal") {
      return false;
    }
    const selector = String(step?.selector ?? "").toLowerCase();
    const valueExpr = String(step?.value ?? "").trim();
    return action === "fill_arabic_minimal"
      || valueExpr === "{{member.resolvedProfile.arabic.firstName}}"
      || selector.includes("first name (arabic)")
      || selector.includes("formgroupname='firstname'");
  });
  const issueCityIndex = filteredPerMemberSteps.findIndex((step) => {
    const action = String(step?.action ?? "").trim().toLowerCase();
    if (action !== "fill") {
      return false;
    }
    const selector = String(step?.selector ?? "").toLowerCase();
    const valueExpr = String(step?.value ?? "").trim();
    return valueExpr === "{{member.resolvedProfile.cityOfIssued}}"
      || selector.includes("issuecityname")
      || selector.includes("city of issued");
  });

  if (
    firstPersonalFieldIndex > 0
    && (firstNextClickIndexLegacy < 0 || firstNextClickIndexLegacy > firstPersonalFieldIndex)
    && issueCityIndex >= 0
  ) {
    const insertAt = issueCityIndex + 1;
    filteredPerMemberSteps.splice(insertAt, 0,
      {
        action: "wait_for_enabled",
        selector: NEXT_BUTTON_SELECTOR,
        timeout_ms: 30000,
      },
      {
        action: "click",
        selector: NEXT_BUTTON_SELECTOR,
        timeout_ms: 10000,
      },
      {
        action: "wait_for_selector",
        selector: "div[formgroupname='firstName'] input[formcontrolname='ar'], input[placeholder='First Name (Arabic)'], input[placeholder='First name (Arabic)']",
        timeout_ms: 120000,
      }
    );
  }

  if (DEBUG_SECOND_PAGE_ARABIC_ONLY) {
    const firstArabicIndex = filteredPerMemberSteps.findIndex((step) => {
      const action = String(step?.action ?? "").trim().toLowerCase();
      const valueExpr = String(step?.value ?? "").trim();
      return action === "fill" && valueExpr === "{{member.resolvedProfile.arabic.firstName}}";
    });
    const firstNextClickIndex = filteredPerMemberSteps.findIndex((step) => {
      const action = String(step?.action ?? "").trim().toLowerCase();
      const selector = String(step?.selector ?? "").trim();
      return action === "click" && isLikelyNextSelector(selector);
    });

    if (firstArabicIndex > 0 && firstNextClickIndex >= 0) {
      const cutoff = Math.max(firstArabicIndex, firstNextClickIndex + 1);
      const narrowed = filteredPerMemberSteps.slice(0, cutoff);

      const hasNextWait = narrowed.some((step, idx) => {
        if (idx >= narrowed.length - 1) {
          return false;
        }
        const action = String(step?.action ?? "").trim().toLowerCase();
        const selector = String(step?.selector ?? "").trim();
        const nextStep = narrowed[idx + 1];
        const nextAction = String(nextStep?.action ?? "").trim().toLowerCase();
        const nextSelector = String(nextStep?.selector ?? "").trim();
        return action === "wait_for_enabled"
          && isLikelyNextSelector(selector)
          && nextAction === "click"
          && isLikelyNextSelector(nextSelector);
      });

      if (!hasNextWait) {
        narrowed.push({
          action: "wait_for_enabled",
          selector: NEXT_BUTTON_SELECTOR,
          timeout_ms: 30000,
        });
        narrowed.push({
          action: "click",
          selector: NEXT_BUTTON_SELECTOR,
          timeout_ms: 10000,
        });
      }

      narrowed.push({
        action: "wait_for_selector",
        selector: "div[formgroupname='firstName'] input[formcontrolname='ar'], input[placeholder='First Name (Arabic)'], input[placeholder='First name (Arabic)']",
        timeout_ms: 120000,
      });
      narrowed.push({
        action: "fill_arabic_minimal",
        first_value: "{{member.resolvedProfile.arabic.firstName}}",
        family_value: "{{member.resolvedProfile.arabic.familyName}}",
        timeout_ms: 30000,
      });
      narrowed.push({
        action: "wait",
        ms: 400,
      });
      normalized.per_member_steps = narrowed;
      return normalized;
    }
  }

  const isNextStep = (step) => {
    const action = String(step?.action ?? "").trim().toLowerCase();
    const selector = String(step?.selector ?? "").trim();
    return action === "click" && isLikelyNextSelector(selector);
  };
  const isNextWaitStep = (step) => {
    const action = String(step?.action ?? "").trim().toLowerCase();
    const selector = String(step?.selector ?? "").trim();
    return action === "wait_for_enabled" && isLikelyNextSelector(selector);
  };
  const isArabicFirstWait = (step) => {
    const action = String(step?.action ?? "").trim().toLowerCase();
    const selector = String(step?.selector ?? "").trim().toLowerCase();
    return action === "wait_for_selector"
      && selector.includes("placeholder")
      && selector.includes("arabic")
      && selector.includes("first");
  };
  const isArabicFirstFill = (step) => {
    const action = String(step?.action ?? "").trim().toLowerCase();
    const selector = String(step?.selector ?? "").trim().toLowerCase();
    return action === "fill"
      && selector.includes("placeholder")
      && selector.includes("arabic")
      && selector.includes("first");
  };
  const isIdentityMarker = (step) => {
    const selector = String(step?.selector ?? "").trim().toLowerCase();
    return selector.includes("passportissuedate")
      || selector.includes("issuecityname")
      || selector.includes("city of issued");
  };

  const firstIdentityIdx = filteredPerMemberSteps.findIndex((step) => isIdentityMarker(step));
  const firstArabicWaitIdx = filteredPerMemberSteps.findIndex((step) => isArabicFirstWait(step));
  if (
    firstArabicWaitIdx >= 0
    && firstIdentityIdx >= 0
    && firstArabicWaitIdx < firstIdentityIdx
  ) {
    filteredPerMemberSteps.splice(firstArabicWaitIdx, 1);
  }

  const firstArabicFillIdx = filteredPerMemberSteps.findIndex((step) => isArabicFirstFill(step));
  if (firstArabicFillIdx >= 0) {
    const hasNextBeforeArabic = filteredPerMemberSteps.some((step, idx) => idx < firstArabicFillIdx && isNextStep(step));
    if (!hasNextBeforeArabic) {
      const bridgeSteps = [
        {
          action: "wait_for_enabled",
          selector: NEXT_BUTTON_SELECTOR,
          timeout_ms: 30000,
        },
        {
          action: "click",
          selector: NEXT_BUTTON_SELECTOR,
          timeout_ms: 10000,
        },
        {
          action: "wait_for_selector",
          selector: "div[formgroupname='firstName'] input[formcontrolname='ar'], input[placeholder*='Arabic'][placeholder*='First'], input[formcontrolname='profession'], input[placeholder='Profession']",
          timeout_ms: 120000,
        },
      ];
      filteredPerMemberSteps.splice(firstArabicFillIdx, 0, ...bridgeSteps);
    } else if (!filteredPerMemberSteps.some((step, idx) => idx < firstArabicFillIdx && isArabicFirstWait(step))) {
      filteredPerMemberSteps.splice(firstArabicFillIdx, 0, {
        action: "wait_for_selector",
        selector: "div[formgroupname='firstName'] input[formcontrolname='ar'], input[placeholder*='Arabic'][placeholder*='First'], input[formcontrolname='profession'], input[placeholder='Profession']",
        timeout_ms: 120000,
      });
    }
  }

  // Ensure PAGE 2 -> PAGE 3 transition exists before Disclosure steps.
  const firstDisclosureBoundaryIdx = filteredPerMemberSteps.findIndex((step) => {
    const action = String(step?.action ?? "").trim().toLowerCase();
    const selector = String(step?.selector ?? "").trim().toLowerCase();
    return action === "set_disclosure_all_no" || selector.includes("disclosure form");
  });
  if (firstDisclosureBoundaryIdx > 0) {
    let nextClicksBeforeDisclosure = 0;
    for (let i = 0; i < firstDisclosureBoundaryIdx; i += 1) {
      if (isNextStep(filteredPerMemberSteps[i])) {
        nextClicksBeforeDisclosure += 1;
      }
    }
    if (nextClicksBeforeDisclosure < 2) {
      const hasImmediatePair = firstDisclosureBoundaryIdx >= 2
        && isNextWaitStep(filteredPerMemberSteps[firstDisclosureBoundaryIdx - 2])
        && isNextStep(filteredPerMemberSteps[firstDisclosureBoundaryIdx - 1]);
      if (!hasImmediatePair) {
        filteredPerMemberSteps.splice(firstDisclosureBoundaryIdx, 0,
          {
            action: "wait_for_enabled",
            selector: NEXT_BUTTON_SELECTOR,
            timeout_ms: 30000,
          },
          {
            action: "click",
            selector: NEXT_BUTTON_SELECTOR,
            timeout_ms: 10000,
          }
        );
      }
    }
  }

  // Normalize malformed Next pair where click exists without wait_for_enabled before it.
  for (let i = 0; i < filteredPerMemberSteps.length; i += 1) {
    if (!isNextStep(filteredPerMemberSteps[i])) {
      continue;
    }
    if (i > 0 && isNextWaitStep(filteredPerMemberSteps[i - 1])) {
      continue;
    }
    filteredPerMemberSteps.splice(i, 0, {
      action: "wait_for_enabled",
      selector: NEXT_BUTTON_SELECTOR,
      timeout_ms: 30000,
    });
    i += 1;
  }

  normalized.per_member_steps = filteredPerMemberSteps;
  return normalized;
}
