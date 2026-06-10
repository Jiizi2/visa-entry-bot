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
  function applyDefaultsToNewManifest(manifest) {
    if (!manifest || !Array.isArray(manifest.members)) {
      return;
    }
    for (const member of manifest.members) {
      if (!member.resolvedProfile || typeof member.resolvedProfile !== "object") {
        member.resolvedProfile = {};
      }
      const rp = member.resolvedProfile;
      if (!rp.profession || rp.profession === "OTHER") {
        rp.profession = state.defaultProfession;
      }
      if (!rp.maritalStatus || rp.maritalStatus === "OTHER") {
        rp.maritalStatus = state.defaultMaritalStatus;
      }
      if (!rp.passportType || rp.passportType === "NORMAL") {
        rp.passportType = state.defaultPassportType;
      }
      if (!rp.email || rp.email === "huseinghanim@gmail.com") {
        rp.email = state.defaultEmail;
      }
      if (!rp.mobileNumber || rp.mobileNumber === "+6282137434147" || rp.mobileNumber === "6282137434147") {
        rp.mobileNumber = state.defaultMobileNumber;
      }
    }
  }

  async function loadManifest() {
    if (!state.manifestPath) {
      return;
    }

    const manifest = await loadManifestCommand(state.manifestPath);
    applyDefaultsToNewManifest(manifest);
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
