import { cloneJson } from "./main-utils.js";
import {
  confirmedReviewIds,
  defaultSelectedIds,
} from "./main-export.js";
import {
  requiredFieldBlockingIssueForBatch as requiredFieldBlockingIssueForMembers,
  reviewCompletionValidation as reviewCompletionValidationForMember,
} from "./main-review-validation.js";

export function createManifestWorkflow({
  state,
  manifestMembers,
  syncManifestChildMetadata,
  firstMemberId,
  recalculateMetrics,
  ensureVisibleActiveMember,
  renderAll,
  loadManifestCommand,
  hasAnyScanResult,
  hasScanResultForSelectedDir,
}) {
  async function loadManifest() {
    if (!state.manifestPath) {
      return;
    }

    const manifest = await loadManifestCommand(state.manifestPath);
    syncManifestChildMetadata(manifest);
    state.manifest = manifest;
    state.originalManifest = cloneJson(manifest);
    state.activeMemberId = firstMemberId(manifest);
    state.selectedIds = new Set(defaultSelectedIds(manifest));
    state.reviewedMemberIds = confirmedReviewIds(manifest);
    state.passportImageCache.clear();
    state.exportedBatchPath = "";
    state.exportError = "";
    recalculateMetrics();
    ensureVisibleActiveMember();
  }

  function toggleMemberSelection(memberId, checked) {
    if (!memberId) {
      return;
    }

    if (checked) {
      state.selectedIds.add(memberId);
    } else {
      state.selectedIds.delete(memberId);
    }
    renderAll();
  }

  function reviewCompletionValidation(member) {
    return reviewCompletionValidationForMember(member, manifestMembers());
  }

  function requiredFieldBlockingIssueForBatch() {
    return requiredFieldBlockingIssueForMembers(manifestMembers());
  }

  function hasFolderSelectionConflict() {
    return Boolean(state.selectedDir && hasAnyScanResult() && !hasScanResultForSelectedDir());
  }

  return {
    hasFolderSelectionConflict,
    loadManifest,
    requiredFieldBlockingIssueForBatch,
    reviewCompletionValidation,
    toggleMemberSelection,
  };
}
