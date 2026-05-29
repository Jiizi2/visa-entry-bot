import {
  basenameFromPath,
  escapeHtml,
  formatDurationMs,
} from "./main-utils.js";
import { memberReviewStatus } from "./main-entry.js";
import { memberScanTotalMs } from "./main-metrics.js";
import {
  childInfoForMember,
  memberDisplayName,
  resolvedProfileOf,
  valueFrom,
} from "./main-members.js";
import {
  paginateItems,
  paginationState as buildPaginationState,
  passportListSummaryText as formatPassportListSummaryText,
  reviewPaginationSummaryText as formatReviewPaginationSummaryText,
} from "./main-pagination.js";

export function renderPassportListView({
  dom,
  state,
  allMembers,
  visibleMembers,
  review,
  isMemberReviewConfirmed,
  activeNavigationState,
  canAdvanceToNextPassport,
}) {
  if (dom.filterAllCount) {
    dom.filterAllCount.textContent = String(allMembers.length);
  }
  if (dom.filterErrorCount) {
    dom.filterErrorCount.textContent = String(allMembers.filter((member) => memberReviewStatus(member) === "ERROR").length);
  }
  if (dom.filterValidCount) {
    dom.filterValidCount.textContent = String(allMembers.filter((member) => memberReviewStatus(member) === "VALID").length);
  }

  for (const button of dom.filterButtons || []) {
    button.classList.toggle("is-active", button.dataset.validationFilter === state.validationFilter);
  }

  renderReviewProgressView({ dom, state, review });

  if (!dom.passportList) {
    if (dom.passportListSummary) {
      dom.passportListSummary.textContent = reviewPaginationSummaryText({
        state,
        visibleMembers,
        review,
        totalItems: visibleMembers.length,
      });
    }
    renderPassportPaginationView({
      dom,
      pagination: { totalItems: visibleMembers.length },
      activeNavigationState,
      canAdvanceToNextPassport,
      fallbackSummaryText: dom.passportListSummary?.textContent ?? "",
    });
    return;
  }

  const pagination = passportListPaginationState(state, visibleMembers.length);
  const pagedMembers = paginateItems(visibleMembers, pagination);

  if (dom.passportListSummary) {
    dom.passportListSummary.textContent = formatPassportListSummaryText(pagination, allMembers.length);
  }

  if (!allMembers.length) {
    dom.passportList.innerHTML = `<div class="friendly-empty">Belum ada data passport. Mulai proses dulu dari halaman Pilih Dokumen.</div>`;
    renderPassportPaginationView({ dom, pagination, activeNavigationState, canAdvanceToNextPassport });
    return;
  }

  if (!visibleMembers.length) {
    dom.passportList.innerHTML = `<div class="friendly-empty">Tidak ada data yang cocok untuk tampilan ini.</div>`;
    renderPassportPaginationView({ dom, pagination, activeNavigationState, canAdvanceToNextPassport });
    return;
  }

  dom.passportList.innerHTML = pagedMembers
    .map((member) => renderPassportListItem({
      state,
      member,
      isMemberReviewConfirmed,
    }))
    .join("");
  renderPassportPaginationView({ dom, pagination, activeNavigationState, canAdvanceToNextPassport });
}

export function renderReviewProgressView({ dom, state, review }) {
  const remainingText = review.remaining
    ? `${review.remaining} belum dicek`
    : "Semua sudah dicek";
  const progressText = `${review.reviewed}/${review.total} direview`;

  if (dom.batchBadge) {
    dom.batchBadge.textContent = state.resultDir
      ? `Kelompok ${basenameFromPath(state.resultDir)}`
      : state.selectedDir
        ? `Kelompok ${basenameFromPath(state.selectedDir)}`
        : "Siap diperiksa";
  }
  if (dom.passportReviewProgress) {
    dom.passportReviewProgress.textContent = `${progressText} | ${remainingText}`;
  }
}

export function renderPassportListItem({ state, member, isMemberReviewConfirmed }) {
  const resolved = resolvedProfileOf(member);
  const active = state.activeMemberId === member.id ? " is-active" : "";
  const reviewed = isMemberReviewConfirmed(member);
  const tone = memberTone(member);
  const passportNumber = valueFrom(resolved, "passportNumber");
  const childInfo = childInfoForMember(member);
  const companionMissing = childInfo.isChild && !String(member.companionMemberId || "").trim();
  const groupLabel = childInfo.isChild ? "Child" : "Adult";
  const groupClass = childInfo.isChild ? "child" : "adult";
  const scanDurationMs = memberScanTotalMs(member);
  const scanTimePill = scanDurationMs > 0
    ? `<span class="mini-pill muted scan-time-pill">Scan ${escapeHtml(formatDurationMs(scanDurationMs))}</span>`
    : "";

  return `
    <div class="passport-item${active}${reviewed ? " is-reviewed" : ""}" data-member-id="${escapeHtml(member.id ?? "")}" tabindex="0">
      <div class="passport-item-main">
        <div class="passport-item-title">
          <span class="passport-status-dot ${tone}${reviewed ? " reviewed" : ""}"></span>
          <span class="passport-name">${escapeHtml(memberDisplayName(member))}</span>
        </div>
        <div class="passport-meta">
          <span class="mono">${escapeHtml(passportNumber)}</span>
          ${scanTimePill}
          ${childInfo.isChild ? `<span class="mini-pill ${companionMissing ? "warn" : "info"}">${companionMissing ? "Butuh companion" : "Anak"}</span>` : ""}
        </div>
      </div>
      <div class="passport-item-confidence passport-item-group">
        <span class="member-group-pill ${groupClass}">${escapeHtml(groupLabel)}</span>
      </div>
    </div>
  `;
}

export function passportListPaginationState(state, totalItems) {
  const pagination = buildPaginationState(totalItems, {
    currentPage: state.passportListPage,
    pageSize: state.passportListPageSize,
  });
  state.passportListPage = pagination.currentPage;
  return pagination;
}

export function renderPassportPaginationView({
  dom,
  pagination,
  activeNavigationState,
  canAdvanceToNextPassport,
  fallbackSummaryText = "",
}) {
  if (!dom.passportPagePrevButton || !dom.passportPageNextButton) {
    return;
  }
  const navigation = activeNavigationState();
  dom.passportPagePrevButton.disabled = !navigation.canMovePrev;
  dom.passportPageNextButton.disabled = !canAdvanceToNextPassport(navigation);
  dom.passportPagePrevButton.setAttribute("aria-disabled", dom.passportPagePrevButton.disabled ? "true" : "false");
  dom.passportPageNextButton.setAttribute("aria-disabled", dom.passportPageNextButton.disabled ? "true" : "false");
  if (dom.passportListSummary && !dom.passportList) {
    dom.passportListSummary.textContent = fallbackSummaryText || String(pagination.totalItems ?? 0);
  }
}

export function reviewPaginationSummaryText({
  state,
  visibleMembers,
  review,
  totalItems,
}) {
  const index = visibleMembers.findIndex((member) => member.id === state.activeMemberId);
  return formatReviewPaginationSummaryText({
    totalItems,
    activeIndex: index,
    reviewed: review.reviewed,
    total: review.total,
  });
}

export function memberTone(member) {
  const status = memberReviewStatus(member);
  if (status === "ERROR") {
    return "error";
  }
  if (status === "NEEDS_REVIEW") {
    return "warn";
  }
  if (Number(member.confidence ?? 0) < 0.9) {
    return "warn";
  }
  return "valid";
}
