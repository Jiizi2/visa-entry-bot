import { DEFAULT_OCR_MODE } from "./main-ocr.js";
import { PASSPORT_PREVIEW_ZOOM_DEFAULT } from "./main-passport-preview.js";
import { createEntryDefaults } from "./main-entry-defaults.js";

export const STORAGE_KEYS = {
  entryDefaults: "entrymate-entry-defaults-v1",
  recentBatches: "passport-assistant-recent-batches-v1",
};

export const MANIFEST_SAVE_DELAY_MS = 350;

export function createInitialState() {
  return {
    currentPage: "import",
    validationFilter: "all",
    selectedDir: "",
    ocrMode: DEFAULT_OCR_MODE,
    entryDefaults: createEntryDefaults(),
    recentBatches: [],
    manifest: null,
    originalManifest: null,
    manifestPath: "",
    resultDir: "",
    resultSourceDir: "",
    activeMemberId: "",
    selectedIds: new Set(),
    reviewedMemberIds: new Set(),
    passportListPage: 1,
    passportListPageSize: 8,
    totalFiles: 0,
    validCount: 0,
    errorCount: 0,
    reviewCount: 0,
    progressCurrent: 0,
    progressTotal: 0,
    progressFileName: "",
    progressStageLabel: "",
    isEntryRunning: false,
    exportedBatchPath: "",
    exportError: "",
    entryLogs: [],
    lastWorkerMessage: "",
    scanLogs: [],
    scanPerfSummary: null,
    scanMetricRecords: [],
    lastScanMetric: null,
    showFullScanLog: false,
    activeFieldCategory: "identity",
    passportImageCache: new Map(),
    preparedSession: null,
    activePreparedItemId: "",
    preparedImageCache: new Map(),
    preparedPreviewZoom: 1,
    passportPreviewZoom: PASSPORT_PREVIEW_ZOOM_DEFAULT,
    passportCropZoom: 1,
    reviewBlock: null,
    statusHeadline: "",
    statusDetail: "",
    isScanning: false,
    isPreparingImages: false,
    isStoppingScan: false,
    isStartingScan: false,
    isChoosingFolder: false,
  };
}
