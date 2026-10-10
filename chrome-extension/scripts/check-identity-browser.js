// Local DOM regression tests against the production scripts; no Nusuk account or network is used.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
const browser = candidates.find(candidate => fs.existsSync(candidate));
if (!browser) throw new Error("Chrome/Edge not found. Set CHROME_PATH to run browser safety tests.");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "entrymate-identity-test-"));
const fixture = pathToFileURL(path.resolve(__dirname, "../test/browser/identity-safety.html")).href;
const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", `--user-data-dir=${profile}`, "--dump-dom", "--virtual-time-budget=10000", fixture], { windowsHide: true });
let output = "", errors = "";
child.stdout.on("data", data => { output += data; });
child.stderr.on("data", data => { errors = (errors + data).slice(-3000); });
const deadline = setTimeout(() => { child.kill(); }, 25000);
child.on("error", error => { clearTimeout(deadline); console.error(error.message); process.exitCode = 1; });
child.on("close", () => {
  clearTimeout(deadline);
  try {
    const encoded = output.match(/<pre id="results">([^<]*)<\/pre>/)?.[1];
    if (!encoded || encoded === "RUNNING") throw new Error(`Browser tests did not finish. ${errors}`);
    const decoded = encoded.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const result = JSON.parse(decoded);
    if (result.fatal) throw new Error(result.fatal);
    for (const test of result.results.filter(test => !test.ok)) console.error(`${test.name}: ${test.error}`);
    console.log(`Browser identity safety: ${result.passed}/${result.total} passed`);
    if (result.passed !== result.total) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally {
    // Only remove the exact temporary directory created for this browser test.
    const resolved = path.resolve(profile), tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (resolved.startsWith(tempRoot) && path.basename(resolved).startsWith("entrymate-identity-test-")) {
      try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* Chrome may briefly retain a profile handle. */ }
    }
  }
});
