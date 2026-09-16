import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { formatRecentStamp } from '../utils/helpers';
import AppIcon from '../components/ui/AppIcon';

const defaultFields = [
  { key: 'profesi', id: 'default-profession', label: 'Profesi', hint: 'Pekerjaan untuk seluruh jamaah', icon: 'work', type: 'text' },
  { key: 'statusNikah', id: 'default-marital-status', label: 'Status nikah', hint: 'Status pernikahan default', icon: 'users', type: 'text' },
  { key: 'tipePassport', id: 'default-passport-type', label: 'Tipe passport', hint: 'Jenis passport yang digunakan', icon: 'menu_book', type: 'text' },
  { key: 'email', id: 'default-email', label: 'Email', hint: 'Kontak email rombongan', icon: 'mail', type: 'email', placeholder: 'Contoh: husein@gmail.com' },
  { key: 'nomorTelepon', id: 'default-phone', label: 'Nomor telepon', hint: 'Kontak utama rombongan', icon: 'call', type: 'tel', placeholder: 'Contoh: 62821...' },
] as const;

export default function ImportPage() {
  const state = useStore();
  const updateState = useStore(s => s.updateState);
  const [batchToDelete, setBatchToDelete] = useState<{path: string, name: string} | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!batchToDelete) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    deleteCancelRef.current?.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setBatchToDelete(null);
        return;
      }

      if (event.key !== 'Tab' || !deleteDialogRef.current) return;
      const focusable = Array.from(
        deleteDialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown);
      previouslyFocused?.focus();
    };
  }, [batchToDelete]);

  const resetBatchWorkspace = (selectedDir: string, recentBatches: any[]) => {
    updateState({
      selectedDir,
      recentBatches,
      statusHeadline: 'Folder dipilih',
      statusDetail: `Folder aktif: ${selectedDir}`,
      preparedSession: null,
      manifest: null,
      manifestPath: '',
      exportedBatchPath: '',
      exportError: '',
      reviewedMemberIds: new Set(),
      selectedIds: new Set(),
      activeMemberId: '',
      entryLogs: [],
      scanLogs: [],
    });
  };

  const handleDeleteHistory = () => {
    if (!batchToDelete) return;
    updateState({ recentBatches: state.recentBatches.filter(b => b.path !== batchToDelete.path) });
    setBatchToDelete(null);
  };

  const handleChooseFolder = async () => {
    try {
      updateState({ isChoosingFolder: true });
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Pilih folder passport',
      });

      if (typeof selected === 'string') {
        const folderName = selected.split(/[\\/]/).pop() || selected;
        const newBatch = {
          path: selected,
          name: folderName,
          date: new Date().toISOString(),
          fileCount: '?',
        };
        const recentBatches = [newBatch, ...state.recentBatches.filter(b => b.path !== selected)].slice(0, 10);
        resetBatchWorkspace(selected, recentBatches);
      }
    } catch (error) {
      console.error(error);
      updateState({
        statusHeadline: 'Folder gagal dibuka',
        statusDetail: String(error),
      });
    } finally {
      updateState({ isChoosingFolder: false });
    }
  };

  const handleRecentClick = async (path: string) => {
    resetBatchWorkspace(path, state.recentBatches);

    try {
      const manifestPath = await invoke('find_manifest_path', { basePath: path });
      if (manifestPath) {
        const manifest: any = await invoke('load_manifest', { manifestPath });
        const members = manifest?.members || [];
        updateState({
          manifest,
          manifestPath: manifestPath as string,
          originalManifest: JSON.parse(JSON.stringify(manifest)),
          activeMemberId: members.length > 0 ? members[0].id : '',
          currentPage: 'validation',
        });
      } else {
        alert(`Gagal memuat riwayat:\nFolder atau manifest tidak ditemukan di lokasi:\n${path}\nMungkin folder telah dipindahkan atau dihapus.`);
        updateState({ recentBatches: state.recentBatches.filter((batch: any) => batch.path !== path) });
      }
    } catch (error) {
      console.error('Failed to load manifest for recent path', error);
      alert(`Terjadi kesalahan saat memuat folder:\n${error}`);
      updateState({ recentBatches: state.recentBatches.filter((batch: any) => batch.path !== path) });
    }
  };

  const handleDefaultChange = (field: keyof typeof state.defaultEntry, value: string) => {
    updateState({
      defaultEntry: {
        ...state.defaultEntry,
        [field]: value,
      },
    });
  };

  const selectedFolderName = state.selectedDir.split(/[\\/]/).pop() || state.selectedDir;

  return (
    <section id="page-import" className="page-container import-page">
      <div className="import-command-center">
        <main className="import-main-surface">
          <header className="import-main-header">
            <h1>Mulai batch passport baru</h1>
            <p>Pilih folder berisi dokumen passport, lalu periksa nilai yang akan digunakan untuk rombongan ini.</p>
          </header>

          <button
            type="button"
            className={`import-folder-intake ${state.selectedDir ? 'is-selected' : ''}`}
            onClick={handleChooseFolder}
            disabled={state.isChoosingFolder}
          >
            <span className="import-folder-intake__icon">
              <AppIcon name={state.isChoosingFolder ? 'hourglass' : state.selectedDir ? 'check' : 'folder_open'} size={34} />
            </span>
            <span className="import-folder-intake__copy">
              <strong>
                {state.isChoosingFolder
                  ? 'Membuka pemilih folder…'
                  : state.selectedDir
                    ? selectedFolderName
                    : 'Pilih folder passport'}
              </strong>
              <span>
                {state.selectedDir
                  ? state.selectedDir
                  : 'Buka folder yang berisi file PDF, JPG, JPEG, atau PNG.'}
              </span>
            </span>
            <span className="import-folder-intake__cta">
              {state.selectedDir ? 'Ganti folder' : 'Pilih folder'}
              <AppIcon name="arrow_forward" size={17} />
            </span>
          </button>

          <section className="import-defaults" aria-labelledby="import-defaults-title">
            <div className="import-section-heading">
              <div>
                <h2 id="import-defaults-title">Nilai default rombongan</h2>
                <p>Diterapkan otomatis ke seluruh passport dan tetap dapat dikoreksi saat review.</p>
              </div>
              <span className="import-auto-save-status">
                <AppIcon name="check_circle" size={15} />
                Tersimpan otomatis
              </span>
            </div>

            <div className="import-default-list">
              {defaultFields.map((field, index) => (
                <div className="import-default-row" key={field.key}>
                  <span className="import-default-row__index">{index + 1}</span>
                  <span className="import-default-row__icon" aria-hidden="true">
                    <AppIcon name={field.icon} size={18} />
                  </span>
                  <label htmlFor={field.id}>
                    <strong>{field.label}</strong>
                    <span>{field.hint}</span>
                  </label>
                  <input
                    id={field.id}
                    type={field.type}
                    inputMode={field.type === 'tel' ? 'tel' : undefined}
                    value={state.defaultEntry[field.key]}
                    placeholder={'placeholder' in field ? field.placeholder : undefined}
                    onChange={event => handleDefaultChange(field.key, event.target.value)}
                  />
                </div>
              ))}
            </div>
          </section>

          <footer className="import-main-footer">
            <p>
              <AppIcon name="info" size={16} />
              Detail setiap passport dapat diperiksa dan diedit pada tahap Review.
            </p>
            <button
              className="primary-action import-continue-action"
              type="button"
              onClick={() => updateState({ currentPage: 'prepare' })}
              disabled={!state.selectedDir}
            >
              Lanjut ke Prepare
              <AppIcon name="arrow_forward" size={17} />
            </button>
          </footer>
        </main>

        <aside className="import-utility-rail" aria-label="Opsi dan riwayat import">
          <section className="import-utility-section import-pdf-section" aria-labelledby="import-pdf-title">
            <div className="import-utility-heading">
              <span><AppIcon name="file" size={18} /></span>
              <div>
                <h2 id="import-pdf-title">Opsi input</h2>
                <p>Pengaturan khusus dokumen PDF.</p>
              </div>
            </div>

            <label className="import-pdf-toggle">
              <span className="import-pdf-toggle__copy">
                <strong>Multi-passport PDF</strong>
                <span>Aktifkan jika satu PDF berisi beberapa passport.</span>
              </span>
              <input
                type="checkbox"
                className="sr-only peer"
                checked={state.pdfBatchMode}
                onChange={event => updateState({ pdfBatchMode: event.target.checked })}
              />
              <span className="import-switch" aria-hidden="true">
                <span />
              </span>
            </label>

            <p className="import-pdf-note">
              <AppIcon name="info" size={16} />
              Setiap halaman akan diproses sebagai satu passport secara otomatis.
            </p>
          </section>

          <section className="import-utility-section import-history-section" aria-labelledby="import-history-title">
            <div className="import-utility-heading">
              <span><AppIcon name="schedule" size={18} /></span>
              <div>
                <h2 id="import-history-title">Folder terbaru</h2>
                <p>Buka kembali batch yang pernah diproses.</p>
              </div>
            </div>

            <div className="import-history-list custom-scrollbar">
              {state.recentBatches.length === 0 ? (
                <div className="import-history-empty">
                  <span><AppIcon name="folder" size={24} /></span>
                  <strong>Belum ada riwayat</strong>
                  <p>Folder yang sudah diproses akan muncul di sini.</p>
                </div>
              ) : (
                state.recentBatches.map((batch, index) => (
                  <div className="import-history-row" key={`${batch.path}-${index}`}>
                    <button
                      type="button"
                      className="import-history-row__open"
                      onClick={() => handleRecentClick(batch.path)}
                      aria-label={`Buka kembali folder ${batch.name}`}
                    >
                      <span className="import-history-row__icon"><AppIcon name="folder" size={18} /></span>
                      <span className="import-history-row__copy">
                        <strong title={batch.name}>{batch.name}</strong>
                        <span>{batch.fileCount} file · {formatRecentStamp(new Date(batch.date))}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="import-history-row__delete"
                      onClick={() => setBatchToDelete({ path: batch.path, name: batch.name })}
                      title="Hapus riwayat"
                      aria-label={`Hapus ${batch.name} dari riwayat`}
                    >
                      <AppIcon name="delete" size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <footer className="import-utility-footer">
            <span>EntryMate By Ghaniya</span>
            <span>Import · Prepare · Review</span>
          </footer>
        </aside>
      </div>

      {batchToDelete && (
        <div className="modal-overlay">
          <div ref={deleteDialogRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-history-title">
            <div className="modal-header">
              <AppIcon name="delete" className="text-red-600" />
              <h3 id="delete-history-title">Konfirmasi hapus riwayat</h3>
            </div>
            <div className="modal-body">
              <p>
                Apakah Anda yakin ingin menghapus folder <strong>{batchToDelete.name}</strong> dari riwayat pilihan? Ini tidak akan menghapus file aslinya.
              </p>
            </div>
            <div className="modal-footer">
              <button ref={deleteCancelRef} type="button" className="secondary-button" onClick={() => setBatchToDelete(null)}>
                Batal
              </button>
              <button type="button" className="primary-action !bg-red-600 hover:!bg-red-700" onClick={handleDeleteHistory}>
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
