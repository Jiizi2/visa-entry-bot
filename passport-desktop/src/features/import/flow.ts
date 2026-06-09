import { FIELD_CATEGORY_PAIRS } from "../../shared/fields.js";
import { ocrModeLabel } from "../../shared/ocr.js";
import { basenameFromPath, parentPath } from "../../shared/utils.js";

export function normalizePathForCompare(path) {
  return String(path ?? "")
    .trim()
    .replace(/[\\/]+$/, "")
    .replace(/\//g, "\\")
    .toLowerCase();
}

export function createImportWorkflow({
  dom,
  state,
  windowRef = globalThis.window,
  requestFrame = (callback) => callback(),
  runAction,
  renderAll,
  setPage,
  appendScanLog,
  rememberRecentBatch,
  loadManifest,
  recalculateMetrics,
  manifestMembers,
  updateOcrMode,
  openFolderDialog,
  prepareImagesCommand = async (options: { selectedDir: string }) => ({ items: [] as any[], preparedManifestPath: "" }),
  startScanCommand,
  stopScanCommand,
  findManifestPath,
}) {
  let rescanConfirmResolver: any = null;

  async function chooseFolder() {
    if (state.isScanning || state.isChoosingFolder) {
      return;
    }

    state.isChoosingFolder = true;
    state.statusHeadline = "Membuka pilihan folder";
    state.statusDetail = "Pilih folder passport yang ingin diproses.";
    renderAll();

    try {
      const selected = await openFolderDialog({
        directory: true,
        multiple: false,
        title: "Pilih folder passport",
      });

      if (typeof selected === "string") {
        updateSelectedDir(selected);
        if (dom.folderPath) {
          dom.folderPath.value = state.selectedDir;
        }
        if (state.selectedDir) {
          await prepareImages();
        }
      } else {
        state.statusHeadline = state.selectedDir ? "Folder tetap dipakai" : "Folder belum dipilih";
        state.statusDetail = state.selectedDir
          ? `Masih memakai folder ${basenameFromPath(state.selectedDir)}.`
          : "Pilih folder passport sebelum memulai proses.";
      }
    } finally {
      state.isChoosingFolder = false;
      renderAll();
    }
  }

  async function prepareImages() {
    state.selectedDir = String(state.selectedDir || dom.folderPath?.value || "").trim();
    if (!state.selectedDir) {
      state.statusHeadline = "Folder belum dipilih";
      state.statusDetail = "Pilih folder passport atau folder grup sebelum menyiapkan foto.";
      state.currentPage = "import";
      renderAll();
      return;
    }

    state.isPreparingImages = true;
    state.statusHeadline = "Menyiapkan foto";
    state.statusDetail = "PDF akan diubah ke JPG dan semua foto disiapkan untuk preview.";
    state.preparedSession = null;
    state.activePreparedItemId = "";
    state.preparedImageCache = new Map();
    state.scanLogs = [];
    appendScanLog(`Menyiapkan foto dari folder ${state.selectedDir}`);
    renderAll();

    try {
      const session = await prepareImagesCommand({ selectedDir: state.selectedDir }) as any;
      state.preparedSession = session;
      const items = Array.isArray(session?.items) ? session.items : [];
      state.activePreparedItemId = String(items[0]?.id || "");
      state.preparedImageCache = new Map();
      state.totalFiles = items.length;
      state.progressCurrent = 0;
      state.progressTotal = items.length;
      state.progressFileName = "";
      state.progressStageLabel = "Foto siap preview";
      state.statusHeadline = "Foto siap dicek";
      state.statusDetail = `${items.length} foto siap dipreview sebelum scan.`;
      appendScanLog(`Foto siap preview | ${items.length} gambar | ${Number(session?.convertedCount || 0)} hasil PDF`);
      setPage("prepare");
    } catch (error) {
      state.preparedSession = null;
      state.activePreparedItemId = "";
      state.preparedImageCache = new Map();
      state.statusHeadline = "Prepare foto gagal";
      state.statusDetail = String(error);
      appendScanLog(`Prepare foto gagal | ${state.statusDetail}`);
    } finally {
      state.isPreparingImages = false;
      renderAll();
    }
  }

  async function startScan() {
    state.selectedDir = String(state.selectedDir || dom.folderPath?.value || "").trim();
    updateOcrMode(state.ocrMode);
    if (!state.selectedDir) {
      state.statusHeadline = "Folder belum dipilih";
      state.statusDetail = "Pilih folder passport atau folder grup sebelum memulai proses.";
      state.currentPage = "import";
      renderAll();
      return;
    }
    const preparedManifestPath = hasPreparedSessionForSelectedDir()
      ? String(state.preparedSession?.preparedManifestPath || "")
      : "";

    state.manifest = null;
    state.originalManifest = null;
    state.manifestPath = "";
    state.resultDir = "";
    state.resultSourceDir = "";
    state.activeMemberId = "";
    state.selectedIds = new Set();
    state.reviewedMemberIds = new Set();
    state.totalFiles = 0;
    state.validCount = 0;
    state.errorCount = 0;
    state.reviewCount = 0;
    state.progressCurrent = 0;
    state.progressTotal = 0;
    state.progressFileName = "";
    state.progressStageLabel = "";
    state.lastWorkerMessage = "";
    state.scanLogs = [];
    state.scanPerfSummary = null;
    state.scanMetricRecords = [];
    state.lastScanMetric = null;
    state.exportedBatchPath = "";
    state.exportError = "";
    state.validationFilter = "all";
    state.passportListPage = 1;
    state.isScanning = true;
    state.isStoppingScan = false;
    state.currentPage = "scan";
    state.statusHeadline = "Memulai proses";
    state.statusDetail = "Sedang menyiapkan pembacaan data.";
    appendScanLog(`Memulai proses untuk folder ${state.selectedDir}`);
    appendScanLog(`Mode OCR: ${ocrModeLabel(state.ocrMode)}`);
    renderAll();

    try {
      await startScanCommand({ selectedDir: state.selectedDir, ocrMode: state.ocrMode, preparedManifestPath });
    } catch (error) {
      state.isScanning = false;
      state.isStoppingScan = false;
      state.statusHeadline = "Scan gagal dimulai";
      state.statusDetail = String(error);
      renderAll();
    }
  }

  async function handleScanButtonClick() {
    if (state.isScanning || state.isStartingScan || state.isPreparingImages) {
      return;
    }

    state.isStartingScan = true;
    renderAll();
    try {
      if (!hasPreparedSessionForSelectedDir()) {
        await prepareImages();
        return;
      }
      setPage("prepare");
    } finally {
      if (!state.isScanning) {
        state.isStartingScan = false;
        renderAll();
      }
    }
  }

  async function handleStartScanButtonClick() {
    if (state.isScanning || state.isStartingScan || state.isPreparingImages) {
      return;
    }

    state.isStartingScan = true;
    renderAll();
    try {
      if (!hasPreparedSessionForSelectedDir()) {
        await prepareImages();
      }
      if (!hasPreparedSessionForSelectedDir()) {
        return;
      }
      const hasAnyResult = hasAnyScanResult();
      const hasResultForSelected = hasScanResultForSelectedDir();
      if (hasAnyResult) {
        const mode = hasResultForSelected ? "rescan-same" : "replace-folder";
        const confirmed = await requestRescanConfirmation(mode);
        if (!confirmed) {
          return;
        }
      }
      await startScan();
    } finally {
      if (!state.isScanning) {
        state.isStartingScan = false;
        renderAll();
      }
    }
  }

  function openStopScanModal() {
    if (!state.isScanning || state.isStoppingScan) {
      return;
    }
    if (!dom.stopScanConfirmModal) {
      runAction(() => confirmStopScan(), "Stop scan");
      return;
    }

    dom.stopScanConfirmModal.classList.remove("is-hidden");
    dom.stopScanConfirmModal.setAttribute("aria-hidden", "false");
    requestFrame(() => dom.stopScanCancelButton?.focus());
  }

  function closeStopScanModal() {
    if (!dom.stopScanConfirmModal) {
      return;
    }
    dom.stopScanConfirmModal.classList.add("is-hidden");
    dom.stopScanConfirmModal.setAttribute("aria-hidden", "true");
  }

  async function confirmStopScan() {
    closeStopScanModal();
    if (!state.isScanning || state.isStoppingScan) {
      return;
    }

    state.isStoppingScan = true;
    state.statusHeadline = "Menghentikan scan";
    state.statusDetail = "Meminta worker OCR berhenti...";
    appendScanLog("Mengirim permintaan stop scan.");
    renderAll();

    try {
      await stopScanCommand();
    } catch (error) {
      state.isStoppingScan = false;
      state.statusHeadline = "Stop scan gagal";
      state.statusDetail = String(error || "Worker OCR tidak berhasil dihentikan.");
      appendScanLog(`Stop scan gagal | ${state.statusDetail}`);
      renderAll();
    }
  }

  function requestRescanConfirmation(mode = "rescan-same") {
    if (!dom.rescanConfirmModal || !dom.rescanConfirmButton || !dom.rescanCancelButton) {
      const fallbackCopy = mode === "replace-folder"
        ? "Folder baru akan mengganti data scan yang sedang aktif. Lanjut proses folder ini?"
        : "Hasil scan sebelumnya akan diganti. Lanjut scan ulang?";
      return Promise.resolve(windowRef.confirm(fallbackCopy));
    }

    const currentFolder = basenameFromPath(state.selectedDir || "-");
    const previousFolder = basenameFromPath(state.resultSourceDir || state.resultDir || "-");
    if (dom.rescanModalTitle && dom.rescanModalDesc && dom.rescanConfirmButton) {
      if (mode === "replace-folder") {
        dom.rescanModalTitle.textContent = "Ganti folder aktif?";
        dom.rescanModalDesc.textContent = `Data aktif dari folder ${previousFolder} akan diganti dengan scan baru dari folder ${currentFolder}. Lanjutkan?`;
        dom.rescanConfirmButton.textContent = "Ya, Proses Folder Ini";
      } else {
        dom.rescanModalTitle.textContent = "Scan ulang folder ini?";
        dom.rescanModalDesc.textContent = `Hasil scan folder ${currentFolder} akan diganti dengan proses terbaru. Lanjutkan?`;
        dom.rescanConfirmButton.textContent = "Ya, Scan Ulang";
      }
    }

    dom.rescanConfirmModal.classList.remove("is-hidden");
    dom.rescanConfirmModal.setAttribute("aria-hidden", "false");
    dom.rescanConfirmButton.focus();

    return new Promise((resolve) => {
      rescanConfirmResolver = resolve;
    });
  }

  function resolveRescanConfirmation(confirmed) {
    if (!rescanConfirmResolver) {
      return;
    }
    const resolve = rescanConfirmResolver;
    rescanConfirmResolver = null;
    dom.rescanConfirmModal?.classList.add("is-hidden");
    dom.rescanConfirmModal?.setAttribute("aria-hidden", "true");
    resolve(Boolean(confirmed));
  }

  function hasAnyScanResult() {
    return Boolean(state.manifestPath && state.manifest && manifestMembers().length);
  }

  function hasScanResultForPath(pathValue) {
    if (!hasAnyScanResult()) {
      return false;
    }
    const targetPath = normalizePathForCompare(pathValue);
    const activeSource = normalizePathForCompare(state.resultSourceDir || state.resultDir || "");
    if (!targetPath || !activeSource) {
      return false;
    }
    return targetPath === activeSource;
  }

  function hasScanResultForSelectedDir() {
    return hasScanResultForPath(state.selectedDir);
  }

  function hasPreparedSessionForSelectedDir() {
    const preparedPath = normalizePathForCompare(state.preparedSession?.selectedDir || "");
    const selectedPath = normalizePathForCompare(state.selectedDir || dom.folderPath?.value || "");
    return Boolean(preparedPath && selectedPath && preparedPath === selectedPath && state.preparedSession?.preparedManifestPath);
  }

  function clearPreparedSession() {
    state.preparedSession = null;
    state.activePreparedItemId = "";
    state.preparedImageCache = new Map();
  }

  function updateSelectedDir(nextDir) {
    const nextValue = String(nextDir ?? "").trim();
    const previousValue = String(state.selectedDir ?? "").trim();
    if (nextValue === previousValue) {
      return;
    }

    state.selectedDir = nextValue;
    if (!hasPreparedSessionForSelectedDir()) {
      clearPreparedSession();
    }
    if (!nextValue || state.isScanning || !hasAnyScanResult()) {
      return;
    }

    if (!hasScanResultForPath(nextValue)) {
      const fromFolder = basenameFromPath(state.resultSourceDir || state.resultDir || "-");
      const toFolder = basenameFromPath(nextValue);
      state.statusHeadline = "Folder diubah";
      state.statusDetail = `Folder aktif berubah dari ${fromFolder} ke ${toFolder}. Klik Proses Folder Ini untuk mengganti data scan.`;
      state.currentPage = "import";
    }
  }

  async function openRecentBatch(path) {
    const normalizedPath = String(path ?? "").trim();
    if (!normalizedPath) {
      return;
    }

    state.selectedDir = normalizedPath;
    clearPreparedSession();
    state.currentPage = "import";
    state.scanPerfSummary = null;
    state.scanMetricRecords = [];
    state.lastScanMetric = null;
    state.statusHeadline = "Memuat riwayat";
    state.statusDetail = `Mencari manifest dari ${basenameFromPath(normalizedPath)}.`;
    renderAll();

    try {
      let manifestPath = await resolveManifestPathForRecent(normalizedPath);
      if (!manifestPath) {
        state.manifestPath = "";
        state.manifest = null;
        state.originalManifest = null;
        state.activeMemberId = "";
        state.resultDir = "";
        state.resultSourceDir = "";
        state.statusHeadline = "Manifest belum ditemukan";
        state.statusDetail = "Folder dipilih. Jalankan scan jika folder ini belum punya manifest.json.";
        renderAll();
        return;
      }

      state.manifestPath = manifestPath;
      state.resultDir = parentPath(manifestPath);
      state.resultSourceDir = normalizedPath;

      try {
        await loadManifest();
      } catch (loadError) {
        const entry = state.recentBatches.find((item) => item.path === normalizedPath);
        const storedManifestPath = String(entry?.manifestPath ?? "").trim();
        const normalizedStored = normalizePathForCompare(storedManifestPath);
        const normalizedResolved = normalizePathForCompare(manifestPath);
        if (normalizedStored && normalizedStored === normalizedResolved) {
          const fallbackManifestPath = await detectManifestPathFromBasePath(normalizedPath);
          if (fallbackManifestPath && normalizePathForCompare(fallbackManifestPath) !== normalizedResolved) {
            manifestPath = fallbackManifestPath;
            state.manifestPath = manifestPath;
            state.resultDir = parentPath(manifestPath);
            state.resultSourceDir = normalizedPath;
            await loadManifest();
          } else {
            throw loadError;
          }
        } else {
          throw loadError;
        }
      }
      recalculateMetrics();
      state.passportListPage = 1;
      state.validationFilter = "all";
      state.activeFieldCategory = FIELD_CATEGORY_PAIRS[0]?.id ?? "identity";
      state.progressCurrent = state.totalFiles;
      state.progressTotal = state.totalFiles;
      state.progressFileName = "";
      state.progressStageLabel = "Data dimuat dari riwayat";
      state.statusHeadline = "Riwayat berhasil dimuat";
      state.statusDetail = `Manifest terbuka dari ${manifestPath}.`;
      rememberRecentBatch(normalizedPath, state.totalFiles, manifestPath);
      setPage("validation");
    } catch (error) {
      state.statusHeadline = "Gagal membuka riwayat";
      state.statusDetail = String(error);
      renderAll();
    }
  }

  async function resolveManifestPathForRecent(recentPath) {
    const entry = state.recentBatches.find((item) => item.path === recentPath);
    const storedManifestPath = String(entry?.manifestPath ?? "").trim();
    if (storedManifestPath) {
      return storedManifestPath;
    }

    return detectManifestPathFromBasePath(recentPath);
  }

  async function detectManifestPathFromBasePath(basePath) {
    const detectedPath = await findManifestPath(basePath);
    return typeof detectedPath === "string" ? detectedPath.trim() : "";
  }

  return {
    chooseFolder,
    prepareImages,
    startScan,
    handleScanButtonClick,
    handleStartScanButtonClick,
    openStopScanModal,
    closeStopScanModal,
    confirmStopScan,
    requestRescanConfirmation,
    resolveRescanConfirmation,
    hasAnyScanResult,
    hasScanResultForPath,
    hasScanResultForSelectedDir,
    hasPreparedSessionForSelectedDir,
    updateSelectedDir,
    openRecentBatch,
    resolveManifestPathForRecent,
    detectManifestPathFromBasePath,
  };
}
