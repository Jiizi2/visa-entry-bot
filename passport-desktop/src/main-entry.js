import { escapeHtml } from "./main-utils.js";

export function countMembersByStatus(members, status) {
  return members.filter((member) => member.status === status).length;
}

export function computeReviewCompletionState(members, reviewedMemberIds) {
  const total = members.length;
  const reviewed = members.filter((member) =>
    reviewedMemberIds.has(member.id) || String(member?.status ?? "").toUpperCase() === "VALID"
  ).length;
  return {
    total,
    reviewed,
    remaining: Math.max(total - reviewed, 0),
  };
}

export function computeTotalEntryTargetCount(selectedIdsSize, validCount) {
  return selectedIdsSize > 0 ? selectedIdsSize : validCount;
}

export function buildEntryFlowSteps({ url, isReviewDone, isExported }) {
  const normalizedUrl = String(url ?? "").trim().toLowerCase();
  const isUrlReady = normalizedUrl.includes("/umrah/mutamer/add-mutamer");
  return [
    {
      label: "Review Selesai",
      detail: "Semua passport siap entry",
      state: isReviewDone ? "done" : "todo",
    },
    {
      label: "Halaman Nusuk",
      detail: "Dibuka manual oleh user",
      state: isUrlReady ? "done" : "todo",
    },
    {
      label: "Export JSON",
      detail: isExported ? "Siap diupload ke extension" : "Buat file untuk extension",
      state: isExported ? "done" : "todo",
    },
  ];
}

export function renderEntryFlowSteps(steps) {
  return steps.map((step, index) => {
    const badge = step.state === "done" ? "OK" : String(index + 1);
    return `
      <div class="entry-flow-step is-${escapeHtml(step.state)}">
        <span class="entry-flow-badge">${escapeHtml(badge)}</span>
        <div class="entry-flow-copy">
          <strong>${escapeHtml(step.label)}</strong>
          <small>${escapeHtml(step.detail)}</small>
        </div>
      </div>
      ${index < steps.length - 1 ? '<span class="entry-flow-connector"></span>' : ""}
    `;
  }).join("");
}

export function entryStatusLabel({ isEntryRunning, isScanning, manifestPath, selectedIdsSize }) {
  if (isEntryRunning) {
    return "Export berjalan";
  }
  if (isScanning) {
    return "Proses berjalan";
  }
  if (!manifestPath) {
    return "Menunggu proses";
  }
  if (selectedIdsSize > 0) {
    return "Siap digunakan";
  }
  return "Perlu dipilih";
}

export function entryStatusTone({ isEntryRunning, isScanning, manifestPath, selectedIdsSize }) {
  if (isEntryRunning || isScanning) {
    return "warn";
  }
  if (!manifestPath) {
    return "neutral";
  }
  if (selectedIdsSize > 0) {
    return "valid";
  }
  return "neutral";
}

export function isEntryAccessible({ manifestPath, hasManifest, reviewTotal, reviewRemaining, isScanning }) {
  return Boolean(manifestPath && hasManifest && reviewTotal > 0 && reviewRemaining === 0 && !isScanning);
}
