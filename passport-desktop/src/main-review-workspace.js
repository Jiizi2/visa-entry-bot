import {
  dateValueForInput,
  escapeHtml,
  normalizeText,
  setValueByPath,
} from "./main-utils.js";
import {
  FIELD_CATEGORY_DEFS,
  FIELD_CATEGORY_PAIRS,
  REVIEW_FIELDS,
  clampFieldValue,
  isReviewFieldRequired,
  isDateFieldKey,
  maxLengthForField,
} from "./main-fields.js";
import {
  fieldStateDescriptor,
  renderEmptyDetailPanel,
  renderFieldConfidencePanel,
  renderReviewFlagsPanel,
} from "./main-review-panels.js";
import { memberReviewStatus } from "./main-entry.js";
import {
  COMPANION_RELATION_OPTIONS,
  childInfoForMember,
  companionCandidatesFor,
  confidenceLevelForMember,
  confidenceValueForMember,
  ensureResolvedProfile,
  fieldFlagsForMember,
  inferDefaultCompanionRelation,
  memberDisplayName,
  memberPassport,
  normalizeCompanionRelation,
  passportExtractedOf,
  rawValueFrom,
  syncMemberChildMetadata,
  valueFrom,
} from "./main-members.js";

export function renderWorkspaceView({
  dom,
  state,
  documentRef = globalThis.document,
  activeMember,
  manifestMembers,
  initializeWorkspaceDatePickers,
  reviewPrimaryActionLabel,
}) {
  const member = activeMember();
  if (!member) {
    dom.fieldReviewRows.classList.add("is-empty");
    dom.workspaceIssueBox.classList.add("is-hidden");
    documentRef?.querySelector?.(".field-review-head")?.classList.add("is-hidden");
    documentRef?.querySelector?.(".workspace-panel")?.classList.add("is-empty");
    dom.detailStatus.textContent = "Menunggu";
    dom.detailStatus.className = "status-pill neutral";
    dom.workspacePassportCode.textContent = "-";
    dom.detailTitle.textContent = "Belum ada data dipilih";
    dom.detailSummary.classList.add("is-hidden");
    dom.detailSummary.textContent = "";
    dom.workspaceIssueBox.className = "issue-box issue-box-neutral is-hidden";
    dom.workspaceIssueBox.textContent = "Belum ada catatan pemeriksaan.";
    dom.fieldReviewRows.innerHTML = `<div class="workspace-empty-state">Belum ada data untuk ditampilkan.</div>`;
    if (dom.fieldCategoryTabs) {
      dom.fieldCategoryTabs.innerHTML = "";
    }
    if (dom.saveNextButton) {
      dom.saveNextButton.textContent = "Lanjut";
    }
    dom.reviewFlagsBox.innerHTML = renderEmptyDetailPanel("Belum ada catatan untuk ditampilkan.");
    dom.fieldConfidenceBox.innerHTML = renderEmptyDetailPanel("Belum ada nilai keyakinan untuk ditampilkan.");
    return;
  }

  dom.fieldReviewRows.classList.remove("is-empty");
  dom.workspaceIssueBox.className = "issue-box issue-box-neutral is-hidden";
  dom.workspaceIssueBox.textContent = "";
  documentRef?.querySelector?.(".field-review-head")?.classList.remove("is-hidden");
  documentRef?.querySelector?.(".workspace-panel")?.classList.remove("is-empty");
  const resolved = ensureResolvedProfile(member);
  dom.detailStatus.textContent = workspaceStatusLabel(member);
  dom.detailStatus.className = `status-pill ${workspaceStatusTone(member)}`;
  dom.workspacePassportCode.textContent = valueFrom(resolved, "passportNumber");
  dom.detailTitle.textContent = memberDisplayName(member);
  dom.detailSummary.classList.add("is-hidden");
  dom.detailSummary.textContent = "";

  renderFieldCategoryTabs({ dom, state, member });
  dom.fieldReviewRows.innerHTML = renderFieldReviewRows({
    state,
    member,
    members: manifestMembers(),
  });
  initializeWorkspaceDatePickers();
  dom.reviewFlagsBox.innerHTML = renderReviewFlagsPanel(member.reviewFlags ?? {});
  dom.fieldConfidenceBox.innerHTML = renderFieldConfidencePanel(
    member.fieldConfidence ?? {},
    member.confidenceLevel ?? {},
    member.confidence,
  );
  const currentPair = activeCategoryPairForState(state);
  const currentPairIndex = FIELD_CATEGORY_PAIRS.findIndex((item) => item.id === currentPair.id);
  const nextPair = FIELD_CATEGORY_PAIRS[currentPairIndex + 1] || null;
  if (dom.saveNextButton) {
    dom.saveNextButton.textContent = reviewPrimaryActionLabel(member, nextPair);
  }
}

export function activeCategoryPairForState(state) {
  return FIELD_CATEGORY_PAIRS.find((item) => item.id === state.activeFieldCategory) || FIELD_CATEGORY_PAIRS[0];
}

export function renderFieldReviewRows({ state, member, members }) {
  const resolved = ensureResolvedProfile(member);
  syncMemberChildMetadata(member);
  const extracted = passportExtractedOf(member);
  const pair = activeCategoryPairForState(state);
  const visibleFields = pair.categoryIds
    .map((categoryId) => FIELD_CATEGORY_DEFS.find((item) => item.id === categoryId))
    .filter(Boolean)
    .flatMap((category) => REVIEW_FIELDS.filter(([key]) => category.keys.includes(key)));

  if (!visibleFields.length) {
    return `<div class="workspace-empty-state">Kategori ini belum punya field.</div>`;
  }

  const cells = visibleFields.map(([key, label]) => {
    const ocrValue = rawValueFrom(extracted, key);
    const storedFinalValue = rawValueFrom(resolved, key);
    const fieldMaxLength = maxLengthForField(key);
    const finalValue = clampFieldValue(key, storedFinalValue);
    const dateField = isDateFieldKey(key);
    const inputValue = dateField ? dateValueForInput(finalValue) : finalValue;
    if (storedFinalValue !== finalValue) {
      setValueByPath(resolved, key, finalValue);
    }
    const flags = fieldFlagsForMember(member, key);
    const level = confidenceLevelForMember(member, key);
    const confidenceValue = confidenceValueForMember(member, key);
    const confidencePercent = Math.round(Math.max(0, Math.min(Number(confidenceValue ?? 0), 1)) * 100);
    const charCount = String(finalValue).length;
    const required = isReviewFieldRequired(key);
    const requirementLabel = required ? "Wajib" : "Optional";
    const requirementTone = required ? "required" : "optional";
    const descriptor = fieldStateDescriptor(ocrValue, finalValue, flags, level, confidenceValue, { required });
    const normalizedOcr = normalizeText(ocrValue);
    const normalizedFinal = normalizeText(finalValue);
    const hasScanSource = Boolean(normalizedOcr);
    const changedFromScan = Boolean(normalizedOcr && normalizedFinal && normalizedOcr !== normalizedFinal);
    const sourceText = ocrValue || "Belum terbaca";
    const blocked = state.reviewBlock?.target === "field" && state.reviewBlock?.fieldKey === key;
    const sourceBadge = hasScanSource
      ? (changedFromScan ? "Diubah" : "Asli")
      : "Manual";
    const sourceBadgeTone = hasScanSource
      ? (changedFromScan ? "changed" : "original")
      : "manual";

    return `
      <div class="field-pair-cell${descriptor.rowAlert ? " is-alert" : ""}${blocked ? " is-blocked" : ""}">
        <div class="field-pair-label">
          <span>${escapeHtml(label)}</span>
          <span class="field-requirement-badge ${requirementTone}">${escapeHtml(requirementLabel)}</span>
        </div>
        <div class="field-final-cell is-editable${descriptor.rowAlert ? " is-alert" : ""}${blocked ? " is-blocked" : ""}">
          <div class="field-final-stack">
            <input
              class="field-final-input${descriptor.rowAlert ? " is-alert" : ""}${blocked ? " is-blocked" : ""}${dateField ? " js-date-input" : ""}"
              data-field-key="${escapeHtml(key)}"
              type="text"
              value="${escapeHtml(inputValue)}"
              ${fieldMaxLength ? `maxlength="${fieldMaxLength}"` : ""}
              placeholder="${escapeHtml(dateField ? "YYYY/MM/DD" : label)}"
              aria-label="${escapeHtml(`Ubah ${label}`)}"
              aria-required="${required ? "true" : "false"}"
              ${required ? "required" : ""}
              ${dateField ? 'autocomplete="off" spellcheck="false" inputmode="none"' : ""}
            />
            <div class="field-source-line" title="${escapeHtml(`Sumber scan: ${sourceText}`)}">
              <span class="field-source-main">
                <span class="field-source-label">Sumber scan:</span>
                <span class="field-source-value">${escapeHtml(sourceText)}</span>
                <span class="field-source-badge ${sourceBadgeTone}">${escapeHtml(sourceBadge)}</span>
              </span>
              <span class="field-source-meta">
                <span class="field-confidence-mini">Akurasi ${escapeHtml(String(confidencePercent))}%</span>
                <span class="field-char-count">${
                  fieldMaxLength
                    ? `${escapeHtml(String(charCount))}/${fieldMaxLength}`
                    : escapeHtml(String(charCount))
                }</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  const rows = [];
  const companionPanel = renderCompanionReviewPanel({ state, member, members });
  if (companionPanel) {
    rows.push(companionPanel);
  }
  for (let index = 0; index < cells.length; index += 2) {
    const left = cells[index];
    const right = cells[index + 1] ?? `<div class="field-pair-cell is-empty" aria-hidden="true"></div>`;
    rows.push(`<div class="field-review-row">${left}${right}</div>`);
  }
  return rows.join("");
}

export function renderCompanionReviewPanel({ state, member, members }) {
  const childInfo = childInfoForMember(member);
  if (!childInfo.isChild) {
    return "";
  }

  const candidates = companionCandidatesFor(member, members);
  const selectedId = String(member.companionMemberId || "");
  const selectedCompanion = candidates.find((candidate) => String(candidate.id || "") === selectedId) || null;
  const selectedRelation = normalizeCompanionRelation(member.companionRelation || member.companion?.relation || (selectedCompanion ? inferDefaultCompanionRelation(member, selectedCompanion) : ""));
  const blocked = state.reviewBlock?.target === "companion";
  const ageLabel = Number.isFinite(childInfo.age)
    ? `${childInfo.age} tahun`
    : "umur belum terbaca";
  const options = [
    `<option value="">Pilih companion...</option>`,
    ...candidates.map((candidate) => {
      const passport = memberPassport(candidate);
      const label = `${memberDisplayName(candidate)}${passport ? ` | ${passport}` : ""}`;
      const selected = String(candidate.id || "") === selectedId ? " selected" : "";
      return `<option value="${escapeHtml(candidate.id || "")}"${selected}>${escapeHtml(label)}</option>`;
    }),
  ].join("");
  const relationOptions = COMPANION_RELATION_OPTIONS
    .map((relation) => `<option value="${escapeHtml(relation)}"${relation === selectedRelation ? " selected" : ""}>${escapeHtml(relation)}</option>`)
    .join("");

  return `
    <div class="field-review-row companion-review-row">
      <div class="companion-review-card${selectedCompanion ? " is-complete" : " is-missing"}${blocked ? " is-blocked" : ""}">
        <div class="companion-review-copy">
          <span class="companion-pill">Anak - ${escapeHtml(ageLabel)}</span>
          <strong>Companion wajib</strong>
          <small>${selectedCompanion ? "Companion terisi" : "Pilih jamaah dewasa"}</small>
        </div>
        <label class="companion-select-wrap">
          <span>Companion</span>
          <select data-companion-select aria-label="Pilih companion">
            ${options}
          </select>
        </label>
        <label class="companion-select-wrap">
          <span>Relation</span>
          <select data-companion-relation-select aria-label="Pilih relation companion"${selectedCompanion ? "" : " disabled"}>
            ${relationOptions}
          </select>
        </label>
      </div>
    </div>
  `;
}

export function renderFieldCategoryTabs({ dom, state, member }) {
  if (!dom.fieldCategoryTabs) {
    return;
  }

  const resolved = ensureResolvedProfile(member);
  const filledFinalKeys = new Set(REVIEW_FIELDS
    .filter(([key]) => rawValueFrom(resolved, key))
    .map(([key]) => key));

  if (!FIELD_CATEGORY_PAIRS.some((item) => item.id === state.activeFieldCategory)) {
    state.activeFieldCategory = FIELD_CATEGORY_PAIRS[0].id;
  }

  dom.fieldCategoryTabs.innerHTML = FIELD_CATEGORY_PAIRS.map((pair) => {
    const categories = pair.categoryIds
      .map((categoryId) => FIELD_CATEGORY_DEFS.find((item) => item.id === categoryId))
      .filter(Boolean);
    const keys = categories.flatMap((category) => category.keys);
    const requiredKeys = keys.filter((key) => isReviewFieldRequired(key));
    const total = requiredKeys.length;
    const filled = requiredKeys.filter((key) => filledFinalKeys.has(key)).length;
    const active = pair.id === state.activeFieldCategory ? " is-active" : "";
    return `
      <button class="field-category-tab${active}" type="button" data-field-category="${escapeHtml(pair.id)}">
        <span>${escapeHtml(pair.label)}</span>
        <small>${filled}/${total} wajib</small>
      </button>
    `;
  }).join("");
}

export function workspaceStatusLabel(member) {
  const status = memberReviewStatus(member);
  if (status === "ERROR") {
    return "Perlu perhatian";
  }
  if (status === "NEEDS_REVIEW") {
    return "Perlu review";
  }
  if (Number(member.confidence ?? 0) < 0.85) {
    return "Perlu dicek";
  }
  return "Reviewed";
}

export function workspaceStatusTone(member) {
  const status = memberReviewStatus(member);
  if (status === "ERROR") {
    return "error";
  }
  if (status === "NEEDS_REVIEW") {
    return "warn";
  }
  if (Number(member.confidence ?? 0) < 0.85) {
    return "warn";
  }
  return "valid";
}
