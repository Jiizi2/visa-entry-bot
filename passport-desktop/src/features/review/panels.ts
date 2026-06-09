import { escapeHtml, formatConfidence, normalizeText } from "../../shared/utils.js";
import {
  renderFlagEntry,
  renderConfidenceEntry,
  flattenFlagEntries,
  flattenConfidenceEntries,
  humanizeFieldPath,
  formatFlagLabel,
  hasActionableFlag,
  isAutoFilledFlag,
} from "./helpers.js";

export function fieldStateDescriptor(ocrValue, finalValue, flags, level, confidenceValue, options: any = {}) {
  const normalizedOcr = normalizeText(ocrValue);
  const normalizedFinal = normalizeText(finalValue);
  const missingFinal = !normalizedFinal;
  const required = options.required !== false;
  const actionable = hasActionableFlag(flags);
  const hasLowConfidence = flags.includes("LOW_CONFIDENCE") || level === "LOW";
  const derivedOnly = flags.length > 0 && flags.every((flag) => isAutoFilledFlag(flag) || flag === "INTENTIONAL_EMPTY");
  const different = normalizedOcr && normalizedFinal && normalizedOcr !== normalizedFinal;

  if (!required && missingFinal) {
    return { tone: "ok", symbol: "v", label: "Optional", tooltip: "Field optional boleh kosong.", rowAlert: false };
  }
  if (missingFinal && normalizedOcr) {
    return { tone: "error", symbol: "x", label: "Error", tooltip: "Bagian ini masih perlu diisi.", rowAlert: true };
  }
  if (flags.includes("RECORD_ERROR")) {
    return { tone: "error", symbol: "x", label: "Error", tooltip: "Bagian ini perlu dicek ulang.", rowAlert: true };
  }
  if (actionable || hasLowConfidence || (level === "NONE" && confidenceValue === 0 && normalizedFinal)) {
    return {
      tone: missingFinal ? "error" : "warn",
      symbol: missingFinal ? "x" : "!",
      label: missingFinal ? "Error" : "Periksa",
      tooltip: "Bagian ini perlu perhatian lebih.",
      rowAlert: missingFinal,
    };
  }
  if (different) {
    return { tone: "info", symbol: "=", label: "Diubah", tooltip: "Hasil akhir berbeda dari hasil bacaan awal.", rowAlert: false };
  }
  if (derivedOnly && normalizedFinal) {
    return { tone: "info", symbol: "i", label: "Auto", tooltip: "Bagian ini diisi otomatis dari data yang tersedia.", rowAlert: false };
  }
  return { tone: "ok", symbol: "v", label: "OK", tooltip: "Bagian ini terlihat sudah sesuai.", rowAlert: false };
}

export function actionableIssuesForMember(member) {
  const entries = flattenFlagEntries(member.reviewFlags ?? {})
    .filter((entry) => hasActionableFlag(entry.codes))
    .slice(0, 4);

  const issues = entries.map((entry) =>
    `${humanizeFieldPath(entry.path)}: ${entry.codes.map(formatFlagLabel).join(", ")}`,
  );

  if (!issues.length && member.status === "ERROR") {
    const notes = splitNotes(member.notes);
    if (notes.length) {
      return notes.slice(0, 4);
    }
    return ["Record ini masih ditandai error dan perlu review manual."];
  }

  return issues;
}

export function splitNotes(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function renderEmptyDetailPanel(message, tone = "") {
  const toneClass = tone ? ` ${tone}` : "";
  return `<div class="friendly-empty${toneClass}">${escapeHtml(message)}</div>`;
}

export function renderReviewFlagsPanel(reviewFlags) {
  const entries = flattenFlagEntries(reviewFlags);
  if (!entries.length) {
    return renderEmptyDetailPanel("Tidak ada review flag. Data ini terlihat bersih.", "good");
  }

  const actionableCount = entries.filter((entry) => hasActionableFlag(entry.codes)).length;
  const autoFilledCount = entries.filter((entry) => entry.codes.some(isAutoFilledFlag)).length;
  const intentionalCount = entries.filter((entry) => entry.codes.every((code) => code === "INTENTIONAL_EMPTY")).length;

  return `
    <div class="friendly-summary-grid">
      ${renderSummaryCard("Perlu dicek", actionableCount, actionableCount ? "danger" : "good")}
      ${renderSummaryCard("Diisi otomatis", autoFilledCount, autoFilledCount ? "info" : "")}
      ${renderSummaryCard("Kosong sengaja", intentionalCount, intentionalCount ? "info" : "")}
    </div>
    <div class="flag-list">
      ${entries.map((entry) => renderFlagEntry(entry)).join("")}
    </div>
  `;
}

export function renderFieldConfidencePanel(fieldConfidence, confidenceLevel, recordConfidence) {
  const entries = flattenConfidenceEntries(fieldConfidence, confidenceLevel)
    .filter((entry) => entry.path !== "record")
    .sort((left, right) => left.value - right.value || left.path.localeCompare(right.path));

  if (!entries.length) {
    return renderEmptyDetailPanel("Belum ada tingkat keyakinan per bagian data.");
  }

  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 };
  for (const entry of entries) {
    counts[entry.level] = (counts[entry.level] ?? 0) + 1;
  }

  const visibleEntries = entries.filter((entry) => entry.value > 0 || entry.level !== "NONE");

  return `
    <div class="friendly-summary-grid wide">
      ${renderSummaryCard("Tinggi", counts.HIGH, counts.HIGH ? "good" : "")}
      ${renderSummaryCard("Sedang", counts.MEDIUM, counts.MEDIUM ? "info" : "")}
      ${renderSummaryCard("Rendah", counts.LOW, counts.LOW ? "warn" : "")}
      ${renderSummaryCard("Kosong", counts.NONE, counts.NONE ? "danger" : "")}
    </div>
    ${Number.isFinite(Number(recordConfidence))
      ? `<div class="confidence-note">Tingkat keyakinan keseluruhan: <strong>${escapeHtml(formatConfidence(recordConfidence))}</strong></div>`
      : ""}
    ${visibleEntries.length
      ? `<div class="confidence-list">${visibleEntries.map((entry) => renderConfidenceEntry(entry)).join("")}</div>`
      : renderEmptyDetailPanel("Semua field kosong, template, atau default sistem.")}
    ${counts.NONE
      ? `<div class="confidence-note">${escapeHtml(String(counts.NONE))} kolom masih kosong atau memakai nilai bawaan sehingga tingkat keyakinannya 0%.</div>`
      : ""}
  `;
}

function renderSummaryCard(label, value, tone = "") {
  const toneClass = tone ? ` ${tone}` : "";
  return `
    <article class="friendly-summary-card${toneClass}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </article>
  `;
}
