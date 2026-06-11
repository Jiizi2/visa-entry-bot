import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppContext } from '../AppContext';
import {
  buildExportPreviewState,
  effectiveSelectedIdsForExport,
  validateCompanionsForExport,
  buildManifestForEntryExport,
  isMemberReadyForJson,
  passportCropApplied,
} from '../utils/export';
import { memberDisplayName, memberPassport, memberReviewStatus, resolvedProfileOf } from '../utils/members';
import './entry-page.css';

export default function EntryPage() {
  const { state, updateState } = useAppContext();
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
      // Ensure the manifest has reviewConfirmed correctly set before saving
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
    <section className="entry-page-modern">


      <div className="entry-main-content">
        <header className="entry-header-modern">
          <div className="entry-header-title-area">
            <div className="entry-header-icon">
              <span className="material-symbols-outlined">upload_file</span>
            </div>
            <div>
              <span className="step-eyebrow">LANGKAH 5: BATCH NUSUK</span>
              <h1 className="entry-title">Batch Export</h1>
              <p className="entry-subtitle">Review final counts before generating JSON payload.</p>
            </div>
          </div>
          <div className="entry-header-buttons">
            <button className="btn-outline" onClick={() => updateState({ currentPage: 'validation' })}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              Back to Review
            </button>
            <button className="btn-primary" onClick={handlePrepareEntry} disabled={!exportPreview.canExport || state.isEntryRunning}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              {state.isEntryRunning ? 'Membuat JSON...' : 'Export to JSON'}
            </button>
          </div>
        </header>

        <div className="entry-summary-cards">
          <div className="summary-card">
            <span className="summary-title">TOTAL DOCUMENTS</span>
            <span className="summary-value">{exportPreview.members.length}</span>
          </div>
          <div className="summary-card">
            <span className="summary-title">REVIEWED</span>
            <span className="summary-value">{exportPreview.reviewedMembers.length}</span>
          </div>
          <div className="summary-card">
            <span className="summary-title">IN BATCH</span>
            <span className="summary-value">{exportPreview.readyMembers.length}</span>
          </div>
          <div className="summary-card">
            <span className="summary-title">SKIPPED</span>
            <span className="summary-value">{exportPreview.failedMembers.length + exportPreview.skippedMembers.length}</span>
          </div>
        </div>

        <div className="entry-table-container">
          <table className="entry-table">
            <thead>
              <tr>
                <th>APPLICANT DETAILS</th>
                <th>EXTRACTED METADATA</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {exportPreview.members.length === 0 ? (
                <tr><td colSpan={3} className="empty-state">Belum ada data untuk dipreview.</td></tr>
              ) : (
                exportPreview.members.map((member: any) => {
                  const profile = resolvedProfileOf(member);
                  const isReviewed = member.reviewConfirmed || state.reviewedMemberIds.has(member.id);
                  const status = memberReviewStatus(member);

                  return (
                    <tr key={member.id}>
                      <td>
                        <div className="applicant-name">{memberDisplayName(member)}</div>
                        <div className="applicant-passport">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                          {memberPassport(member) || '-'}
                        </div>
                      </td>
                      <td>
                        <div className="metadata-grid">
                          <span className="meta-label">DOB</span><span className="meta-val">{profile.dob || '-'}</span>
                          <span className="meta-label">Nat</span><span className="meta-val">{profile.nationality || '-'}</span>
                          <span className="meta-label">Gender</span><span className="meta-val">{profile.gender || '-'}</span>
                        </div>
                      </td>
                      <td>
                        <div className={`status-pill ${isReviewed ? 'reviewed' : status === 'ERROR' ? 'error' : 'pending'}`}>
                          {isReviewed && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                          {isReviewed ? 'Reviewed' : status === 'ERROR' ? 'Error' : 'Pending'}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="entry-footer-info">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          Only reviewed documents will be included in the final JSON payload. Skipped or errored items remain unexported.
        </div>

        {(state.exportError || state.exportedBatchPath) && (
          <div className={`export-result-banner ${state.exportError ? 'error' : 'success'}`}>
            {state.exportError || (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>JSON dibuat: {state.exportedBatchPath}</span>
                <button className="btn-outline" onClick={handleOpenJsonLocation} style={{ backgroundColor: 'white', padding: '6px 12px', fontSize: '12px' }}>
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
          backgroundColor: toast.type === 'error' ? '#ef4444' : '#10b981',
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
          <span className="material-symbols-outlined">
            {toast.type === 'error' ? 'error' : 'check_circle'}
          </span>
          <span style={{ fontWeight: 500 }}>{toast.message}</span>
        </div>
      )}
    </section>
  );
}
