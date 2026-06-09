const PAGE_ORDER = ["import", "prepare", "scan", "validation", "entry"];

export function createMainRenderer({
  dom,
  state,
  requestFrame,
  cancelFrame,
  documentRef = globalThis.document,
  refreshCompactLogs,
  ensureVisibleActiveMember,
  renderImportPage,
  renderPreparedPreview = () => {},
  renderProgressPanel,
  renderScanLogs,
  renderPassportList,
  renderPassportPreview,
  renderWorkspace,
  renderReviewExportModal,
  renderEntryPage,
  updateActionAvailability,
  reviewCompletionState,
  isEntryAccessible,
}) {
  let renderAllHandle = null;
  let renderAllQueued = false;

  function renderAll() {
    clearScheduledRenderAll();
    refreshCompactLogs();
    ensureVisibleActiveMember();
    renderNavigation({ dom, state, reviewCompletionState, isEntryAccessible });
    renderPageVisibility({ dom, state, documentRef });
    renderTopbar({ dom, state, documentRef });
    renderImportPage();
    renderPreparedPreview();
    renderProgressPanel();
    renderScanLogs();
    renderPassportList();
    renderPassportPreview();
    renderWorkspace();
    renderReviewExportModal();
    renderEntryPage();
    updateActionAvailability();
  }

  function scheduleRenderAll() {
    if (renderAllQueued) {
      return;
    }
    renderAllQueued = true;
    renderAllHandle = requestFrame(() => {
      renderAllQueued = false;
      renderAllHandle = null;
      renderAll();
    });
  }

  function clearScheduledRenderAll() {
    if (!renderAllQueued) {
      return;
    }
    if (renderAllHandle !== null) {
      cancelFrame(renderAllHandle);
    }
    renderAllQueued = false;
    renderAllHandle = null;
  }

  return {
    renderAll,
    scheduleRenderAll,
    clearScheduledRenderAll,
  };
}

export function renderNavigation({ dom, state, reviewCompletionState, isEntryAccessible }) {
  const activeIndex = PAGE_ORDER.indexOf(state.currentPage);
  const review = reviewCompletionState();
  const entryReady = isEntryAccessible();
  const subtitleByPage = {
    import: state.manifestPath
      ? "Riwayat tersedia"
      : state.selectedDir
        ? "Folder dipilih"
        : "Pilih folder kerja",
    prepare: state.preparedSession
      ? `${preparedItemCount(state)} foto siap`
      : state.isPreparingImages
        ? "Menyiapkan foto"
        : "Rapikan foto",
    scan: state.isScanning
      ? "OCR berjalan"
      : state.manifestPath
        ? "Scan selesai"
        : "Menunggu scan",
    validation: review.remaining > 0 ? `Sisa review: ${review.remaining} data` : "Semua data sudah dicek",
    entry: entryReady ? "Siap preview/export JSON" : "Selesaikan review dulu",
  };

  for (const button of dom.navButtons || []) {
    const page = button.dataset.page ?? "";
    const stepIndex = PAGE_ORDER.indexOf(page);
    const isActive = button.dataset.page === state.currentPage;
    const isComplete = stepIndex >= 0 && activeIndex >= 0 && stepIndex < activeIndex;
    const isUpcoming = stepIndex >= 0 && activeIndex >= 0 && stepIndex > activeIndex;

    button.classList.toggle("is-active", isActive);
    button.classList.toggle("is-complete", isComplete);
    button.classList.toggle("is-upcoming", isUpcoming);
    button.setAttribute("aria-current", isActive ? "page" : "false");

    const badge = button.querySelector("[data-step-badge]");
    if (badge) {
      badge.textContent = isComplete ? "OK" : String(stepIndex + 1);
    }

    const subtitle = button.querySelector("[data-step-subtitle]");
    if (subtitle) {
      subtitle.textContent = isComplete ? "Selesai" : (subtitleByPage[page] ?? "");
    }
  }

  dom.navConnectors?.forEach((connector, connectorIndex) => {
    const isComplete = activeIndex > connectorIndex;
    connector.classList.toggle("is-complete", isComplete);
  });
}

export function renderPageVisibility({ dom, state, documentRef = globalThis.document }) {
  dom.pageImport?.classList.toggle("is-hidden", state.currentPage !== "import");
  dom.pagePrepare?.classList.toggle("is-hidden", state.currentPage !== "prepare");
  dom.pageScan?.classList.toggle("is-hidden", state.currentPage !== "scan");
  dom.pageValidation?.classList.toggle("is-hidden", state.currentPage !== "validation");
  dom.pageEntry?.classList.toggle("is-hidden", state.currentPage !== "entry");
  const topbarNode = documentRef?.querySelector?.(".topbar") as HTMLElement | null;
  if (topbarNode) {
    topbarNode.style.display = "flex";
  }
}

export function renderTopbar({ dom, state, documentRef = globalThis.document }) {
  const topbar = topbarDescriptor(state);
  const topbarNode = documentRef?.querySelector?.(".topbar");
  dom.topbarEyebrow.textContent = topbar.eyebrow;
  dom.topbarTitle.textContent = topbar.title;
  dom.topbarEyebrow.classList.toggle("is-hidden", !topbar.eyebrow);
  dom.topbarStatus.textContent = topbar.statusLabel;
  dom.topbarStatus.className = `status-chip ${topbar.statusTone}`;
  topbarNode?.classList.toggle("is-compact", Boolean(topbar.compact));
  topbarNode?.classList.toggle("is-hidden", Boolean(topbar.hidden));
}

export function topbarDescriptor(state) {
  const status = currentTopbarStatus(state);
  if (state.currentPage === "import") {
    return {
      eyebrow: "",
      title: "Pilih Folder",
      statusLabel: status.label,
      statusTone: status.tone,
      compact: true,
    };
  }

  if (state.currentPage === "prepare") {
    return {
      eyebrow: "",
      title: "Review & Persiapan Foto",
      statusLabel: status.label,
      statusTone: status.tone,
      compact: true,
      hidden: false,
    };
  }

  if (state.currentPage === "scan") {
    return {
      eyebrow: "",
      title: "Progress OCR",
      statusLabel: status.label,
      statusTone: status.tone,
      compact: true,
      hidden: false,
    };
  }

  if (state.currentPage === "entry") {
    const entryStatus = state.exportedBatchPath
      ? { label: "JSON dibuat", tone: "ready" }
      : state.manifestPath
        ? { label: "Review selesai", tone: "ready" }
        : status;
    return {
      eyebrow: "",
      title: "Export JSON",
      statusLabel: entryStatus.label,
      statusTone: entryStatus.tone,
      compact: true,
      hidden: false,
    };
  }

  return {
    eyebrow: "",
    title: "Periksa Data",
    statusLabel: status.label,
    statusTone: status.tone,
    compact: true,
    hidden: false,
  };
}

function preparedItemCount(state) {
  const items = state.preparedSession?.items;
  return Array.isArray(items) ? items.length : 0;
}

export function currentTopbarStatus(state) {
  if (state.isPreparingImages) {
    return { label: "Menyiapkan Foto", tone: "info" };
  }
  if (state.isStoppingScan) {
    return { label: "Menghentikan", tone: "warn" };
  }
  if (state.isScanning) {
    return { label: "Sedang Diproses", tone: "info" };
  }
  if (/gagal/i.test(state.statusHeadline)) {
    return { label: "Perlu Perhatian", tone: "danger" };
  }
  if (state.manifestPath && (state.errorCount > 0 || state.reviewCount > 0)) {
    return { label: "Perlu Dicek", tone: "warn" };
  }
  if (state.manifestPath) {
    return { label: "Siap", tone: "ready" };
  }
  if (state.preparedSession) {
    return { label: "Preview Siap", tone: "ready" };
  }
  if (state.selectedDir) {
    return { label: "Sudah Dipilih", tone: "neutral" };
  }
  return { label: "Menunggu", tone: "neutral" };
}
