import { basenameFromPath } from "../shared/utils.js";

export function createPageFlow({
  dom,
  state,
  manifestMembers,
  reviewCompletionState,
  requiredFieldBlockingIssueForBatch,
  showBatchReviewBlockingMessage,
  hasFolderSelectionConflict,
  renderAll,
}) {
  function setPage(page) {
    if (!["import", "prepare", "scan", "validation", "entry"].includes(page)) {
      return;
    }

    if (hasFolderSelectionConflict() && !["import", "prepare", "scan"].includes(page)) {
      const activeFolder = basenameFromPath(state.resultSourceDir || state.resultDir || "-");
      const selectedFolder = basenameFromPath(state.selectedDir || "-");
      state.statusHeadline = "Konfirmasi folder dulu";
      state.statusDetail = `Data aktif masih dari folder ${activeFolder}, sementara kamu memilih ${selectedFolder}. Proses folder yang dipilih dulu untuk melanjutkan.`;
      state.currentPage = "import";
      renderAll();
      return;
    }

    if (page === "prepare" && !state.selectedDir) {
      state.statusHeadline = "Folder belum dipilih";
      state.statusDetail = "Pilih folder berisi foto passport sebelum menyiapkan foto.";
      state.currentPage = "import";
      renderAll();
      return;
    }

    if (page === "scan" && !state.preparedSession && !state.isScanning) {
      state.statusHeadline = "Foto belum siap";
      state.statusDetail = "Siapkan foto terlebih dahulu sebelum memulai OCR.";
      state.currentPage = state.selectedDir ? "prepare" : "import";
      renderAll();
      return;
    }

    if (page === "validation" && (!state.manifestPath || !state.manifest || !manifestMembers().length)) {
      state.statusHeadline = "Belum ada hasil OCR";
      state.statusDetail = "Jalankan scan sampai selesai sebelum membuka halaman review.";
      state.currentPage = state.isScanning ? "scan" : state.selectedDir ? "prepare" : "import";
      renderAll();
      return;
    }

    if (page === "entry") {
      if (!state.manifestPath || !state.manifest || !manifestMembers().length) {
        state.statusHeadline = "Belum ada data hasil scan";
        state.statusDetail = "Selesaikan proses scan terlebih dahulu sebelum membuka preview export JSON.";
        state.currentPage = "import";
        renderAll();
        return;
      }

      const review = reviewCompletionState();
      if (review.remaining > 0) {
        state.statusHeadline = "Review belum selesai";
        state.statusDetail = `Masih ada ${review.remaining} passport yang perlu ditandai dicek sebelum preview/export JSON.`;
        state.currentPage = "validation";
        renderAll();
        return;
      }

      const requiredFieldsIssue = requiredFieldBlockingIssueForBatch();
      if (!requiredFieldsIssue.ok) {
        showBatchReviewBlockingMessage(requiredFieldsIssue);
        return;
      }
    }

    state.currentPage = page;
    renderAll();
  }

  function openReviewCompleteModal() {
    setPage("entry");
  }

  function closeReviewCompleteModal() {
    if (!dom.reviewCompleteModal) {
      return;
    }
    dom.reviewCompleteModal.classList.add("is-hidden");
    dom.reviewCompleteModal.setAttribute("aria-hidden", "true");
  }

  return {
    closeReviewCompleteModal,
    openReviewCompleteModal,
    setPage,
  };
}
