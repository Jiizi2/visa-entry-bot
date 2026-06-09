import {
  activeCategoryPairForState,
  renderWorkspaceView,
} from "../features/review/workspace.js";
import {
  renderProgressPanelView,
  renderScanLogsView,
} from "../features/scan/render.js";
import {
  renderEntryPageView,
  renderReviewExportModalView,
} from "../features/entry/render.js";
import {
  renderPassportListView,
} from "../features/passport/list-render.js";

export function createViewController({
  dom,
  state,
  documentRef = globalThis.document,
  activeMember,
  activeNavigationState,
  canAdvanceToNextPassport,
  exportPreviewState,
  filteredMembers,
  initializeWorkspaceDatePickers,
  isMemberReviewConfirmed,
  manifestMembers,
  renderEntryLogs,
  reviewCompletionState,
  reviewPrimaryActionLabel,
}) {
  function renderReviewExportModal() {
    renderReviewExportModalView({ dom, state, preview: exportPreviewState() });
  }

  function renderEntryPage() {
    renderEntryPageView({ dom, state, preview: exportPreviewState() });
    renderEntryLogs();
  }

  function renderProgressPanel() {
    renderProgressPanelView({ dom, state, members: manifestMembers() });
  }

  function renderScanLogs() {
    renderScanLogsView({ dom, state });
  }

  function renderPassportList() {
    renderPassportListView({
      dom,
      state,
      allMembers: manifestMembers(),
      visibleMembers: filteredMembers(),
      review: reviewCompletionState(),
      isMemberReviewConfirmed,
      activeNavigationState,
      canAdvanceToNextPassport,
    });
  }

  function renderWorkspace() {
    renderWorkspaceView({
      dom,
      state,
      documentRef,
      activeMember,
      manifestMembers,
      initializeWorkspaceDatePickers,
      reviewPrimaryActionLabel,
    });
  }

  function activeCategoryPair() {
    return activeCategoryPairForState(state);
  }

  return {
    activeCategoryPair,
    renderEntryPage,
    renderPassportList,
    renderProgressPanel,
    renderReviewExportModal,
    renderScanLogs,
    renderWorkspace,
  };
}
