import {
  buildManifestForEntryExport as buildEntryExportManifest,
  effectiveSelectedIdsForExport as effectiveSelectedIdsForExportFromManifest,
  isMemberReadyForJson as isMemberReadyForJsonFromExport,
  validateCompanionsForExport,
} from "./main-export.js";
import {
  buildExportPreviewState,
} from "./main-entry-render.js";

export function createEntryFlow({
  dom,
  state,
  manifestMembers,
  reviewCompletionState,
  requiredFieldBlockingIssueForBatch,
  showBatchReviewBlockingMessage,
  syncPassportPageWithActiveMember,
  isEntryAccessible,
  renderAll,
  renderReviewExportModal,
  flushManifestSave,
  createNusukBatch,
  now = () => new Date(),
}) {
  function appendEntryLog(message, level = "info") {
    const text = String(message ?? "").trim();
    if (!text) {
      return;
    }
    const timestamp = now().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const tag = String(level || "info").toUpperCase();
    state.entryLogs.push(`[${timestamp}] [${tag}] ${text}`);
    if (state.entryLogs.length > 120) {
      state.entryLogs = state.entryLogs.slice(-120);
    }
    renderReviewExportModal();
    renderEntryLogs();
  }

  function renderEntryLogs() {
    if (!dom.entryLogBox || !dom.entryLogCounter) {
      return;
    }
    const lines = state.entryLogs.length
      ? state.entryLogs
      : ["Belum ada aktivitas export."];
    dom.entryLogBox.textContent = lines.join("\n");
    dom.entryLogCounter.textContent = `${state.entryLogs.length} log`;
  }

  async function handlePrepareEntry() {
    if (state.isEntryRunning) {
      appendEntryLog("Export JSON masih berjalan. Tunggu proses aktif selesai.", "warn");
      return;
    }

    appendEntryLog("Tombol Export JSON diklik.");
    state.exportError = "";
    if (!state.manifestPath || !state.manifest) {
      state.statusHeadline = "Belum ada hasil scan";
      state.statusDetail = "Jalankan proses terlebih dahulu sebelum membuat JSON untuk extension.";
      appendEntryLog("Gagal export: manifest belum tersedia.", "error");
      renderAll();
      return;
    }

    const review = reviewCompletionState();
    if (review.remaining > 0) {
      state.exportError = `Masih ada ${review.remaining} data yang belum ditandai siap.`;
      state.statusHeadline = "Review belum selesai";
      state.statusDetail = `Masih ada ${review.remaining} data yang belum ditandai siap sebelum membuat JSON untuk extension.`;
      state.currentPage = "validation";
      appendEntryLog(`Gagal export: review belum selesai (${review.remaining} data belum siap).`, "warn");
      renderAll();
      return;
    }

    const requiredFieldsIssue = requiredFieldBlockingIssueForBatch();
    if (!requiredFieldsIssue.ok) {
      state.exportError = requiredFieldsIssue.message;
      appendEntryLog(`Gagal export: ${requiredFieldsIssue.message}`, "warn");
      showBatchReviewBlockingMessage(requiredFieldsIssue);
      return;
    }

    const companionValidation = validateCompanionsBeforeExport();
    if (!companionValidation.ok) {
      state.exportError = companionValidation.message;
      state.statusHeadline = "Companion belum lengkap";
      state.statusDetail = companionValidation.message;
      state.currentPage = "validation";
      appendEntryLog(`Gagal export: ${companionValidation.message}`, "warn");
      if (companionValidation.firstMemberId) {
        state.activeMemberId = companionValidation.firstMemberId;
        syncPassportPageWithActiveMember();
      }
      renderAll();
      return;
    }

    if (!canExportReviewedJson()) {
      state.exportError = "Tidak ada passport valid yang sudah direview untuk diexport.";
      state.statusHeadline = "Tidak ada data export";
      state.statusDetail = state.exportError;
      appendEntryLog(`Gagal export: ${state.exportError}`, "warn");
      renderAll();
      return;
    }

    try {
      state.isEntryRunning = true;
      state.statusHeadline = "Membuat JSON";
      state.statusDetail = "Menyiapkan file JSON untuk diupload ke extension.";
      appendEntryLog("Membuat batch data Nusuk untuk extension...");
      renderAll();
      await flushManifestSave();
      const exportManifest = buildManifestForEntryExport();
      const selectedIds = Array.from(state.selectedIds);
      const batchPath = await createNusukBatch({
        manifestPath: state.manifestPath,
        selectedIds,
        manifestData: exportManifest,
      });
      state.exportedBatchPath = batchPath;
      appendEntryLog(`JSON untuk extension dibuat: ${batchPath}`, "success");
      appendEntryLog("Buka extension Nusuk Autofill, upload file JSON ini, lalu pilih folder/file passport di panel extension.");
      state.statusHeadline = "JSON siap diupload";
      state.statusDetail = `File dibuat di ${batchPath}. Upload file ini ke extension Nusuk Autofill.`;
      renderAll();
    } catch (error) {
      const rawError = String(error ?? "");
      state.exportError = rawError || "Gagal membuat JSON untuk extension.";
      state.statusHeadline = "Export JSON gagal";
      state.statusDetail = rawError || "Gagal membuat JSON untuk extension.";
      appendEntryLog(`Export JSON gagal: ${truncateForLog(rawError, 700)}`, "error");
      appendEntryLog(`Detail teknis: ${truncateForLog(rawError, 700)}`, "error");
    } finally {
      state.isEntryRunning = false;
      renderAll();
    }
  }

  function validateCompanionsBeforeExport() {
    return validateCompanionsForExport(state.manifest, state.selectedIds);
  }

  function buildManifestForEntryExport() {
    const result = buildEntryExportManifest(state.manifest, state.selectedIds);
    state.selectedIds = result.selectedIds;
    return result.manifest;
  }

  function effectiveSelectedIdsForExport() {
    return effectiveSelectedIdsForExportFromManifest(state.manifest, state.selectedIds);
  }

  function isMemberReadyForJson(member) {
    return isMemberReadyForJsonFromExport(member, state.reviewedMemberIds);
  }

  function canExportReviewedJson() {
    if (!isEntryAccessible()) {
      return false;
    }
    const selectedIds = effectiveSelectedIdsForExport();
    return manifestMembers().some((member) => selectedIds.has(String(member.id || "")) && isMemberReadyForJson(member));
  }

  function exportPreviewState() {
    return buildExportPreviewState({
      members: manifestMembers(),
      selectedIds: effectiveSelectedIdsForExport(),
      review: reviewCompletionState(),
      reviewedMemberIds: state.reviewedMemberIds,
      canExportReviewedJson: canExportReviewedJson(),
      isEntryRunning: state.isEntryRunning,
    });
  }

  return {
    appendEntryLog,
    buildManifestForEntryExport,
    canExportReviewedJson,
    effectiveSelectedIdsForExport,
    exportPreviewState,
    handlePrepareEntry,
    isMemberReadyForJson,
    renderEntryLogs,
    validateCompanionsBeforeExport,
  };
}

export function truncateForLog(value, maxLength = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
