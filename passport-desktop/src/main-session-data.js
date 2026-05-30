import { basenameFromPath } from "./main-utils.js";
import { normalizeOcrMode } from "./main-ocr.js";
import { STORAGE_KEYS } from "./main-state.js";
import { refreshCompactLogsForState } from "./main-scan-render.js";
import {
  buildRememberedRecentBatches,
  loadRecentBatches as loadRecentBatchesFromStorage,
  saveRecentBatches as saveRecentBatchesToStorage,
} from "./main-recent-batches.js";

export function createSessionDataController({
  state,
  manifestMembers,
  recentBatchesStorageKey = STORAGE_KEYS.recentBatches,
}) {
  function recentEntryByPath(path) {
    const targetPath = String(path || "").trim();
    return state.recentBatches.find((entry) => entry.path === targetPath) || null;
  }

  function appendScanLog(message) {
    const trimmed = String(message ?? "").trim();
    if (!trimmed) {
      return;
    }

    state.lastWorkerMessage = trimmed;
    refreshCompactLogs();
  }

  function refreshCompactLogs() {
    refreshCompactLogsForState(state, manifestMembers());
  }

  function rememberRecentBatch(path, totalFiles = 0, manifestPath = "") {
    state.recentBatches = buildRememberedRecentBatches(
      state.recentBatches,
      path,
      totalFiles,
      manifestPath,
      basenameFromPath,
    );
    saveRecentBatches(state.recentBatches);
  }

  function loadRecentBatches() {
    return loadRecentBatchesFromStorage(recentBatchesStorageKey, basenameFromPath);
  }

  function saveRecentBatches(entries) {
    saveRecentBatchesToStorage(recentBatchesStorageKey, entries);
  }

  function updateOcrMode(value) {
    state.ocrMode = normalizeOcrMode(value);
  }

  return {
    appendScanLog,
    loadRecentBatches,
    recentEntryByPath,
    refreshCompactLogs,
    rememberRecentBatch,
    saveRecentBatches,
    updateOcrMode,
  };
}
