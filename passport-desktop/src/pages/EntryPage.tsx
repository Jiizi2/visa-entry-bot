import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useStore } from '../store';
import {
  buildExportPreviewState,
  effectiveSelectedIdsForExport,
  validateCompanionsForExport,
  buildManifestForEntryExport,
  enrichMemberForEntry,
} from '../utils/export';
import { memberReviewStatus } from '../utils/members';
import EntrySummaryCards from './entry/EntrySummaryCards';
import EntryTable from './entry/EntryTable';
import SimplifiedConsole from './entry/SimplifiedConsole';

export default function EntryPage() {
  const state = useStore();
  const updateState = useStore(s => s.updateState);
  const [exportPreview, setExportPreview] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const manifestMembers = state.manifest?.members || [];
  const effectiveSelectedIds = effectiveSelectedIdsForExport(state.manifest, state.selectedIds);

  const appendLog = (msg: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const tag = level.toUpperCase();
    const line = `[${time}] [${tag}] ${msg}`;
    updateState({ entryLogs: [...state.entryLogs, line].slice(-120) });
  };

  useEffect(() => {
    const reviewable = manifestMembers.filter((m: any) => memberReviewStatus(m) !== 'ERROR');
    const reviewed = reviewable.filter((m: any) => m.reviewConfirmed || state.reviewedMemberIds.has(m.id)).length;
    const review = { total: reviewable.length, reviewed, remaining: Math.max(reviewable.length - reviewed, 0) };

    const selectedIds = effectiveSelectedIdsForExport(state.manifest, state.selectedIds);
    const canExportReviewedJson = state.manifestPath && reviewable.length > 0 && review.remaining === 0 && !state.isScanning;

    const preview = buildExportPreviewState({
      members: manifestMembers,
      selectedIds,
      review,
      reviewedMemberIds: state.reviewedMemberIds,
      canExportReviewedJson,
      isEntryRunning: state.isEntryRunning,
    });
    setExportPreview(preview);
  }, [manifestMembers, state.selectedIds, state.reviewedMemberIds, state.isEntryRunning, state.manifestPath, state.isScanning]);

  const handlePrepareEntry = async () => {
    if (state.isEntryRunning) return;

    appendLog("Tombol Export JSON diklik.", "info");
    updateState({ exportError: '' });

    if (!state.manifestPath || !state.manifest) {
      appendLog("Gagal export: manifest belum tersedia.", "error");
      showNotification("Gagal export: manifest belum tersedia.", "error");
      return;
    }

    if (exportPreview?.review?.remaining > 0) {
      appendLog(`Gagal export: review belum selesai (${exportPreview.review.remaining} data belum siap).`, "warn");
      showNotification(`Gagal export: review belum selesai (${exportPreview.review.remaining} data belum siap).`, "error");
      return;
    }

    const companionVal = validateCompanionsForExport(state.manifest, state.selectedIds);
    if (!companionVal.ok) {
      updateState({ exportError: companionVal.message });
      appendLog(`Gagal export: ${companionVal.message}`, "warn");
      showNotification(companionVal.message, "error");
      return;
    }

    if (!exportPreview?.canExport) {
      updateState({ exportError: "Tidak ada passport yang siap dimasukkan ke batch Nusuk." });
      appendLog("Gagal export: Tidak ada data export", "warn");
      showNotification("Tidak ada passport yang siap dimasukkan ke batch Nusuk.", "error");
      return;
    }

    updateState({ isEntryRunning: true, statusHeadline: "Membuat JSON" });
    appendLog("Membuat batch data Nusuk untuk extension...");

    try {
      const manifestToSave = JSON.parse(JSON.stringify(state.manifest));
      if (Array.isArray(manifestToSave.members)) {
        manifestToSave.members.forEach((m: any) => {
          if (state.reviewedMemberIds.has(m.id)) {
            m.reviewConfirmed = true;
            if (m.reviewStatus === 'NEEDS_REVIEW') {
              m.reviewStatus = 'VALID';
            }
          }
        });
      }

      await invoke('save_manifest', { manifestPath: state.manifestPath, manifestData: manifestToSave });

      const { manifest: exportManifest, selectedIds } = buildManifestForEntryExport(manifestToSave, state.selectedIds);

      const batchPath: string = await invoke('create_nusuk_batch', {
        manifestPath: state.manifestPath,
        selectedIds: Array.from(selectedIds),
        manifestData: exportManifest,
      });

      updateState({
        manifest: manifestToSave,
        exportedBatchPath: batchPath,
        statusHeadline: "JSON dibuat"
      });
      appendLog(`JSON untuk extension dibuat: ${batchPath}`, "success");
      appendLog("Klik Buka Folder JSON untuk langsung melihat file.", "info");
      showNotification("JSON berhasil dibuat!", "success");
    } catch (e: any) {
      const err = String(e);
      updateState({ exportError: err, statusHeadline: "Export JSON gagal" });
      appendLog(`Export JSON gagal: ${err}`, "error");
      showNotification(`Export JSON gagal: ${err}`, "error");
    } finally {
      updateState({ isEntryRunning: false });
    }
  };

  const handleOpenJsonLocation = async () => {
    if (!state.exportedBatchPath) return;
    try {
      await invoke('open_path_location', { path: state.exportedBatchPath });
      appendLog(`Folder JSON dibuka: ${state.exportedBatchPath}`, "success");
    } catch (e) {
      appendLog(`Gagal membuka folder JSON: ${String(e)}`, "error");
    }
  };

  if (!exportPreview) return null;

  return (
    <section className="page-container">
      <div className="flex-1 overflow-y-auto max-w-[1200px] w-full mx-auto p-0">
        <header className="app-page-header">
          <div className="app-page-header-left">
            <div className="app-page-header-icon">
              <span className="material-symbols-outlined">upload_file</span>
            </div>
            <div className="app-page-header-info">
              <span className="app-page-step-label">LANGKAH 5: OTOMATISASI ENTRY</span>
              <h1 className="app-page-title">Otomatisasi Entry Nusuk</h1>
              <p className="app-page-subtitle">Jalankan otomatisasi pengisian mutamer ke Nusuk via ekstensi Chrome.</p>
            </div>
          </div>
          <div className="flex gap-2.5 items-center">
            {/* Legacy Mode Toggle Switch */}
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500 bg-slate-100 hover:bg-slate-200/80 px-3 h-10 rounded-lg cursor-pointer select-none transition-colors border border-slate-200">
              <input 
                type="checkbox" 
                checked={state.legacyMode}
                onChange={(e) => updateState({ legacyMode: e.target.checked })}
                className="w-3 h-3 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span>Legacy Mode (JSON Manual)</span>
            </label>

            <button className="secondary-button" onClick={() => updateState({ currentPage: 'validation' })}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              Back to Review
            </button>

            {state.legacyMode && (
              <button className="primary-action" onClick={handlePrepareEntry} disabled={!exportPreview.canExport || state.isEntryRunning}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                {state.isEntryRunning ? 'Membuat JSON...' : 'Export to JSON'}
              </button>
            )}
          </div>
        </header>

        {/* Console Otomatisasi (Full Width) */}
        <div className="mb-6">
          <SimplifiedConsole 
            manifestPath={state.manifestPath}
            members={manifestMembers
              .filter((m: any) => 
                effectiveSelectedIds.has(m.id) && 
                (m.reviewConfirmed || state.reviewedMemberIds.has(m.id))
              )
              .map((m: any) => {
                const copy = JSON.parse(JSON.stringify(m));
                copy.reviewConfirmed = true;
                if (copy.reviewStatus === 'NEEDS_REVIEW') {
                  copy.reviewStatus = 'VALID';
                }
                return enrichMemberForEntry(copy, manifestMembers);
              })
            } 
          />
        </div>

        {/* Langkah Otomatisasi (Full Width Card with Buka Halaman Nusuk Button) */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 mb-6 shadow-[0_8px_30px_rgba(0,0,0,0.04)] flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="flex-1 col-span-2">
            <h3 className="text-[14px] font-bold text-slate-800 m-0 mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-blue-600">help_outline</span>
              Langkah Otomatisasi
            </h3>
            <ol className="m-0 pl-4 text-[13px] leading-relaxed space-y-2 text-slate-600">
              <li>Pastikan data paspor di bawah berstatus <strong>VALID</strong>.</li>
              <li>Buka panel samping ekstensi <strong>EntryMate</strong> di browser Chrome halaman Nusuk.</li>
              <li>Tunggu hingga indikator koneksi di sebelah kiri menyala <strong className="text-emerald-600">Terhubung</strong>.</li>
              <li>Klik <strong>Load Batch</strong> untuk mengirim data mutamer ke browser.</li>
              <li>Klik <strong>Start</strong> untuk memulai otomatisasi pengisian form.</li>
            </ol>
          </div>
          <div className="shrink-0 w-full md:w-auto">
            <button 
              className="primary-action !bg-emerald-600 hover:!bg-emerald-700 w-full md:w-auto"
              onClick={() => openUrl('https://masar.nusuk.sa')}
            >
              <span className="material-symbols-outlined text-[18px]">open_in_new</span>
              Buka Halaman Nusuk
            </button>
          </div>
        </div>

        {/* Summary Cards (Full Width: 4 columns in a row) */}
        <div className="mb-8">
          <EntrySummaryCards exportPreview={exportPreview} />
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[16px] font-bold text-slate-800 m-0">Daftar Mutamer dalam Batch</h2>
            <span className="text-[12px] text-slate-500 font-medium">{manifestMembers.length} Mutamer total</span>
          </div>
          <EntryTable 
            exportPreview={exportPreview} 
            reviewedMemberIds={state.reviewedMemberIds} 
          />
        </div>

        {(state.exportError || state.exportedBatchPath) && (
          <div className={`p-4 rounded-lg text-[14px] font-medium mb-6 sticky bottom-6 z-[100] shadow-[0_4px_12px_rgba(0,0,0,0.1)] ${state.exportError ? 'bg-red-100 text-red-800 border border-red-300' : 'bg-green-100 text-green-800 border border-green-300'}`}>
            {state.exportError || (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>JSON dibuat: {state.exportedBatchPath}</span>
                <button className="secondary-button" onClick={handleOpenJsonLocation}>
                  Buka Folder JSON
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          backgroundColor: toast?.type === 'error' ? '#ef4444' : '#10b981',
          color: 'white',
          padding: '12px 24px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          zIndex: 1000,
          animation: 'slideUp 0.3s ease-out'
        }}>
          <span className="material-symbols-outlined text-[24px]">
            {toast?.type === 'error' ? 'error' : 'check_circle'}
          </span>
          <span style={{ fontWeight: 500 }}>{toast?.message}</span>
        </div>
      )}
    </section>
  );
}
