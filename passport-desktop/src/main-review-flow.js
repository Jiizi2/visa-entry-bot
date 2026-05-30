import { FIELD_CATEGORY_PAIRS } from "./main-fields.js";
import { memberDisplayName } from "./main-members.js";
import { closestFromEventTarget } from "./main-system.js";

export function createReviewFlow({
  dom,
  state,
  requestFrame,
  manifestMembers,
  syncPassportPageWithActiveMember,
  renderAll,
}) {
  function showBatchReviewBlockingMessage(validation) {
    if (validation.memberId) {
      state.activeMemberId = validation.memberId;
      syncPassportPageWithActiveMember();
    }
    state.currentPage = "validation";
    showReviewBlockingMessage(validation);
  }

  function showReviewBlockingMessage(validation) {
    state.reviewBlock = {
      target: validation.target || (validation.fieldKey ? "field" : ""),
      fieldKey: validation.fieldKey || "",
      token: Date.now(),
    };
    if (validation.categoryId) {
      state.activeFieldCategory = validation.categoryId;
    }
    state.statusHeadline = "Review belum lengkap";
    state.statusDetail = validation.message || "Lengkapi data yang masih perlu dicek sebelum lanjut.";
    renderAll();
    if (validation.fieldKey) {
      focusReviewField(validation.fieldKey);
    } else if (validation.target === "companion") {
      focusCompanionSelect();
    }
  }

  function clearReviewBlock() {
    state.reviewBlock = null;
  }

  function focusReviewField(fieldKey) {
    requestFrame(() => {
      const input = [...dom.fieldReviewRows.querySelectorAll("[data-field-key]")]
        .find((node) => node.dataset.fieldKey === fieldKey);
      input?.focus();
      input?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function focusCompanionSelect() {
    requestFrame(() => {
      const select = dom.fieldReviewRows.querySelector("[data-companion-select]");
      select?.focus();
      select?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function handleExportPreviewMemberClick(event) {
    const button = closestFromEventTarget(event.target, "[data-review-member-id]");
    if (!button) {
      return;
    }

    event.preventDefault();
    jumpToReviewMember(button.dataset.reviewMemberId ?? "");
  }

  function jumpToReviewMember(memberId) {
    const targetId = String(memberId || "").trim();
    const member = manifestMembers().find((candidate) => String(candidate.id || "") === targetId);
    if (!member) {
      return;
    }

    clearReviewBlock();
    state.validationFilter = "all";
    state.activeMemberId = member.id ?? targetId;
    state.activeFieldCategory = FIELD_CATEGORY_PAIRS[0]?.id ?? "identity";
    state.currentPage = "validation";
    syncPassportPageWithActiveMember();
    state.statusHeadline = "Kembali ke review";
    state.statusDetail = `${memberDisplayName(member)} dibuka dari preview export JSON.`;
    renderAll();
    focusActivePassportListItem();
  }

  function focusActivePassportListItem() {
    requestFrame(() => {
      const row = dom.passportList?.querySelector(".passport-item.is-active");
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      row?.focus?.();
    });
  }

  return {
    clearReviewBlock,
    focusActivePassportListItem,
    focusCompanionSelect,
    focusReviewField,
    handleExportPreviewMemberClick,
    jumpToReviewMember,
    showBatchReviewBlockingMessage,
    showReviewBlockingMessage,
  };
}
