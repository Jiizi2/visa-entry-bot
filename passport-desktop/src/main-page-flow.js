import { basenameFromPath } from "./main-utils.js";

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
    if (!["import", "validation", "entry"].includes(page)) {
      return;
    }

    if (hasFolderSelectionConflict() && page !== "import") {
      const activeFolder = basenameFromPath(state.resultSourceDir || state.resultDir || "-");
      const selectedFolder = basenameFromPath(state.selectedDir || "-");
      state.statusHeadline = "Konfirmasi folder dulu";
      state.statusDetail = `Data aktif masih dari folder ${activeFolder}, sementara kamu memilih ${selectedFolder}. Proses folder yang dipilih dulu untuk melanjutkan.`;
      state.currentPage = "import";
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
