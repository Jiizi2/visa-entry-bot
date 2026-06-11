import React, { createContext, useContext, useState, ReactNode } from 'react';

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
}

const initialState: AppState = {
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

interface AppContextType {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  updateState: (updates: Partial<AppState>) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);

  React.useEffect(() => {
    try {
      const savedRecent = localStorage.getItem('recentBatches');
      if (savedRecent) {
        setState(prev => ({ ...prev, recentBatches: JSON.parse(savedRecent) }));
      }
      const savedDefaultEntry = localStorage.getItem('defaultEntry');
      if (savedDefaultEntry) {
        setState(prev => ({ ...prev, defaultEntry: JSON.parse(savedDefaultEntry) }));
      }
    } catch (e) {
      console.warn('Gagal meload state dari localStorage', e);
    }
  }, []);

  const updateState = (updates: Partial<AppState>) => {
    setState((prev) => {
      const next = { ...prev, ...updates };
      // Simpan ke localStorage jika field tertentu berubah
      if (updates.recentBatches) {
        localStorage.setItem('recentBatches', JSON.stringify(next.recentBatches));
      }
      if (updates.defaultEntry) {
        localStorage.setItem('defaultEntry', JSON.stringify(next.defaultEntry));
      }
      return next;
    });
  };

  return (
    <AppContext.Provider value={{ state, setState, updateState }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
