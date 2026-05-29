import {
  FIELD_CATEGORY_PAIRS,
  arabicFieldForLatinName,
  normalizeInputValueForField,
  transliteratedArabicValueForField,
} from "./main-fields.js";
import { memberReviewStatus } from "./main-entry.js";
import { humanizeFieldPath } from "./main-review-helpers.js";
import {
  cloneJson,
  setValueByPath,
} from "./main-utils.js";
import {
  buildCompanionSnapshot,
  ensureResolvedProfile,
  inferDefaultCompanionRelation,
  memberDisplayName,
  normalizeCompanionRelation,
  syncMemberChildMetadata,
} from "./main-members.js";

export function createReviewActions({
  state,
  activeMember,
  manifestMembers,
  filteredMembers,
  activeNavigationState,
  activeCategoryPair,
  reviewCompletionState,
  reviewCompletionValidation,
  clearReviewBlock,
  showReviewBlockingMessage,
  openReviewCompleteModal,
  recalculateMetrics,
  scheduleManifestSave,
  renderAll,
  syncPassportPageWithActiveMember,
  scrollPassportListToTop,
  originalMemberById,
  replaceMemberInManifest,
}) {
  function isMemberReviewConfirmed(member) {
    return Boolean(member?.reviewConfirmed === true || state.reviewedMemberIds.has(member?.id));
  }

  function confirmMemberReview(member) {
    if (!member?.id) {
      return;
    }
    member.reviewConfirmed = true;
    state.reviewedMemberIds.add(member.id);
  }

  function clearMemberReviewConfirmation(member) {
    if (!member?.id) {
      return;
    }
    delete member.reviewConfirmed;
    state.reviewedMemberIds.delete(member.id);
  }

  function updateActiveMemberField(fieldKey, nextValue) {
    const member = activeMember();
    if (!member || !fieldKey) {
      return;
    }

    clearReviewBlock();
    const resolved = ensureResolvedProfile(member);
    const normalizedValue = normalizeInputValueForField(fieldKey, nextValue);
    setValueByPath(resolved, fieldKey, normalizedValue);
    const syncedArabicFieldKey = arabicFieldForLatinName(fieldKey);
    if (syncedArabicFieldKey) {
      setValueByPath(resolved, syncedArabicFieldKey, transliteratedArabicValueForField(fieldKey, normalizedValue));
    }
    syncMemberChildMetadata(member);
    clearMemberReviewConfirmation(member);
    scheduleManifestSave();
    state.statusHeadline = "Perubahan lokal tersimpan";
    state.statusDetail = syncedArabicFieldKey
      ? `${humanizeFieldPath(`resolvedProfile.${fieldKey}`)} diperbarui, ${humanizeFieldPath(`resolvedProfile.${syncedArabicFieldKey}`)} ikut disinkronkan.`
      : `${humanizeFieldPath(`resolvedProfile.${fieldKey}`)} diperbarui di sesi review.`;
  }

  function updateActiveMemberCompanion(companionMemberId) {
    const member = activeMember();
    if (!member) {
      return;
    }

    clearReviewBlock();
    const normalizedId = String(companionMemberId || "").trim();
    syncMemberChildMetadata(member);
    if (normalizedId) {
      const companion = manifestMembers().find((item) => String(item.id || "") === normalizedId);
      if (!companion) {
        return;
      }
      member.companionMemberId = normalizedId;
      const relation = normalizeCompanionRelation(member.companionRelation || member.companion?.relation || inferDefaultCompanionRelation(member, companion));
      member.companionRelation = relation;
      member.companion = buildCompanionSnapshot(companion, relation);
      state.selectedIds.add(normalizedId);
      state.statusHeadline = "Companion dipilih";
      state.statusDetail = `${memberDisplayName(companion)} dipilih sebagai companion untuk ${memberDisplayName(member)} dengan relation ${relation}.`;
    } else {
      delete member.companionMemberId;
      delete member.companionRelation;
      delete member.companion;
      state.statusHeadline = "Companion dikosongkan";
      state.statusDetail = `${memberDisplayName(member)} belum memiliki companion.`;
    }
    clearMemberReviewConfirmation(member);
    scheduleManifestSave();
  }

  function updateActiveMemberCompanionRelation(value) {
    const member = activeMember();
    if (!member) {
      return;
    }
    clearReviewBlock();
    const companionId = String(member.companionMemberId || "").trim();
    const companion = manifestMembers().find((item) => String(item.id || "") === companionId);
    if (!companion) {
      return;
    }
    const relation = normalizeCompanionRelation(value);
    member.companionRelation = relation;
    member.companion = buildCompanionSnapshot(companion, relation);
    state.statusHeadline = "Relation companion diperbarui";
    state.statusDetail = `${relation} dipilih sebagai relation untuk companion ${memberDisplayName(companion)}.`;
    clearMemberReviewConfirmation(member);
    scheduleManifestSave();
  }

  function resetActiveMemberFields() {
    const member = activeMember();
    if (!member || !state.originalManifest) {
      return;
    }

    clearReviewBlock();
    const originalMember = originalMemberById(member.id);
    if (!originalMember) {
      return;
    }

    const resetMember = cloneJson(originalMember);
    delete resetMember.reviewConfirmed;
    replaceMemberInManifest(member.id, resetMember);
    state.reviewedMemberIds.delete(member.id);
    state.statusHeadline = "Field di-reset";
    state.statusDetail = "Perubahan untuk passport aktif dikembalikan ke hasil scan awal.";
    scheduleManifestSave(0);
    renderAll();
  }

  function markActiveMemberValid() {
    const member = activeMember();
    if (!member) {
      return;
    }

    member.status = "VALID";
    member.reviewStatus = "VALID";
    member.requiresReview = false;
    member.reviewReasons = [];
    state.selectedIds.add(member.id);
    confirmMemberReview(member);
    state.statusHeadline = "Passport ditandai valid";
    state.statusDetail = `${memberDisplayName(member)} ditandai siap untuk batch entry.`;
    recalculateMetrics();
    scheduleManifestSave(0);
    renderAll();
  }

  function handleSaveAndNext() {
    const member = activeMember();
    if (!member) {
      return;
    }

    const currentPair = activeCategoryPair();
    const currentPairIndex = FIELD_CATEGORY_PAIRS.findIndex((item) => item.id === currentPair.id);
    const nextPair = FIELD_CATEGORY_PAIRS[currentPairIndex + 1] || null;

    if (isFinalReviewCompleteAction(member)) {
      const validation = reviewCompletionValidation(member);
      if (!validation.ok) {
        showReviewBlockingMessage(validation);
        return;
      }
      openReviewCompleteModal();
      return;
    }

    if (nextPair) {
      state.activeFieldCategory = nextPair.id;
      state.statusHeadline = "Lanjut kategori review";
      state.statusDetail = `${memberDisplayName(member)} lanjut ke ${nextPair.label}.`;
      renderAll();
      return;
    }

    const validation = reviewCompletionValidation(member);
    if (!validation.ok) {
      showReviewBlockingMessage(validation);
      return;
    }

    member.status = "VALID";
    member.reviewStatus = "VALID";
    member.requiresReview = false;
    member.reviewReasons = [];
    clearReviewBlock();
    state.selectedIds.add(member.id);
    confirmMemberReview(member);
    state.statusHeadline = "Review data selesai";
    const canMoveNext = activeNavigationState().canMoveNext;
    const review = reviewCompletionState();
    const isAllReviewDone = review.total > 0 && review.remaining === 0;
    state.statusDetail = isAllReviewDone
      ? `${review.reviewed}/${review.total} passport sudah direview. Preview export JSON siap dibuka.`
      : canMoveNext
        ? `${memberDisplayName(member)} ditandai siap dan berpindah ke data berikutnya.`
        : `${memberDisplayName(member)} ditandai siap. Tidak ada passport berikutnya di antrean ini.`;
    recalculateMetrics();
    scheduleManifestSave(0);
    if (canMoveNext && !isAllReviewDone) {
      state.activeFieldCategory = FIELD_CATEGORY_PAIRS[0]?.id ?? "identity";
      moveActiveMember(1);
    } else {
      renderAll();
      if (isAllReviewDone) {
        openReviewCompleteModal();
      }
    }
  }

  function reviewPrimaryActionLabel(member, nextPair) {
    if (isFinalReviewCompleteAction(member)) {
      return "Konfirmasi Review Selesai";
    }
    if (nextPair) {
      return `Lanjut ke ${nextPair.label}`;
    }
    return activeNavigationState().canMoveNext
      ? "Tandai Dicek & Lanjut"
      : "Tandai Dicek & Selesai";
  }

  function isFinalReviewCompleteAction(member = activeMember()) {
    const review = reviewCompletionState();
    return Boolean(
      member
      && review.total > 0
      && review.remaining === 0
      && isMemberReviewConfirmed(member)
      && !activeNavigationState().canMoveNext
    );
  }

  function moveActiveMember(step) {
    const members = filteredMembers();
    if (!members.length) {
      return;
    }

    if (step > 0) {
      const member = activeMember();
      if (member && memberReviewStatus(member) !== "ERROR") {
        const validation = reviewCompletionValidation(member);
        if (!validation.ok) {
          showReviewBlockingMessage(validation);
          return;
        }
        if (!isMemberReviewConfirmed(member)) {
          showReviewBlockingMessage({
            ok: false,
            message: "Tandai passport ini sebagai sudah dicek sebelum lanjut ke passport berikutnya.",
            categoryId: state.activeFieldCategory,
            fieldKey: "",
          });
          return;
        }
      }
    }

    const currentIndex = members.findIndex((member) => member.id === state.activeMemberId);
    const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.max(0, Math.min(members.length - 1, safeCurrentIndex + step));
    const previousPage = state.passportListPage;
    clearReviewBlock();
    state.activeMemberId = members[nextIndex].id ?? "";
    syncPassportPageWithActiveMember();
    renderAll();
    if (state.passportListPage !== previousPage) {
      scrollPassportListToTop();
    }
  }

  return {
    clearMemberReviewConfirmation,
    confirmMemberReview,
    handleSaveAndNext,
    isFinalReviewCompleteAction,
    isMemberReviewConfirmed,
    markActiveMemberValid,
    moveActiveMember,
    resetActiveMemberFields,
    reviewPrimaryActionLabel,
    updateActiveMemberCompanion,
    updateActiveMemberCompanionRelation,
    updateActiveMemberField,
  };
}
