import { entryStatusLabel, entryStatusTone, memberReviewStatus } from "./main-entry.js";
import { isMemberReadyForJson } from "./main-export.js";
import { escapeHtml } from "./main-utils.js";
import { memberDisplayName, memberPassport } from "./main-members.js";

export function buildExportPreviewState({
  members = [],
  selectedIds = new Set(),
  review,
  reviewedMemberIds = new Set(),
  canExportReviewedJson = false,
  isEntryRunning = false,
}) {
  const readyMembers = members.filter((member) => selectedIds.has(String(member.id || "")) && isMemberReadyForJson(member, reviewedMemberIds));
  const failedMembers = members.filter((member) => memberReviewStatus(member) === "ERROR");
  const skippedMembers = members.filter((member) => !readyMembers.includes(member) && memberReviewStatus(member) !== "ERROR");
  const reviewedMembers = members.filter((member) =>
    memberReviewStatus(member) === "ERROR" || Boolean(member?.reviewConfirmed === true || reviewedMemberIds.has(member?.id))
  );
  const canExport = canExportReviewedJson && !isEntryRunning;
  const description = review.remaining > 0
    ? `${review.reviewed}/${review.total} passport sudah ditandai dicek. Selesaikan review sebelum export JSON.`
    : `${readyMembers.length} passport valid siap diexport. Data gagal atau skipped tetap tampil di preview dan tidak masuk JSON.`;

  return {
    members: review.remaining > 0 ? reviewedMembers : members,
    selectedIds,
    review,
    readyMembers,
    failedMembers,
    skippedMembers,
    reviewedMembers,
    reviewedMemberIds,
    canExport,
    description,
  };
}

export function renderReviewExportModalView({ dom, state, preview }) {
  if (!dom.reviewCompleteModal) {
    return;
  }

  if (dom.reviewCompleteModalDesc) {
    dom.reviewCompleteModalDesc.textContent = preview.description;
  }

  if (dom.reviewExportStatus) {
    const status = reviewExportStatusDescriptor(state, preview);
    dom.reviewExportStatus.textContent = status.label;
    dom.reviewExportStatus.className = `status-chip ${status.tone}`;
  }

  if (dom.reviewExportSummary) {
    dom.reviewExportSummary.innerHTML = renderExportSummaryCards(preview);
  }

  if (dom.reviewExportPreviewBody) {
    dom.reviewExportPreviewBody.innerHTML = renderExportPreviewRows(preview);
  }

  if (dom.reviewExportResult) {
    renderExportResultNode(dom.reviewExportResult, state);
  }

  if (dom.reviewCompleteExportButton) {
    dom.reviewCompleteExportButton.disabled = !preview.canExport;
    dom.reviewCompleteExportButton.textContent = state.isEntryRunning ? "Membuat JSON..." : "Export to JSON";
    dom.reviewCompleteExportButton.setAttribute("aria-disabled", dom.reviewCompleteExportButton.disabled ? "true" : "false");
  }
}

export function renderEntryPageView({ dom, state, preview }) {
  if (!dom.entryStatusPill) {
    return;
  }

  const statusInput = {
    isEntryRunning: state.isEntryRunning,
    isScanning: state.isScanning,
    manifestPath: state.manifestPath,
    selectedIdsSize: preview.selectedIds.size,
  };
  dom.entryStatusPill.textContent = state.exportedBatchPath ? "JSON siap" : entryStatusLabel(statusInput);
  dom.entryStatusPill.className = `status-pill ${state.exportedBatchPath ? "valid" : entryStatusTone(statusInput)}`;

  if (dom.entryExportDescription) {
    dom.entryExportDescription.textContent = preview.description;
  }
  if (dom.entryExportSummary) {
    dom.entryExportSummary.innerHTML = renderExportSummaryCards(preview);
  }
  if (dom.entryExportPreviewBody) {
    dom.entryExportPreviewBody.innerHTML = renderExportPreviewRows(preview);
  }
  if (dom.entryExportResult) {
    renderExportResultNode(dom.entryExportResult, state);
  }
  if (dom.prepareEntryButton) {
    dom.prepareEntryButton.disabled = !preview.canExport;
    dom.prepareEntryButton.textContent = state.isEntryRunning ? "Membuat JSON..." : "Export to JSON";
    dom.prepareEntryButton.setAttribute("aria-disabled", dom.prepareEntryButton.disabled ? "true" : "false");
  }
}

export function reviewExportStatusDescriptor(state, preview) {
  if (state.isEntryRunning) {
    return { label: "Export berjalan", tone: "warn" };
  }
  if (state.exportedBatchPath) {
    return { label: "JSON siap", tone: "valid" };
  }
  if (preview.canExport) {
    return { label: "Siap export", tone: "ready" };
  }
  return { label: "Belum siap", tone: "neutral" };
}

export function renderExportSummaryCards(preview) {
  return [
    ["Total", preview.members.length],
    ["Sudah Review", preview.reviewedMembers.length],
    ["Siap JSON", preview.readyMembers.length],
    ["Gagal/Skip", preview.failedMembers.length + preview.skippedMembers.length],
  ].map(([label, value]) => `
    <article class="review-export-summary-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </article>
  `).join("");
}

export function renderExportPreviewRows(preview) {
  return preview.members.length
    ? preview.members.map((member) => renderReviewExportPreviewRow(member, preview.selectedIds, preview.reviewedMemberIds)).join("")
    : `<tr><td colspan="4">Belum ada data untuk dipreview.</td></tr>`;
}

export function renderReviewExportPreviewRow(member, selectedIds, reviewedMemberIds = new Set()) {
  const status = memberReviewStatus(member) || "-";
  const ready = selectedIds.has(String(member.id || "")) && isMemberReadyForJson(member, reviewedMemberIds);
  const passport = memberPassport(member) || "-";
  const name = memberDisplayName(member);
  const fileName = member.fileName || "-";
  const exportLabel = ready ? "Masuk JSON" : "Tidak diexport";
  return `
    <tr>
      <td>
        <strong>${escapeHtml(passport)}</strong>
        <small>${escapeHtml(fileName)}</small>
      </td>
      <td>
        <button class="review-export-member-link" type="button" data-review-member-id="${escapeHtml(member.id ?? "")}">
          ${escapeHtml(name)}
        </button>
      </td>
      <td><span class="review-export-row-status ${escapeHtml(status.toLowerCase())}">${escapeHtml(status)}</span></td>
      <td>${escapeHtml(exportLabel)}</td>
    </tr>
  `;
}

export function renderExportResultNode(node, state) {
  node.className = `review-export-result${state.exportError ? " is-error" : state.exportedBatchPath ? " is-success" : ""}`;
  node.textContent = state.exportError
    ? state.exportError
    : state.exportedBatchPath
      ? `JSON dibuat: ${state.exportedBatchPath}`
      : "Export akan membuat file nusuk-entry-batch.json dari data valid yang sudah direview.";
}
