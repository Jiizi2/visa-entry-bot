import {
  memberDisplayName,
  memberPassport,
} from "./main-members.js";

export function createPassportDeleteActions({
  dom,
  state,
  requestFrame = (callback) => callback(),
  activeMember,
  manifestMembers,
  clearMemberReviewConfirmation,
  recalculateMetrics,
  filteredMembers,
  ensureVisibleActiveMember,
  syncPassportPageWithActiveMember,
  scheduleManifestSave,
  renderAll,
}) {
  let passportDeleteMemberId = "";

  function openPassportDeleteModal(memberId = activeMember()?.id ?? "") {
    const member = manifestMembers().find((item) => String(item.id || "") === String(memberId || ""));
    if (!member || !dom.passportDeleteModal) {
      return;
    }

    passportDeleteMemberId = String(member.id || "");
    if (dom.passportDeleteModalDesc) {
      const passport = memberPassport(member) || member.fileName || "-";
      dom.passportDeleteModalDesc.textContent =
        `Hapus ${memberDisplayName(member)} (${passport}) dari manifest review? File gambar asli tidak ikut dihapus dan data ini tidak akan masuk export JSON.`;
    }
    dom.passportDeleteModal.classList.remove("is-hidden");
    dom.passportDeleteModal.setAttribute("aria-hidden", "false");
    requestFrame(() => dom.passportDeleteCancelButton?.focus());
  }

  function closePassportDeleteModal() {
    passportDeleteMemberId = "";
    if (!dom.passportDeleteModal) {
      return;
    }
    dom.passportDeleteModal.classList.add("is-hidden");
    dom.passportDeleteModal.setAttribute("aria-hidden", "true");
  }

  function confirmPassportDelete() {
    const memberId = String(passportDeleteMemberId || "");
    const members = manifestMembers();
    const index = members.findIndex((member) => String(member.id || "") === memberId);
    if (!memberId || index < 0 || !Array.isArray(state.manifest?.members)) {
      closePassportDeleteModal();
      return;
    }

    const removedMember = members[index];
    state.manifest.members = members.filter((member) => String(member.id || "") !== memberId);
    state.selectedIds.delete(memberId);
    state.reviewedMemberIds.delete(memberId);
    state.passportImageCache.delete(memberId);
    clearDeletedCompanionReferences(memberId);
    closePassportDeleteModal();

    recalculateMetrics();
    const nextMembers = filteredMembers();
    state.activeMemberId = nextMembers[Math.min(index, Math.max(nextMembers.length - 1, 0))]?.id ?? "";
    ensureVisibleActiveMember();
    syncPassportPageWithActiveMember();
    scheduleManifestSave(0);
    state.statusHeadline = "Passport dihapus dari review";
    state.statusDetail = `${memberDisplayName(removedMember)} dihapus dari manifest review. File asli tetap aman di folder sumber.`;
    renderAll();
  }

  function clearDeletedCompanionReferences(deletedMemberId) {
    for (const member of manifestMembers()) {
      if (String(member.companionMemberId || "") !== String(deletedMemberId || "")) {
        continue;
      }
      delete member.companionMemberId;
      delete member.companionRelation;
      delete member.companion;
      clearMemberReviewConfirmation(member);
    }
  }

  return {
    openPassportDeleteModal,
    closePassportDeleteModal,
    confirmPassportDelete,
    clearDeletedCompanionReferences,
  };
}
