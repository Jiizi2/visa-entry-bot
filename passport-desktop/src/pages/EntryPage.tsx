import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import {
  buildExportPreviewState,
  effectiveSelectedIdsForExport,
  validateCompanionsForExport,
  buildManifestForEntryExport,
} from '../utils/export';
import { memberReviewStatus } from '../utils/members';
import EntrySummaryCards from './entry/EntrySummaryCards';
import EntryTable from './entry/EntryTable';

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
    <section className="flex flex-col h-screen bg-slate-50 font-['Inter',sans-serif] text-slate-900">
      <div className="p-8 flex-1 overflow-y-auto">
        <header className="flex justify-between items-center mb-6 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-300/40 shadow-[0_8px_30px_rgba(0,0,0,0.04)] p-5 px-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-700 to-blue-500 rounded-xl flex items-center justify-center text-white shadow-[0_4px_12px_rgba(0,74,198,0.2)]">
              <span className="material-symbols-outlined text-[24px]">upload_file</span>
            </div>
            <div>
              <span className="block text-[11px] font-bold text-blue-700 tracking-[0.1em] mb-1 uppercase">LANGKAH 5: BATCH NUSUK</span>
              <h1 className="font-['Inter',sans-serif] text-[24px] font-bold text-slate-900 m-0 tracking-[-0.01em]">Batch Export</h1>
              <p className="m-0 mt-1 text-slate-500 text-[14px]">Review final counts before generating JSON payload.</p>
            </div>
          </div>
          <div className="flex gap-4">
            <button className="flex items-center gap-2 bg-white border border-slate-300 text-slate-600 px-5 py-2.5 rounded-lg text-[14px] font-semibold cursor-pointer transition-all hover:bg-slate-50 hover:border-slate-400" onClick={() => updateState({ currentPage: 'validation' })}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              Back to Review
            </button>
            <button className="flex items-center gap-2 bg-blue-700 border-none text-white px-6 py-2.5 rounded-lg text-[14px] font-semibold cursor-pointer transition-all shadow-sm hover:bg-blue-800 hover:-translate-y-[1px] hover:shadow-md disabled:bg-blue-300 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-0" onClick={handlePrepareEntry} disabled={!exportPreview.canExport || state.isEntryRunning}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              {state.isEntryRunning ? 'Membuat JSON...' : 'Export to JSON'}
            </button>
          </div>
        </header>

        <EntrySummaryCards exportPreview={exportPreview} />

        <EntryTable 
          exportPreview={exportPreview} 
          reviewedMemberIds={state.reviewedMemberIds} 
        />

        <div className="flex items-center gap-2.5 text-slate-500 text-[13px] mb-6">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          Only reviewed documents will be included in the final JSON payload. Skipped or errored items remain unexported.
        </div>

        {(state.exportError || state.exportedBatchPath) && (
          <div className={`p-4 rounded-lg text-[14px] font-medium mb-6 sticky bottom-6 z-[100] shadow-[0_4px_12px_rgba(0,0,0,0.1)] ${state.exportError ? 'bg-red-100 text-red-800 border border-red-300' : 'bg-green-100 text-green-800 border border-green-300'}`}>
            {state.exportError || (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>JSON dibuat: {state.exportedBatchPath}</span>
                <button className="flex items-center gap-2 bg-white border border-slate-300 text-slate-600 px-3 py-1.5 rounded text-[12px] font-semibold cursor-pointer transition-all hover:bg-slate-50" onClick={handleOpenJsonLocation}>
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
