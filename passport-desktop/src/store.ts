import { create } from 'zustand';

export type Page = 'import' | 'prepare' | 'scan' | 'validation' | 'entry';

export interface DefaultEntry {
  profesi: string;
  statusNikah: string;
  tipePassport: string;
  email: string;
  nomorTelepon: string;
}

export interface AppState {
  currentPage: Page;
  validationFilter: string;
  selectedDir: string;
  ocrMode: string;
  recentBatches: any[];
  defaultEntry: DefaultEntry;
  manifest: any | null;
  originalManifest: any | null;
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
  entryLogs: any[];
  lastWorkerMessage: string;
  scanLogs: any[];
  scanPerfSummary: any | null;
  scanMetricRecords: any[];
  lastScanMetric: any | null;
  showFullScanLog: boolean;
  activeFieldCategory: string;
  passportImageCache: Map<string, string>;
  preparedSession: any | null;
  activePreparedItemId: string;
  preparedImageCache: Map<string, string>;
  preparedPreviewZoom: number;
  passportPreviewZoom: number;
  passportCropZoom: number;
  reviewBlock: any | null;
  statusHeadline: string;
  statusDetail: string;
  isScanning: boolean;
  isPreparingImages: boolean;
  isStoppingScan: boolean;
  isStartingScan: boolean;
  isChoosingFolder: boolean;
  
  // Actions
  updateState: (updates: Partial<AppState>) => void;
  initializeStore: () => void;
}

const initialState: Omit<AppState, 'updateState' | 'initializeStore'> = {
  currentPage: 'import',
  validationFilter: 'all',
  selectedDir: '',
  ocrMode: 'balanced',
  recentBatches: [],
  defaultEntry: {
    profesi: 'OTHER',
    statusNikah: 'OTHER',
    tipePassport: 'NORMAL',
    email: '',
    nomorTelepon: ''
  },
  manifest: null,
  originalManifest: null,
  manifestPath: '',
  resultDir: '',
  resultSourceDir: '',
  activeMemberId: '',
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
  progressFileName: '',
  progressStageLabel: '',
  isEntryRunning: false,
  exportedBatchPath: '',
  exportError: '',
  entryLogs: [],
  lastWorkerMessage: '',
  scanLogs: [],
  scanPerfSummary: null,
  scanMetricRecords: [],
  lastScanMetric: null,
  showFullScanLog: false,
  activeFieldCategory: 'identity',
  passportImageCache: new Map(),
  preparedSession: null,
  activePreparedItemId: '',
  preparedImageCache: new Map(),
  preparedPreviewZoom: 1,
  passportPreviewZoom: 1,
  passportCropZoom: 1,
  reviewBlock: null,
  statusHeadline: '',
  statusDetail: '',
  isScanning: false,
  isPreparingImages: false,
  isStoppingScan: false,
  isStartingScan: false,
  isChoosingFolder: false,
};

export const useStore = create<AppState>((set) => ({
  ...initialState,
  
  updateState: (updates: Partial<AppState>) => set((state) => {
    // Handle localStorage persistency for specific fields
    if (updates.recentBatches !== undefined) {
      try { localStorage.setItem('recentBatches', JSON.stringify(updates.recentBatches)); } catch(e){}
    }
    if (updates.defaultEntry !== undefined) {
      try { localStorage.setItem('defaultEntry', JSON.stringify(updates.defaultEntry)); } catch(e){}
    }
    return updates as AppState;
  }),
  
  initializeStore: () => {
    try {
      const savedRecent = localStorage.getItem('recentBatches');
      const savedDefaultEntry = localStorage.getItem('defaultEntry');
      set((state) => ({
        recentBatches: savedRecent ? JSON.parse(savedRecent) : state.recentBatches,
        defaultEntry: savedDefaultEntry ? JSON.parse(savedDefaultEntry) : state.defaultEntry
      }));
    } catch (e) {
      console.warn('Failed to load state from localStorage', e);
    }
  }
}));
