import type { OcrMode } from "./ocr.js";

// ---------------------------------------------------------------------------
// Manifest & Member types
// ---------------------------------------------------------------------------

export interface ArabicProfile {
  firstName: string;
  fatherName: string;
  grandfatherName: string;
  familyName: string;
}

export interface ResolvedProfile {
  firstName: string;
  fatherName: string;
  grandfatherName: string;
  familyName: string;
  passportNumber: string;
  nationality: string;
  previousNationality?: string;
  dob: string;
  issueDate: string;
  releaseDate: string;
  expiryDate: string;
  gender: string;
  passportType: string;
  countryOfIssued: string;
  cityOfIssued: string;
  birthCountry: string;
  birthCity: string;
  profession: string;
  maritalStatus: string;
  vaccinationCertificate: string;
  vaccinationCertificatePath: string;
  email: string;
  mobileNumber: string;
  arabic: ArabicProfile;
}

export interface CompanionSnapshot {
  id: string;
  name: string;
  passportNumber: string;
  relation: string;
}

export interface ManifestMember {
  id: string;
  fileName: string;
  status: string;
  resolvedProfile: ResolvedProfile;
  passportExtracted?: Partial<ResolvedProfile>;
  reviewFlags?: Record<string, unknown>;
  confidenceLevel?: Record<string, unknown>;
  fieldConfidence?: Record<string, unknown>;
  isChild?: boolean;
  ageAtReview?: number | null;
  companionMemberId?: string;
  companionRelation?: string;
  companion?: CompanionSnapshot;
  intentionalEmpties?: Record<string, boolean>;
  passportImagePath?: string;
  scanTimingMs?: number;
}

export interface Manifest {
  members: ManifestMember[];
  sourceDir?: string;
  resultDir?: string;
  createdAt?: string;
  ocrMode?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Scan & Progress types
// ---------------------------------------------------------------------------

export interface ScanLogEntry {
  message: string;
  stage?: string;
  file?: string;
  timestamp?: string;
}

export interface ScanMetricRecord {
  fileName: string;
  durationMs: number;
  mode?: string;
}

export interface ScanPerfSummary {
  totalMs: number;
  avgMs: number;
  fileCount: number;
}

// ---------------------------------------------------------------------------
// Recent batches
// ---------------------------------------------------------------------------

export interface RecentBatchEntry {
  path: string;
  label: string;
  usedAt: string;
  totalFiles: number;
  manifestPath: string;
}

// ---------------------------------------------------------------------------
// Entry / Export
// ---------------------------------------------------------------------------

export interface EntryLogEntry {
  message: string;
  type?: "info" | "error" | "success";
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// Prepared session
// ---------------------------------------------------------------------------

export interface PreparedItem {
  id: string;
  fileName: string;
  imagePath: string;
  rotationDegrees?: number;
  flipH?: boolean;
  flipV?: boolean;
  crop?: CropRect | null;
}

export interface PreparedSession {
  manifestPath: string;
  items: PreparedItem[];
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Review block
// ---------------------------------------------------------------------------

export interface ReviewBlock {
  message: string;
  fieldKey?: string;
  memberId?: string;
}

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

export type PageName = "import" | "prepare" | "scan" | "validation" | "entry";
export type ValidationFilter = "all" | "valid" | "error" | "review";
export type FieldCategory = "identity" | "passport" | "contact" | "arabic";

export interface AppState {
  currentPage: PageName;
  validationFilter: ValidationFilter;
  selectedDir: string;
  ocrMode: OcrMode;
  recentBatches: RecentBatchEntry[];

  manifest: Manifest | null;
  originalManifest: Manifest | null;
  manifestPath: string;
  resultDir: string;
  resultSourceDir: string;

  activeMemberId: string;
  selectedIds: Set<string>;
  reviewedMemberIds: Set<string>;
  passportListPage: number;
  passportListPageSize: number;

  totalFiles: number;
  validCount: number;
  errorCount: number;
  reviewCount: number;

  progressCurrent: number;
  progressTotal: number;
  progressFileName: string;
  progressStageLabel: string;

  isEntryRunning: boolean;
  exportedBatchPath: string;
  exportError: string;
  entryLogs: EntryLogEntry[];

  lastWorkerMessage: string;
  scanLogs: ScanLogEntry[];
  scanPerfSummary: ScanPerfSummary | null;
  scanMetricRecords: ScanMetricRecord[];
  lastScanMetric: ScanMetricRecord | null;
  showFullScanLog: boolean;

  activeFieldCategory: FieldCategory;

  passportImageCache: Map<string, string>;
  preparedSession: PreparedSession | null;
  activePreparedItemId: string;
  preparedImageCache: Map<string, string>;
  preparedPreviewZoom: number;
  passportPreviewZoom: number;
  passportCropZoom: number;

  reviewBlock: ReviewBlock | null;

  statusHeadline: string;
  statusDetail: string;

  isScanning: boolean;
  isPreparingImages: boolean;
  isStoppingScan: boolean;
  isStartingScan: boolean;
  isChoosingFolder: boolean;
}

// ---------------------------------------------------------------------------
// DOM bindings
// ---------------------------------------------------------------------------

/** Minimal type for the DOM bindings object populated by bindDom(). */
export interface DomBindings {
  navButtons: HTMLElement[];
  navConnectors: HTMLElement[];
  folderPath: HTMLInputElement;
  chooseFolderButton: HTMLButtonElement;
  folderDropzone: HTMLElement;
  scanButton: HTMLButtonElement;
  startScanButton: HTMLButtonElement | null;
  prepareBackButton: HTMLButtonElement | null;
  lastScanOpenButton: HTMLButtonElement | null;
  ocrModeInputs: HTMLInputElement[];
  stopScanButton: HTMLButtonElement | null;
  importNextButton: HTMLButtonElement | null;
  filterButtons: HTMLElement[];
  passportList: HTMLElement | null;
  fieldReviewRows: HTMLElement;
  resetFieldsButton: HTMLElement;
  deletePassportButton: HTMLElement | null;
  saveNextButton: HTMLElement | null;
  fieldCategoryTabs: HTMLElement | null;
  topbarEyebrow: HTMLElement;
  topbarTitle: HTMLElement;
  topbarStatus: HTMLElement;
  recentBatchesList: HTMLElement;
  passportPagePrevButton: HTMLElement | null;
  passportPageNextButton: HTMLElement | null;
  passportZoomOutButton: HTMLElement | null;
  passportZoomInButton: HTMLElement | null;
  passportZoomResetButton: HTMLElement | null;
  passportPreviewFrame: HTMLElement | null;
  passportCropButton: HTMLElement | null;
  passportCropModal: HTMLElement | null;
  passportCropCancelButton: HTMLElement | null;
  passportCropResetButton: HTMLElement | null;
  passportCropSaveButton: HTMLElement | null;
  passportCropZoomInput: HTMLInputElement | null;
  passportCropCanvas: HTMLCanvasElement | null;
  workspacePrevButtons: HTMLElement[];
  workspaceNextButtons: HTMLElement[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Tauri bindings
// ---------------------------------------------------------------------------

export interface TauriBindings {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  open: (options?: Record<string, unknown>) => Promise<string | string[] | null>;
  listen: (event: string, handler: (event: { event: string; payload: unknown }) => void) => Promise<() => void>;
  convertFileSrc: (path: string) => string;
}
