import { PASSPORT_PREVIEW_ZOOM_STEP } from "./main-passport-preview.js";
import { closestFromEventTarget } from "./main-system.js";

export function bindActions({
  dom,
  state,
  runAction,
  setPage,
  updateSelectedDir,
  renderImportPage,
  updateActionAvailability,
  chooseFolder,
  handleScanButtonClick,
  handleStartScanButtonClick = handleScanButtonClick,
  handleOcrModeChange,
  selectPreparedPassport = () => {},
  rotatePreparedPassport = () => {},
  flipPreparedPassport = () => {},
  changePreparedPreviewZoom = () => {},
  resetPreparedPreviewZoom = () => {},
  openPreparedLargePreview = () => {},
  closePreparedLargePreview = () => {},
  openPreparedCropModal = () => {},
  openPreparedDeleteModal = () => {},
  closePreparedDeleteModal = () => {},
  confirmPreparedDelete = () => {},
  openStopScanModal,
  resolveRescanConfirmation,
  confirmStopScan,
  closeStopScanModal,
  confirmRecentDelete,
  closeRecentDeleteModal,
  confirmRecentEdit,
  closeRecentEditModal,
  confirmPassportDelete,
  closePassportDeleteModal,
  closeReviewCompleteModal,
  handlePrepareEntry,
  handleExportPreviewMemberClick,
  renderEntryLogs,
  openRecentBatch,
  openRecentEditModal,
  openRecentDeleteModal,
  ensureVisibleActiveMember,
  renderAll,
  scrollPassportListToTop,
  updateActiveMemberCompanion,
  scheduleRenderAll,
  updateActiveMemberCompanionRelation,
  updateActiveMemberField,
  resetActiveMemberFields,
  openPassportDeleteModal,
  handleSaveAndNext,
  renderWorkspace,
  moveActiveMember,
  changePassportPreviewZoom,
  resetPassportPreviewZoom,
  handlePassportPreviewWheel,
  handlePassportPreviewKeydown,
  openPassportCropModal = () => {},
  closePassportCropModal = () => {},
  resetPassportCropRect = () => {},
  savePassportCrop = () => {},
  handlePassportCropPointerDown = () => {},
  handlePassportCropPointerMove = () => {},
  handlePassportCropPointerUp = () => {},
  handlePassportCropKeydown = () => {},
  handlePassportCropZoomInput = () => {},
  handlePassportCropResize = () => {},
  appWindow = window,
}) {
  for (const button of dom.navButtons) {
    button.addEventListener("click", () => {
      setPage(button.dataset.page);
    });
  }

  dom.folderPath.addEventListener("input", (event) => {
    updateSelectedDir(event.target.value);
    renderImportPage();
    updateActionAvailability();
  });

  dom.chooseFolderButton.addEventListener("click", (event) => {
    event.stopPropagation();
    runAction(() => chooseFolder(), "Pilih folder");
  });

  dom.folderDropzone.addEventListener("click", (event) => {
    if (
      state.isScanning
      || state.isPreparingImages
      || state.isChoosingFolder
      || closestFromEventTarget(event.target, "button")
      || closestFromEventTarget(event.target, "input")
    ) {
      return;
    }
    runAction(() => chooseFolder(), "Pilih folder");
  });

  dom.folderDropzone.addEventListener("keydown", (event) => {
    if (state.isScanning || state.isChoosingFolder || state.isPreparingImages) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      runAction(() => chooseFolder(), "Pilih folder");
    }
  });

  dom.scanButton.addEventListener("click", () => {
    runAction(() => handleScanButtonClick(), "Siapkan foto");
  });
  dom.startScanButton?.addEventListener("click", () => {
    runAction(() => handleStartScanButtonClick(), "Mulai scan");
  });
  dom.prepareBackButton?.addEventListener("click", () => {
    setPage("import");
  });
  dom.lastScanOpenButton?.addEventListener("click", () => {
    setPage("validation");
  });
  for (const input of dom.ocrModeInputs) {
    input.addEventListener("change", (event) => {
      runAction(() => handleOcrModeChange(event), "Ganti mode OCR");
    });
  }
  dom.stopScanButton?.addEventListener("click", openStopScanModal);
  dom.importNextButton?.addEventListener("click", () => {
    setPage("validation");
  });
  dom.rescanConfirmButton?.addEventListener("click", () => {
    resolveRescanConfirmation(true);
  });
  dom.rescanCancelButton?.addEventListener("click", () => {
    resolveRescanConfirmation(false);
  });
  dom.rescanConfirmModal?.addEventListener("click", (event) => {
    if (event.target === dom.rescanConfirmModal) {
      resolveRescanConfirmation(false);
    }
  });
  dom.stopScanConfirmButton?.addEventListener("click", () => {
    runAction(() => confirmStopScan(), "Stop scan");
  });
  dom.stopScanCancelButton?.addEventListener("click", closeStopScanModal);
  dom.stopScanConfirmModal?.addEventListener("click", (event) => {
    if (event.target === dom.stopScanConfirmModal) {
      closeStopScanModal();
    }
  });
  dom.recentDeleteConfirmButton?.addEventListener("click", confirmRecentDelete);
  dom.recentDeleteCancelButton?.addEventListener("click", closeRecentDeleteModal);
  dom.recentDeleteModal?.addEventListener("click", (event) => {
    if (event.target === dom.recentDeleteModal) {
      closeRecentDeleteModal();
    }
  });
  dom.recentEditSaveButton?.addEventListener("click", confirmRecentEdit);
  dom.recentEditCancelButton?.addEventListener("click", closeRecentEditModal);
  dom.recentEditModal?.addEventListener("click", (event) => {
    if (event.target === dom.recentEditModal) {
      closeRecentEditModal();
    }
  });
  dom.recentEditInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmRecentEdit();
    }
  });
  dom.passportDeleteConfirmButton?.addEventListener("click", confirmPassportDelete);
  dom.passportDeleteCancelButton?.addEventListener("click", closePassportDeleteModal);
  dom.passportDeleteModal?.addEventListener("click", (event) => {
    if (event.target === dom.passportDeleteModal) {
      closePassportDeleteModal();
    }
  });
  dom.reviewCompleteCancelButton?.addEventListener("click", closeReviewCompleteModal);
  dom.reviewCompleteExportButton?.addEventListener("click", () => {
    runAction(() => handlePrepareEntry(), "Export JSON");
  });
  dom.reviewPreviewExportButton?.addEventListener("click", () => {
    setPage("entry");
  });
  dom.reviewCompleteModal?.addEventListener("click", (event) => {
    if (event.target === dom.reviewCompleteModal) {
      closeReviewCompleteModal();
    }
  });
  dom.preparedDeleteConfirmButton?.addEventListener("click", () => {
    runAction(() => confirmPreparedDelete(), "Hapus foto persiapan");
  });
  dom.preparedDeleteCancelButton?.addEventListener("click", closePreparedDeleteModal);
  dom.preparedDeleteModal?.addEventListener("click", (event) => {
    if (event.target === dom.preparedDeleteModal) {
      closePreparedDeleteModal();
    }
  });
  dom.preparedPreviewModalCloseButton?.addEventListener("click", closePreparedLargePreview);
  dom.preparedPreviewModal?.addEventListener("click", (event) => {
    if (event.target === dom.preparedPreviewModal) {
      closePreparedLargePreview();
    }
  });
  dom.entryBackReviewButton?.addEventListener("click", () => {
    setPage("validation");
  });
  dom.prepareEntryButton?.addEventListener("click", () => {
    runAction(() => handlePrepareEntry(), "Export JSON");
  });
  dom.reviewExportPreviewBody?.addEventListener("click", handleExportPreviewMemberClick);
  dom.entryExportPreviewBody?.addEventListener("click", handleExportPreviewMemberClick);
  dom.entryLogClearButton?.addEventListener("click", () => {
    state.entryLogs = [];
    renderEntryLogs();
  });
  appWindow.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.rescanConfirmModal?.classList.contains("is-hidden")) {
      resolveRescanConfirmation(false);
      return;
    }
    if (event.key === "Escape" && !dom.stopScanConfirmModal?.classList.contains("is-hidden")) {
      closeStopScanModal();
      return;
    }
    if (event.key === "Escape" && !dom.recentDeleteModal?.classList.contains("is-hidden")) {
      closeRecentDeleteModal();
      return;
    }
    if (event.key === "Escape" && !dom.recentEditModal?.classList.contains("is-hidden")) {
      closeRecentEditModal();
      return;
    }
    if (event.key === "Escape" && !dom.passportDeleteModal?.classList.contains("is-hidden")) {
      closePassportDeleteModal();
      return;
    }
    if (event.key === "Escape" && !dom.reviewCompleteModal?.classList.contains("is-hidden")) {
      closeReviewCompleteModal();
      return;
    }
    if (event.key === "Escape" && !dom.preparedDeleteModal?.classList.contains("is-hidden")) {
      closePreparedDeleteModal();
      return;
    }
    if (event.key === "Escape" && !dom.preparedPreviewModal?.classList.contains("is-hidden")) {
      closePreparedLargePreview();
      return;
    }
    if (event.key === "Escape" && !dom.passportCropModal?.classList.contains("is-hidden")) {
      closePassportCropModal();
    }
  });
  appWindow.addEventListener("resize", handlePassportCropResize);
  dom.scanLogToggle?.addEventListener("click", () => {
    state.showFullScanLog = !state.showFullScanLog;
    renderScanLogs();
  });

  dom.preparedPassportList?.addEventListener("click", (event) => {
    const item = closestFromEventTarget(event.target, "[data-prepared-id]");
    if (!item) {
      return;
    }
    selectPreparedPassport(item.dataset.preparedId ?? "");
  });
  dom.preparedRotateLeftButton?.addEventListener("click", () => {
    runAction(() => rotatePreparedPassport(-1), "Putar foto");
  });
  dom.preparedRotateRightButton?.addEventListener("click", () => {
    runAction(() => rotatePreparedPassport(1), "Putar foto");
  });
  dom.preparedFlipHorizontalButton?.addEventListener("click", () => {
    runAction(() => flipPreparedPassport("horizontal"), "Flip foto");
  });
  dom.preparedFlipVerticalButton?.addEventListener("click", () => {
    runAction(() => flipPreparedPassport("vertical"), "Flip foto");
  });
  dom.preparedZoomOutButton?.addEventListener("click", () => {
    changePreparedPreviewZoom(-0.1);
  });
  dom.preparedZoomInButton?.addEventListener("click", () => {
    changePreparedPreviewZoom(0.1);
  });
  dom.preparedZoomResetButton?.addEventListener("click", resetPreparedPreviewZoom);
  dom.preparedPreviewLargeButton?.addEventListener("click", () => {
    runAction(() => openPreparedLargePreview(), "Preview besar foto");
  });
  dom.preparedCropButton?.addEventListener("click", () => {
    runAction(() => openPreparedCropModal(), "Crop foto sebelum scan");
  });
  dom.preparedDeleteButton?.addEventListener("click", () => {
    openPreparedDeleteModal();
  });

  dom.recentBatchesList.addEventListener("click", (event) => {
    const editButton = closestFromEventTarget(event.target, "[data-recent-edit-path]");
    if (editButton) {
      event.preventDefault();
      event.stopPropagation();
      openRecentEditModal(editButton.dataset.recentEditPath ?? "");
      return;
    }

    const deleteButton = closestFromEventTarget(event.target, "[data-recent-delete-path]");
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      openRecentDeleteModal(deleteButton.dataset.recentDeletePath ?? "");
      return;
    }

    const item = closestFromEventTarget(event.target, "[data-recent-path]");
    if (!item) {
      return;
    }
    const recentPath = String(item.dataset.recentPath ?? "").trim();
    if (!recentPath) {
      return;
    }
    runAction(() => openRecentBatch(recentPath), "Buka riwayat");
  });

  dom.recentBatchesList.addEventListener("keydown", (event) => {
    if (closestFromEventTarget(event.target, "button") || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    const item = closestFromEventTarget(event.target, "[data-recent-path]");
    if (!item) {
      return;
    }
    event.preventDefault();
    runAction(() => openRecentBatch(item.dataset.recentPath ?? ""), "Buka riwayat");
  });

  for (const button of dom.filterButtons) {
    button.addEventListener("click", () => {
      state.validationFilter = button.dataset.validationFilter ?? "all";
      state.passportListPage = 1;
      ensureVisibleActiveMember();
      renderAll();
      scrollPassportListToTop();
    });
  }

  dom.passportList?.addEventListener("click", (event) => {
    const row = closestFromEventTarget(event.target, "[data-member-id]");
    if (!row) {
      return;
    }

    state.activeMemberId = row.dataset.memberId ?? "";
    syncPassportPageWithActiveMember();
    renderAll();
  });

  dom.fieldReviewRows.addEventListener("change", (event) => {
    const companionSelect = closestFromEventTarget(event.target, "select[data-companion-select]");
    if (companionSelect) {
      updateActiveMemberCompanion(companionSelect.value);
      scheduleRenderAll();
      return;
    }

    const companionRelationSelect = closestFromEventTarget(event.target, "select[data-companion-relation-select]");
    if (companionRelationSelect) {
      updateActiveMemberCompanionRelation(companionRelationSelect.value);
      scheduleRenderAll();
      return;
    }

    const input = closestFromEventTarget(event.target, "input[data-field-key]");
    if (!input) {
      return;
    }

    updateActiveMemberField(input.dataset.fieldKey, input.value);
    scheduleRenderAll();
  });

  dom.resetFieldsButton.addEventListener("click", resetActiveMemberFields);
  dom.deletePassportButton?.addEventListener("click", () => {
    openPassportDeleteModal();
  });
  dom.saveNextButton?.addEventListener("click", handleSaveAndNext);
  dom.fieldCategoryTabs?.addEventListener("click", (event) => {
    const button = closestFromEventTarget(event.target, "button[data-field-category]");
    if (!button) {
      return;
    }
    state.activeFieldCategory = button.dataset.fieldCategory ?? "identity";
    renderWorkspace();
  });
  dom.passportPagePrevButton?.addEventListener("click", () => {
    moveActiveMember(-1);
  });
  dom.passportPageNextButton?.addEventListener("click", () => {
    moveActiveMember(1);
  });
  dom.passportZoomOutButton?.addEventListener("click", () => {
    changePassportPreviewZoom(-PASSPORT_PREVIEW_ZOOM_STEP);
  });
  dom.passportZoomInButton?.addEventListener("click", () => {
    changePassportPreviewZoom(PASSPORT_PREVIEW_ZOOM_STEP);
  });
  dom.passportZoomResetButton?.addEventListener("click", resetPassportPreviewZoom);
  dom.passportPreviewFrame?.addEventListener("wheel", handlePassportPreviewWheel, { passive: false });
  dom.passportPreviewFrame?.addEventListener("keydown", handlePassportPreviewKeydown);
  dom.passportCropButton?.addEventListener("click", () => {
    runAction(() => openPassportCropModal(), "Crop foto passport");
  });
  dom.passportCropCancelButton?.addEventListener("click", closePassportCropModal);
  dom.passportCropModal?.addEventListener("click", (event) => {
    if (event.target === dom.passportCropModal) {
      closePassportCropModal();
    }
  });
  dom.passportCropResetButton?.addEventListener("click", resetPassportCropRect);
  dom.passportCropSaveButton?.addEventListener("click", () => {
    runAction(() => savePassportCrop(), "Simpan crop foto");
  });
  dom.passportCropZoomInput?.addEventListener("input", handlePassportCropZoomInput);
  dom.passportCropCanvas?.addEventListener("pointerdown", handlePassportCropPointerDown);
  dom.passportCropCanvas?.addEventListener("pointermove", handlePassportCropPointerMove);
  dom.passportCropCanvas?.addEventListener("pointerup", handlePassportCropPointerUp);
  dom.passportCropCanvas?.addEventListener("pointercancel", handlePassportCropPointerUp);
  dom.passportCropCanvas?.addEventListener("keydown", handlePassportCropKeydown);

  for (const button of dom.workspacePrevButtons) {
    button.addEventListener("click", () => {
      moveActiveMember(-1);
    });
  }

  for (const button of dom.workspaceNextButtons) {
    button.addEventListener("click", () => {
      moveActiveMember(1);
    });
  }
}
