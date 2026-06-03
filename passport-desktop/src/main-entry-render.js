import { entryStatusLabel, entryStatusTone, memberReviewStatus } from "./main-entry.js";
import { isMemberReadyForJson } from "./main-export.js";
import { escapeHtml } from "./main-utils.js";
import { memberDisplayName, memberPassport, resolvedProfileOf } from "./main-members.js";
import {
  passportCropApplied,
} from "./main-passport-image.js";

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
    : `${readyMembers.length} jamaah akan masuk batch extension. Data error, belum reviewed, atau tidak dipilih tetap tampil sebagai pembanding.`;

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
  dom.entryStatusPill.textContent = state.exportedBatchPath ? "JSON dibuat" : entryStatusLabel(statusInput);
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
  if (dom.openJsonLocationButton) {
    dom.openJsonLocationButton.disabled = !state.exportedBatchPath || state.isEntryRunning;
    dom.openJsonLocationButton.setAttribute("aria-disabled", dom.openJsonLocationButton.disabled ? "true" : "false");
  }
}

export function reviewExportStatusDescriptor(state, preview) {
  if (state.isEntryRunning) {
    return { label: "Export berjalan", tone: "warn" };
  }
  if (state.exportedBatchPath) {
    return { label: "JSON dibuat", tone: "valid" };
  }
  if (preview.canExport) {
    return { label: "Review selesai", tone: "ready" };
  }
  return { label: "Belum siap", tone: "neutral" };
}

export function renderExportSummaryCards(preview) {
  return [
    ["Total", preview.members.length],
    ["Reviewed", preview.reviewedMembers.length],
    ["Masuk Batch", preview.readyMembers.length],
    ["Dilewati", preview.failedMembers.length + preview.skippedMembers.length],
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
  const profile = resolvedProfileOf(member);
  const ready = selectedIds.has(String(member.id || "")) && isMemberReadyForJson(member, reviewedMemberIds);
  const passport = memberPassport(member) || "-";
  const name = memberDisplayName(member);
  const fileName = member.fileName || "-";
  const fileLabel = passportCropApplied(member) ? `${fileName} | Crop Nusuk` : fileName;
  const review = reviewDescriptor(member, reviewedMemberIds);
  const output = outputDescriptor(member, ready, selectedIds, reviewedMemberIds);
  const issueDate = profile.releaseDate || profile.issueDate || "";
  return `
    <tr>
      <td class="review-export-main-cell">
        <button class="review-export-member-link" type="button" data-review-member-id="${escapeHtml(member.id ?? "")}">
          ${escapeHtml(name)}
        </button>
        <strong>${escapeHtml(passport)}</strong>
        <small>${escapeHtml(fileLabel)}</small>
      </td>
      <td class="review-export-data-cell">
        <span>${escapeHtml(compactMeta("DOB", profile.dob))}</span>
        <span>${escapeHtml(compactMeta("Nat", profile.nationality))}</span>
        <span>${escapeHtml(compactMeta("Gender", profile.gender))}</span>
        <small>${escapeHtml(compactMeta("Issue", issueDate))} | ${escapeHtml(compactMeta("Exp", profile.expiryDate))}</small>
      </td>
      <td>
        <span class="review-export-row-status ${escapeHtml(review.tone)}">${escapeHtml(review.label)}</span>
        <small>${escapeHtml(review.detail)}</small>
      </td>
      <td>
        <span class="review-export-row-status ${escapeHtml(output.tone)}">${escapeHtml(output.label)}</span>
        <small>${escapeHtml(output.detail)}</small>
      </td>
    </tr>
  `;
}

export function renderExportResultNode(node, state) {
  node.className = `review-export-result${state.exportError ? " is-error" : state.exportedBatchPath ? " is-success" : ""}`;
  node.textContent = state.exportError
    ? state.exportError
    : state.exportedBatchPath
      ? `JSON dibuat: ${state.exportedBatchPath}`
      : "Export akan membuat nusuk-entry-batch.json dari data yang sudah reviewed.";
}

function compactMeta(label, value) {
  const text = String(value ?? "").trim();
  return `${label}: ${text || "-"}`;
}

function reviewDescriptor(member, reviewedMemberIds = new Set()) {
  const status = memberReviewStatus(member);
  const reviewed = Boolean(member?.reviewConfirmed === true || reviewedMemberIds.has(member?.id));
  if (status === "ERROR") {
    return { label: "Error", tone: "error", detail: "Tidak masuk batch" };
  }
  if (reviewed) {
    return { label: "Reviewed", tone: "reviewed", detail: "Sudah dicek di desktop" };
  }
  if (status === "NEEDS_REVIEW") {
    return { label: "Perlu review", tone: "needs_review", detail: "Lengkapi data dulu" };
  }
  return { label: "Belum reviewed", tone: "pending", detail: "Tandai dicek dulu" };
}

function outputDescriptor(member, ready, selectedIds, reviewedMemberIds = new Set()) {
  if (ready) {
    return { label: "Dipakai extension", tone: "exported", detail: "Autofill dan upload passport" };
  }
  const id = String(member?.id || "");
  const status = memberReviewStatus(member);
  if (status === "ERROR") {
    return { label: "Dilewati", tone: "error", detail: "Data OCR error" };
  }
  if (selectedIds.size && !selectedIds.has(id)) {
    return { label: "Tidak dipilih", tone: "pending", detail: "Bukan target batch" };
  }
  const reviewed = Boolean(member?.reviewConfirmed === true || reviewedMemberIds.has(member?.id));
  if (!reviewed) {
    return { label: "Dilewati", tone: "pending", detail: "Belum reviewed" };
  }
  return { label: "Dilewati", tone: "pending", detail: "Data belum lengkap" };
}
