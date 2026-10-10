import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import Button from '../components/ui/Button';
import PageHeader from '../components/ui/PageHeader';
import AppIcon from '../components/ui/AppIcon';
import { useStore } from '../store';
import { buildExportPreviewState, effectiveSelectedIdsForExport } from '../utils/export';
import { createEntryBatchExporter, prepareEntryBatch } from '../utils/entry-batch';
import { memberReviewStatus } from '../utils/members';
import EntryTable from './entry/EntryTable';

const exportBatch = createEntryBatchExporter(invoke);

export default function EntryPage() {
  const state = useStore();
  const updateState = useStore(s => s.updateState);
  const prepared = useMemo(() => prepareEntryBatch(state), [state.manifest, state.manifestPath, state.selectedIds, state.reviewedMemberIds, state.isScanning]);
  const request = prepared.request;
  const currentRequest = useRef(request);
  currentRequest.current = request;
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState({ signature: '', path: '', error: '', pending: false });
  const [dragging, setDragging] = useState(false);
  const [actionError, setActionError] = useState('');
  const signature = request?.signature || '';
  const fileReady = Boolean(signature && result.signature === signature && result.path && !result.pending);
  const manifestMembers = state.manifest?.members || [];
  const folderName = state.manifestPath.replace(/\\/g, '/').split('/').slice(-2, -1)[0] || 'Batch passport';
  const error = prepared.error || (result.signature === signature ? result.error : '') || actionError;
  const preview = useMemo(() => {
    const members = request?.manifestToSave.members || manifestMembers;
    const reviewable = members.filter((member: any) => memberReviewStatus(member) !== 'ERROR');
    const reviewed = reviewable.filter((member: any) => member.reviewConfirmed || state.reviewedMemberIds.has(member.id)).length;
    return buildExportPreviewState({ members, selectedIds: effectiveSelectedIdsForExport(state.manifest, state.selectedIds), review: { total: reviewable.length, reviewed, remaining: reviewable.length - reviewed }, reviewedMemberIds: state.reviewedMemberIds, canExportReviewedJson: Boolean(request), isEntryRunning: false });
  }, [request, state.manifest, state.selectedIds, state.reviewedMemberIds]);

  useEffect(() => {
    let active = true;
    setActionError('');
    updateState({ exportedBatchPath: '', exportError: '', isEntryRunning: Boolean(currentRequest.current) });
    const snapshot = currentRequest.current;
    if (!snapshot) {
      setResult({ signature: '', path: '', error: '', pending: false });
      return;
    }
    setResult({ signature, path: '', error: '', pending: true });
    updateState({ statusHeadline: 'Menyiapkan file JSON' });
    void exportBatch(snapshot).then(path => {
      if (!active || currentRequest.current?.signature !== snapshot.signature) return;
      setResult({ signature, path, error: '', pending: false });
      updateState({ exportedBatchPath: path, isEntryRunning: false, statusHeadline: 'File JSON siap diseret' });
    }).catch(failure => {
      if (!active || currentRequest.current?.signature !== snapshot.signature) return;
      const message = `File JSON belum dapat dibuat: ${String(failure)}`;
      setResult({ signature, path: '', error: message, pending: false });
      updateState({ exportedBatchPath: '', exportError: message, isEntryRunning: false, statusHeadline: 'Pembuatan JSON gagal' });
    });
    return () => { active = false; updateState({ isEntryRunning: false }); };
  }, [signature, retry, updateState]);

  const startDrag = async () => {
    if (!fileReady || dragging || currentRequest.current?.signature !== result.signature) return;
    setDragging(true);
    setActionError('');
    try {
      await invoke('drag_nusuk_batch', { batchPath: result.path });
    } catch (failure) {
      setActionError(`File belum dapat diseret. Pilih Buka folder file untuk menyeretnya dari Explorer. ${String(failure)}`);
    } finally {
      setDragging(false);
    }
  };
  const openFolder = async () => {
    if (!fileReady) return;
    try { await invoke('open_path_location', { path: result.path }); }
    catch (failure) { setActionError(`Folder belum dapat dibuka: ${String(failure)}`); }
  };

  return (
    <section className="page-container entry-page">
      <div className="entry-scroll-region">
        <PageHeader title="Entry ke Nusuk" actions={<Button variant="secondary" className="secondary-button" onClick={() => updateState({ currentPage: 'validation' })}><AppIcon name="arrow_back" size={16} />Kembali ke Review</Button>} />
        <section className="entry-export-workspace workstation-pane" aria-labelledby="entry-file-title">
          <header className="entry-export-workspace__header">
            <div className="entry-export-workspace__heading"><AppIcon name="export" size={20} /><div><h2 id="entry-file-title">Seret file ke extension</h2><p>JSON dibuat otomatis dari passport yang sudah selesai direview.</p></div></div>
          </header>
          <div className="entry-file-handoff">
            <button type="button" className={`entry-file-source ${fileReady ? 'is-ready' : ''}`} disabled={!fileReady || dragging}
              aria-label={fileReady ? 'Seret nusuk-entry-batch.json ke extension EntryMate' : 'File JSON belum siap'}
              aria-describedby="entry-file-instruction" onMouseDown={event => { if (event.button === 0) { event.preventDefault(); void startDrag(); } }}
              onDragStart={event => event.preventDefault()} onClick={event => { if (event.detail === 0) void openFolder(); }}>
              <AppIcon name={fileReady ? 'file' : prepared.error ? 'review' : 'hourglass'} size={32} />
              <strong>{fileReady ? 'nusuk-entry-batch.json' : error ? 'File belum siap' : 'Menyiapkan file JSON…'}</strong>
              <span>{fileReady ? `${request?.memberCount} jamaah · ${folderName}` : error ? 'Periksa pesan di bawah untuk melanjutkan.' : 'Tunggu sebentar, file sedang dibuat.'}</span>
              {fileReady && <span className="entry-file-source__handle"><AppIcon name="send" size={16} />Tahan dan seret ke extension</span>}
            </button>
            <div className="entry-file-guide">
              <h3>Siap dipindahkan ke Nusuk</h3>
              <ol id="entry-file-instruction"><li>Buka Nusuk dan panel extension EntryMate.</li><li>Seret file di sebelah kiri ke area “Letakkan file JSON di sini”.</li><li>Periksa batch, lalu pilih “Mulai pengisian” di extension.</li></ol>
              <p>Biarkan folder hasil scan tetap di lokasi yang sama selama pengisian.</p>
              <div className="entry-file-actions"><Button variant="primary" className="primary-action" onClick={() => openUrl('https://masar.nusuk.sa/', 'chrome').catch(() => setActionError('Chrome belum dapat dibuka. Buka Nusuk di browser Anda.'))}><AppIcon name="external_link" size={16} />Buka Nusuk</Button><Button variant="secondary" className="secondary-button" disabled={!fileReady} onClick={openFolder}><AppIcon name="folder_open" size={16} />Buka folder file</Button></div>
            </div>
          </div>
          <div className={`entry-file-status ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'} aria-live="polite">
            <AppIcon name={error ? 'alert' : fileReady ? 'check_circle' : 'hourglass'} size={18} />
            <span>{error || (fileReady ? 'File siap. Seret ke extension untuk memuat batch ini.' : 'Membuat file dari data review terbaru…')}</span>
            {error && (request ? <Button variant="secondary" compact onClick={() => setRetry(value => value + 1)}>Coba lagi</Button> : <Button variant="secondary" compact onClick={() => updateState({ currentPage: manifestMembers.length ? 'validation' : 'import' })}>{manifestMembers.length ? 'Periksa di Review' : 'Pilih folder'}</Button>)}
          </div>
        </section>
        {manifestMembers.length > 0 && <div className="entry-batch-region"><div className="entry-batch-region__header"><h2>Passport dalam batch ini</h2><span className="status-chip neutral">{preview.readyMembers.length} siap</span></div><EntryTable exportPreview={preview} reviewedMemberIds={state.reviewedMemberIds} /></div>}
      </div>
    </section>
  );
}
