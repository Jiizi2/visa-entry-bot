import { memberReviewStatus } from "./main-entry.js";

export function createActionAvailabilityController({
  dom,
  state,
  activeMember,
  activeNavigationState,
  hasScanResultForSelectedDir,
  manifestMembers,
  reviewCompletionState,
  canExportReviewedJson,
  isMemberReviewConfirmed,
  reviewCompletionValidation,
}) {
  function updateActionAvailability() {
    const hasSelectedDir = Boolean(state.selectedDir.trim());
    const hasActiveMember = Boolean(activeMember());
    const navigation = activeNavigationState();
    const preparedCount = Array.isArray(state.preparedSession?.items) ? state.preparedSession.items.length : 0;

    const importBusy = Boolean(state.isScanning || state.isStartingScan || state.isPreparingImages);
    dom.scanButton.disabled = importBusy || !hasSelectedDir;
    if (dom.startScanButton) {
      dom.startScanButton.disabled = importBusy || preparedCount <= 0;
      dom.startScanButton.setAttribute("aria-disabled", dom.startScanButton.disabled ? "true" : "false");
      dom.startScanButton.setAttribute("aria-busy", state.isStartingScan || state.isScanning ? "true" : "false");
    }
    if (dom.prepareBackButton) {
      dom.prepareBackButton.disabled = importBusy;
      dom.prepareBackButton.setAttribute("aria-disabled", dom.prepareBackButton.disabled ? "true" : "false");
    }
    if (dom.lastScanOpenButton) {
      const canOpenLastScan = Boolean(state.manifestPath && state.manifest && manifestMembers().length && !state.isScanning);
      dom.lastScanOpenButton.disabled = !canOpenLastScan;
      dom.lastScanOpenButton.setAttribute("aria-disabled", dom.lastScanOpenButton.disabled ? "true" : "false");
    }
    if (dom.stopScanButton) {
      dom.stopScanButton.disabled = !state.isScanning || state.isStoppingScan;
      dom.stopScanButton.classList.toggle("is-hidden", !state.isScanning);
      dom.stopScanButton.setAttribute("aria-disabled", dom.stopScanButton.disabled ? "true" : "false");
    }
    if (dom.importNextButton) {
      const canGoNext = !state.isScanning && hasScanResultForSelectedDir();
      dom.importNextButton.disabled = !canGoNext;
      dom.importNextButton.setAttribute("aria-disabled", dom.importNextButton.disabled ? "true" : "false");
    }
    dom.chooseFolderButton.disabled = Boolean(state.isScanning || state.isChoosingFolder || state.isPreparingImages);
    dom.folderPath.disabled = Boolean(state.isScanning || state.isPreparingImages);
    for (const input of dom.ocrModeInputs || []) {
      input.disabled = Boolean(state.isScanning || state.isPreparingImages);
    }
    const folderBusy = Boolean(state.isScanning || state.isChoosingFolder || state.isPreparingImages);
    dom.folderDropzone.classList.toggle("is-busy", folderBusy);
    dom.folderDropzone.setAttribute("aria-disabled", folderBusy ? "true" : "false");
    dom.folderDropzone.setAttribute("aria-busy", folderBusy ? "true" : "false");

    if (dom.reviewPreviewExportButton) {
      const hasManifest = Boolean(state.manifestPath && state.manifest && manifestMembers().length);
      const canPreviewExport = hasManifest && reviewCompletionState().remaining === 0 && !state.isScanning;
      dom.reviewPreviewExportButton.classList.toggle("is-hidden", !hasManifest);
      dom.reviewPreviewExportButton.disabled = !canPreviewExport;
      dom.reviewPreviewExportButton.setAttribute("aria-disabled", dom.reviewPreviewExportButton.disabled ? "true" : "false");
    }
    if (dom.reviewCompleteExportButton) {
      dom.reviewCompleteExportButton.disabled = state.isEntryRunning || !canExportReviewedJson();
      dom.reviewCompleteExportButton.setAttribute("aria-disabled", dom.reviewCompleteExportButton.disabled ? "true" : "false");
    }
    if (dom.prepareEntryButton) {
      dom.prepareEntryButton.disabled = state.isEntryRunning || !canExportReviewedJson();
      dom.prepareEntryButton.setAttribute("aria-disabled", dom.prepareEntryButton.disabled ? "true" : "false");
    }
    if (dom.entryBackReviewButton) {
      dom.entryBackReviewButton.disabled = state.isEntryRunning;
      dom.entryBackReviewButton.setAttribute("aria-disabled", dom.entryBackReviewButton.disabled ? "true" : "false");
    }
    if (dom.deletePassportButton) {
      dom.deletePassportButton.disabled = !hasActiveMember || state.isScanning;
      dom.deletePassportButton.setAttribute("aria-disabled", dom.deletePassportButton.disabled ? "true" : "false");
    }
    dom.resetFieldsButton.disabled = !hasActiveMember;
    dom.saveNextButton.disabled = !hasActiveMember;
    dom.scanButton.setAttribute("aria-disabled", dom.scanButton.disabled ? "true" : "false");
    dom.chooseFolderButton.setAttribute("aria-disabled", dom.chooseFolderButton.disabled ? "true" : "false");
    dom.resetFieldsButton.setAttribute("aria-disabled", dom.resetFieldsButton.disabled ? "true" : "false");
    dom.saveNextButton.setAttribute("aria-disabled", dom.saveNextButton.disabled ? "true" : "false");

    for (const button of dom.navButtons) {
      button.disabled = false;
      button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
    }

    for (const button of dom.workspacePrevButtons) {
      button.disabled = !navigation.canMovePrev;
      button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
    }
    for (const button of dom.workspaceNextButtons) {
      button.disabled = !canAdvanceToNextPassport(navigation);
      button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
    }

    if (dom.passportPagePrevButton && dom.passportPageNextButton) {
      dom.passportPagePrevButton.disabled = !navigation.canMovePrev;
      dom.passportPageNextButton.disabled = !canAdvanceToNextPassport(navigation);
      dom.passportPagePrevButton.setAttribute("aria-disabled", dom.passportPagePrevButton.disabled ? "true" : "false");
      dom.passportPageNextButton.setAttribute("aria-disabled", dom.passportPageNextButton.disabled ? "true" : "false");
    }
  }

  function canAdvanceToNextPassport(navigation = activeNavigationState()) {
    const member = activeMember();
    if (navigation.canMoveNext && memberReviewStatus(member) === "ERROR") {
      return true;
    }
    return Boolean(
      navigation.canMoveNext
      && member
      && isMemberReviewConfirmed(member)
      && reviewCompletionValidation(member).ok
    );
  }

  return {
    canAdvanceToNextPassport,
    updateActionAvailability,
  };
}
