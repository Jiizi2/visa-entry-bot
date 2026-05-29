import { escapeHtml } from "./main-utils.js";
import { errorMessage } from "./main-system.js";

export function createRuntimeController({
  state,
  appendScanLog,
  renderAll,
  documentRef = globalThis.document,
}) {
  function runAction(action, label = "Aksi aplikasi") {
    try {
      const result = typeof action === "function" ? action() : action;
      if (result && typeof result.then === "function") {
        result.catch((error) => reportRuntimeError(error, label));
      }
    } catch (error) {
      reportRuntimeError(error, label);
    }
  }

  function reportRuntimeError(error, label = "Aksi aplikasi") {
    const message = errorMessage(error);
    state.statusHeadline = `${label} gagal`;
    state.statusDetail = message;
    state.isChoosingFolder = false;
    state.isStartingScan = false;
    appendScanLog(`[APP] ${label} gagal | ${message}`);

    try {
      renderAll();
    } catch (renderError) {
      showFatalScreen(`${label}: ${message}\n\nRender: ${errorMessage(renderError)}`);
    }
  }

  function showFatalScreen(message) {
    if (!documentRef?.body) {
      return;
    }

    documentRef.body.innerHTML = `
      <main style="min-height:100vh;display:grid;place-items:center;padding:32px;background:#f9f9fd;color:#191c1e;font-family:Inter,Segoe UI,sans-serif;">
        <section style="width:min(720px,100%);padding:28px;border-radius:14px;background:#ffffff;box-shadow:0 16px 40px rgba(25,28,30,.06);">
          <p style="margin:0 0 8px;color:#626875;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Frontend Error</p>
          <h1 style="margin:0 0 12px;font-size:32px;line-height:1.1;">Halaman gagal dimuat</h1>
          <p style="margin:0 0 16px;color:#626875;">Frontend mengalami error saat startup. Pesan yang terbaca:</p>
          <pre style="margin:0;padding:16px;border-radius:10px;background:#f3f3f7;color:#191c1e;white-space:pre-wrap;word-break:break-word;">${escapeHtml(message)}</pre>
        </section>
      </main>
    `;
  }

  return {
    reportRuntimeError,
    runAction,
    showFatalScreen,
  };
}
