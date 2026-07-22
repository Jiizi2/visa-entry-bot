import { useEffect, useState } from 'react';
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
import EntryTable from './entry/EntryTable';
import SimplifiedConsole from './entry/SimplifiedConsole';
import AppIcon from '../components/ui/AppIcon';

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

  const appendLog = (message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const line = `[${time}] [${level.toUpperCase()}] ${message}`;
    updateState({ entryLogs: [...state.entryLogs, line].slice(-120) });
  };

  useEffect(() => {
    const reviewable = manifestMembers.filter((member: any) => memberReviewStatus(member) !== 'ERROR');
    const reviewed = reviewable.filter((member: any) => member.reviewConfirmed || state.reviewedMemberIds.has(member.id)).length;
    const review = { total: reviewable.length, reviewed, remaining: Math.max(reviewable.length - reviewed, 0) };
    const selectedIds = effectiveSelectedIdsForExport(state.manifest, state.selectedIds);
    const canExportReviewedJson = state.manifestPath && reviewable.length > 0 && review.remaining === 0 && !state.isScanning;

    setExportPreview(buildExportPreviewState({
      members: manifestMembers,
      selectedIds,
      review,
      reviewedMemberIds: state.reviewedMemberIds,
      canExportReviewedJson,
      isEntryRunning: state.isEntryRunning,
    }));
  }, [manifestMembers, state.selectedIds, state.reviewedMemberIds, state.isEntryRunning, state.manifestPath, state.isScanning]);

  const handlePrepareEntry = async () => {
    if (state.isEntryRunning) return;

    appendLog('Tombol Export JSON diklik.', 'info');
    updateState({ exportError: '' });

    if (!state.manifestPath || !state.manifest) {
      appendLog('Gagal export: manifest belum tersedia.', 'error');
      showNotification('Gagal export: manifest belum tersedia.', 'error');
      return;
    }

    if (exportPreview?.review?.remaining > 0) {
      appendLog(`Gagal export: review belum selesai (${exportPreview.review.remaining} data belum siap).`, 'warn');
      showNotification(`Gagal export: review belum selesai (${exportPreview.review.remaining} data belum siap).`, 'error');
      return;
    }

    const companionValidation = validateCompanionsForExport(state.manifest, state.selectedIds);
    if (!companionValidation.ok) {
      updateState({ exportError: companionValidation.message });
      appendLog(`Gagal export: ${companionValidation.message}`, 'warn');
      showNotification(companionValidation.message, 'error');
      return;
    }

    if (!exportPreview?.canExport) {
      const message = 'Tidak ada passport yang siap dimasukkan ke batch Nusuk.';
      updateState({ exportError: message });
      appendLog('Gagal export: Tidak ada data export', 'warn');
      showNotification(message, 'error');
      return;
    }

    updateState({ isEntryRunning: true, statusHeadline: 'Membuat JSON' });
    appendLog('Membuat batch data Nusuk untuk extension...');

    try {
      const manifestToSave = JSON.parse(JSON.stringify(state.manifest));
      if (Array.isArray(manifestToSave.members)) {
        manifestToSave.members.forEach((member: any) => {
          if (state.reviewedMemberIds.has(member.id)) {
            member.reviewConfirmed = true;
            if (member.reviewStatus === 'NEEDS_REVIEW') member.reviewStatus = 'VALID';
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

      updateState({ manifest: manifestToSave, exportedBatchPath: batchPath, statusHeadline: 'JSON dibuat' });
      appendLog(`JSON untuk extension dibuat: ${batchPath}`, 'success');
      appendLog('Klik Buka Folder JSON untuk langsung melihat file.', 'info');
      showNotification('JSON berhasil dibuat!', 'success');
    } catch (error) {
      const message = String(error);
      updateState({ exportError: message, statusHeadline: 'Export JSON gagal' });
      appendLog(`Export JSON gagal: ${message}`, 'error');
      showNotification(`Export JSON gagal: ${message}`, 'error');
    } finally {
      updateState({ isEntryRunning: false });
    }
  };

  const handleOpenJsonLocation = async () => {
    if (!state.exportedBatchPath) return;
    try {
      await invoke('open_path_location', { path: state.exportedBatchPath });
      appendLog(`Folder JSON dibuka: ${state.exportedBatchPath}`, 'success');
    } catch (error) {
      appendLog(`Gagal membuka folder JSON: ${String(error)}`, 'error');
    }
  };

  if (!exportPreview) return null;

  const reviewRemaining = exportPreview.review.remaining;
  const readyCount = exportPreview.readyMembers.length;
  const excludedCount = exportPreview.failedMembers.length + exportPreview.skippedMembers.length;
  const batchReady = reviewRemaining === 0 && readyCount > 0;
  const hasMembers = manifestMembers.length > 0;
  const exportStatusTitle = !hasMembers
    ? 'Belum ada passport untuk diekspor'
    : reviewRemaining > 0
      ? `${reviewRemaining} passport masih perlu diperiksa`
      : readyCount > 0
        ? `${readyCount} passport siap ${state.legacyMode ? 'disimpan' : 'dikirim'}`
        : 'Belum ada passport yang dapat diekspor';
  const exportStatusDescription = !hasMembers
    ? 'Pilih folder berisi hasil scan untuk memulai.'
    : reviewRemaining > 0
      ? 'Selesaikan Review agar data dapat dikirim ke Nusuk.'
      : readyCount > 0
        ? state.legacyMode
          ? 'File JSON akan disimpan di folder hasil scan.'
          : 'Data siap dikirim melalui extension EntryMate.'
        : 'Periksa kembali data yang bermasalah atau tidak dipilih.';
  const exportStatusTone = batchReady ? 'is-ready' : reviewRemaining > 0 ? 'is-warning' : 'is-empty';
  const automationMembers = manifestMembers
    .filter((member: any) => effectiveSelectedIds.has(member.id) && (member.reviewConfirmed || state.reviewedMemberIds.has(member.id)))
    .map((member: any) => {
      const copy = JSON.parse(JSON.stringify(member));
      copy.reviewConfirmed = true;
      if (copy.reviewStatus === 'NEEDS_REVIEW') copy.reviewStatus = 'VALID';
      return enrichMemberForEntry(copy, manifestMembers);
    });

  return (
    <section className="page-container entry-page">
      <div className="entry-scroll-region">
        <header className="app-page-header">
          <div className="app-page-header-left">
            <div className="app-page-header-icon"><AppIcon name="export" size={20} /></div>
            <div className="app-page-header-info">
              <h1 className="app-page-title">Export ke Nusuk</h1>
            </div>
          </div>
          <button className="secondary-button" onClick={() => updateState({ currentPage: 'validation' })}>
            <AppIcon name="arrow_back" size={15} />
            Kembali ke Review
          </button>
        </header>

        <section className="entry-export-workspace workstation-pane" aria-labelledby="entry-export-mode-title">
          <header className="entry-export-workspace__header">
            <div className="entry-export-workspace__heading">
              <span><AppIcon name={state.legacyMode ? 'file' : 'rocket'} size={20} /></span>
              <div>
                <h2 id="entry-export-mode-title">{state.legacyMode ? 'Simpan file untuk Nusuk' : 'Kirim langsung ke Nusuk'}</h2>
                <p>{state.legacyMode ? 'Buat file JSON dari data yang sudah direview.' : 'Isi data melalui extension EntryMate di Chrome.'}</p>
              </div>
            </div>
            <div className="entry-mode-switch" role="group" aria-label="Cara mengirim data">
              <button type="button" aria-pressed={!state.legacyMode} onClick={() => updateState({ legacyMode: false })}>
                <AppIcon name="rocket" size={15} />
                Extension
              </button>
              <button type="button" aria-pressed={state.legacyMode} onClick={() => updateState({ legacyMode: true })}>
                <AppIcon name="file" size={15} />
                File JSON
              </button>
            </div>
          </header>

          {!state.legacyMode ? (
            <SimplifiedConsole
              manifestPath={state.manifestPath}
              members={automationMembers}
              batchReady={batchReady}
              readinessTitle={exportStatusTitle}
              readinessDescription={exportStatusDescription}
              readinessActionLabel={hasMembers ? 'Periksa di Review' : 'Pilih folder'}
              readinessActionIcon={hasMembers ? 'review' : 'folder_open'}
              onResolveReadiness={() => updateState({ currentPage: hasMembers ? 'validation' : 'import' })}
              onOpenNusuk={() => openUrl('https://masar.nusuk.sa')}
            />
          ) : (
            <div className="entry-manual-card">
              <div className="entry-manual-card__body">
                <div className={`entry-manual-status ${exportStatusTone}`}>
                  <span className="entry-manual-status__icon">
                    <AppIcon name={batchReady ? 'check_circle' : reviewRemaining > 0 ? 'review' : 'folder_open'} size={26} />
                  </span>
                  <div>
                    <h3>{exportStatusTitle}</h3>
                    <p>{exportStatusDescription}</p>
                  </div>
                </div>

                {hasMembers && (
                  <div className="entry-manual-metrics" aria-label="Ringkasan kesiapan export">
                    <div><strong>{readyCount}</strong><span>siap</span></div>
                    {reviewRemaining > 0 && <div><strong>{reviewRemaining}</strong><span>perlu review</span></div>}
                    {excludedCount > 0 && <div><strong>{excludedCount}</strong><span>tidak ikut</span></div>}
                  </div>
                )}
              </div>

              {(state.exportError || state.exportedBatchPath) && (
                <div className={`entry-result-banner ${state.exportError ? 'is-error' : 'is-success'}`} role={state.exportError ? 'alert' : 'status'}>
                  {state.exportError ? <span>{state.exportError}</span> : (
                    <div>
                      <span>File JSON berhasil dibuat.</span>
                      <button className="secondary-button" onClick={handleOpenJsonLocation}>Buka folder</button>
                    </div>
                  )}
                </div>
              )}

              <footer className="entry-manual-card__actions">
                {excludedCount > 0 && (
                  <span className="entry-manual-card__note"><AppIcon name="info" size={15} /> {excludedCount} passport tidak disertakan.</span>
                )}
                <div className="entry-manual-card__buttons">
                  {!hasMembers ? (
                    <button className="secondary-button" onClick={() => updateState({ currentPage: 'import' })}>
                      <AppIcon name="folder_open" size={16} />
                      Pilih folder
                    </button>
                  ) : !batchReady ? (
                    <button className="secondary-button" onClick={() => updateState({ currentPage: 'validation' })}>
                      <AppIcon name="review" size={16} />
                      Periksa di Review
                    </button>
                  ) : (
                    <button className="primary-action" onClick={handlePrepareEntry} disabled={!exportPreview.canExport || state.isEntryRunning}>
                      <AppIcon name="download" size={16} />
                      {state.isEntryRunning ? 'Membuat file...' : 'Buat file JSON'}
                    </button>
                  )}
                </div>
              </footer>
            </div>
          )}
        </section>

        {hasMembers && (
          <div className="entry-batch-region">
            <div className="entry-batch-region__header">
              <h2>Passport yang akan diproses</h2>
              <span className="status-chip neutral">{manifestMembers.length} passport</span>
            </div>
            <EntryTable exportPreview={exportPreview} reviewedMemberIds={state.reviewedMemberIds} />
          </div>
        )}
      </div>

      {toast && (
        <div className={`app-toast ${toast.type === 'error' ? 'is-error' : 'is-success'}`} role={toast.type === 'error' ? 'alert' : 'status'} aria-live={toast.type === 'error' ? 'assertive' : 'polite'}>
          <AppIcon name={toast.type === 'error' ? 'alert' : 'check_circle'} size={18} />
          <span>{toast.message}</span>
        </div>
      )}
    </section>
  );
}
