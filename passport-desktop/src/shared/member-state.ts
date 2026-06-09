import {
  computeReviewCompletionState,
  isEntryAccessible as isEntryAccessibleForState,
  memberReviewStatus,
} from "../features/entry/entry.js";
import { syncMemberChildMetadata } from "./members.js";
import { passportListPaginationState } from "../features/passport/list-render.js";

export function createMemberStateController({
  state,
  dom,
  requestFrame,
  renderAll,
}) {
  function manifestMembers() {
    return Array.isArray(state.manifest?.members) ? state.manifest.members : [];
  }

  function syncManifestChildMetadata(manifest = state.manifest) {
    const members = Array.isArray(manifest?.members) ? manifest.members : [];
    for (const member of members) {
      syncMemberChildMetadata(member);
    }
  }

  function reviewCompletionState() {
    return computeReviewCompletionState(manifestMembers(), state.reviewedMemberIds);
  }

  function isEntryAccessible() {
    const review = reviewCompletionState();
    return isEntryAccessibleForState({
      manifestPath: state.manifestPath,
      hasManifest: Boolean(state.manifest),
      reviewTotal: review.total,
      reviewRemaining: review.remaining,
      isScanning: state.isScanning,
    });
  }

  function filteredMembers() {
    const members = manifestMembers();
    if (state.validationFilter === "error") {
      return members.filter((member) => memberReviewStatus(member) === "ERROR" || memberReviewStatus(member) === "NEEDS_REVIEW");
    }
    if (state.validationFilter === "valid") {
      return members.filter((member) => memberReviewStatus(member) === "VALID");
    }
    return members;
  }

  function ensureVisibleActiveMember() {
    const members = filteredMembers();
    if (!members.length) {
      state.activeMemberId = "";
      state.passportListPage = 1;
      return;
    }

    const isActiveVisible = members.some((member) => member.id === state.activeMemberId);
    if (!isActiveVisible) {
      state.activeMemberId = members[0].id ?? "";
      state.passportListPage = 1;
    }
    const totalPages = Math.max(1, Math.ceil(members.length / state.passportListPageSize));
    state.passportListPage = Math.min(state.passportListPage, totalPages);
  }

  function syncPassportPageWithActiveMember() {
    const members = filteredMembers();
    const activeIndex = members.findIndex((member) => member.id === state.activeMemberId);
    if (activeIndex < 0) {
      return;
    }
    state.passportListPage = Math.max(1, Math.floor(activeIndex / state.passportListPageSize) + 1);
  }

  function paginationState(totalItems) {
    return passportListPaginationState(state, totalItems);
  }

  function changePassportListPage(step) {
    const members = filteredMembers();
    const pagination = paginationState(members.length);
    const nextPage = Math.min(Math.max(1, pagination.currentPage + step), pagination.totalPages);
    if (nextPage === state.passportListPage) {
      return;
    }
    state.passportListPage = nextPage;
    const nextOffset = (nextPage - 1) * state.passportListPageSize;
    state.activeMemberId = members[nextOffset]?.id ?? state.activeMemberId;
    renderAll();
    scrollPassportListToTop();
  }

  function scrollPassportListToTop() {
    if (!dom.passportList) {
      return;
    }
    requestFrame(() => {
      dom.passportList.scrollTop = 0;
    });
  }

  function activeMember() {
    const members = manifestMembers();
    return members.find((member) => member.id === state.activeMemberId) || null;
  }

  function activeNavigationState() {
    const members = filteredMembers();
    const index = members.findIndex((member) => member.id === state.activeMemberId);
    return {
      canMovePrev: index > 0,
      canMoveNext: index >= 0 && index < members.length - 1,
    };
  }

  function firstMemberId(manifest) {
    return Array.isArray(manifest?.members) && manifest.members.length ? manifest.members[0].id ?? "" : "";
  }

  function recalculateMetrics() {
    const members = manifestMembers();
    state.totalFiles = members.length;
    state.validCount = members.filter((member) => memberReviewStatus(member) === "VALID").length;
    state.errorCount = members.filter((member) => memberReviewStatus(member) === "ERROR").length;
    state.reviewCount = members.filter((member) => memberReviewStatus(member) === "NEEDS_REVIEW").length;
  }

  function originalMemberById(memberId) {
    const members = Array.isArray(state.originalManifest?.members) ? state.originalManifest.members : [];
    return members.find((member) => member.id === memberId) || null;
  }

  function replaceMemberInManifest(memberId, nextMember) {
    const members = manifestMembers();
    const index = members.findIndex((member) => member.id === memberId);
    if (index < 0) {
      return;
    }
    members[index] = nextMember;
    recalculateMetrics();
  }

  return {
    activeMember,
    activeNavigationState,
    changePassportListPage,
    ensureVisibleActiveMember,
    filteredMembers,
    firstMemberId,
    isEntryAccessible,
    manifestMembers,
    originalMemberById,
    paginationState,
    recalculateMetrics,
    replaceMemberInManifest,
    reviewCompletionState,
    scrollPassportListToTop,
    syncManifestChildMetadata,
    syncPassportPageWithActiveMember,
  };
}
