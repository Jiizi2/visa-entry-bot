import React, { useState } from 'react';
import { useStore } from '../store';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { formatRecentStamp } from '../utils/helpers';
import AppIcon from '../components/ui/AppIcon';

export default function ImportPage() {
  const state = useStore();
  const updateState = useStore(s => s.updateState);
  const [showToast, setShowToast] = useState(false);
  const [batchToDelete, setBatchToDelete] = useState<{path: string, name: string} | null>(null);

  const handleDeleteHistory = () => {
    if (!batchToDelete) return;
    const updatedRecent = state.recentBatches.filter(b => b.path !== batchToDelete.path);
    updateState({ recentBatches: updatedRecent });
    setBatchToDelete(null);
  };

  const handleChooseFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Pilih folder passport",
      });

      if (typeof selected === "string") {
        const folderName = selected.split('\\').pop() || selected;
        const newBatch = {
          path: selected,
          name: folderName,
          date: new Date().toISOString(),
          fileCount: '?'
        };
        const updatedRecent = [newBatch, ...state.recentBatches.filter(b => b.path !== selected)].slice(0, 10);
        
        updateState({ 
          selectedDir: selected,
          recentBatches: updatedRecent,
          statusHeadline: "Folder dipilih",
          statusDetail: `Folder aktif: ${selected}`,
          preparedSession: null,
          manifest: null,
          manifestPath: '',
          exportedBatchPath: '',
          exportError: '',
          reviewedMemberIds: new Set(),
          selectedIds: new Set(),
          activeMemberId: '',
          entryLogs: [],
          scanLogs: []
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRecentClick = async (path: string) => {
    updateState({ 
      selectedDir: path,
      statusHeadline: "Folder dipilih",
      statusDetail: `Folder aktif: ${path}`,
      preparedSession: null,
      manifest: null,
      manifestPath: '',
      exportedBatchPath: '',
      exportError: '',
      reviewedMemberIds: new Set(),
      selectedIds: new Set(),
      activeMemberId: '',
      entryLogs: [],
      scanLogs: []
    });

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
        // Remove broken path from recent list
        updateState({
          recentBatches: state.recentBatches.filter((b: any) => b.path !== path)
        });
      }
    } catch (e) {
      console.error('Failed to load manifest for recent path', e);
      alert(`Terjadi kesalahan saat memuat folder:\n${e}`);
      updateState({
        recentBatches: state.recentBatches.filter((b: any) => b.path !== path)
      });
    }
  };

  const handleDefaultChange = (field: keyof typeof state.defaultEntry, value: string) => {
    updateState({
      defaultEntry: {
        ...state.defaultEntry,
        [field]: value
      }
    });
  };

  const handleNext = () => {
    updateState({ currentPage: 'prepare' });
  };

  const handleApplyDefault = () => {
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  return (
    <section id="page-import" className="page-container import-page">
      <header className="app-page-header">
        <div className="app-page-header-left">
          <div className="app-page-header-icon">
            <AppIcon name="folder_open" size={20} />
          </div>
          <div className="app-page-header-info">
            <span className="app-page-step-label">Langkah 1 · Import folder</span>
            <h1 className="app-page-title">Pilih folder kerja</h1>
            <p className="app-page-subtitle">Tentukan sumber passport, mode OCR, dan nilai default rombongan.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="primary-action" type="button" onClick={handleNext} disabled={!state.selectedDir}>
            Lanjut ke Prepare
            <AppIcon name="arrow_forward" size={16} />
          </button>
        </div>
      </header>

      <div className="import-page__content">
        {/* Pilih Folder Dropzone */}
        <div className="import-folder-bar">
          <div className="flex items-center gap-5">
            <div className="import-folder-bar__icon" aria-hidden="true">
              <AppIcon name="folder_open" size={22} />
            </div>
            <div>
              <h2 className="type-body-strong text-slate-900 m-0">Folder passport</h2>
              <p className="type-caption text-slate-500 mt-1 mb-0">Folder berisi foto atau PDF passport yang akan diproses.</p>
            </div>
          </div>
          
          <div className="import-folder-bar__picker">
            <div className="relative flex-1">
              <AppIcon name="search" size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                readOnly 
                value={state.selectedDir} 
                placeholder="Belum ada folder terpilih..." 
                aria-label="Folder passport aktif"
                className="w-full h-10 !pl-10 pr-4 bg-slate-100 border border-transparent rounded-lg type-body text-slate-700 outline-none"
              />
            </div>
            <button className="primary-action" onClick={(e) => { e.stopPropagation(); handleChooseFolder(); }}>
              {state.selectedDir ? 'Ganti' : 'Pilih Folder'}
            </button>
          </div>
        </div>

        <div className="import-grid">
          {/* Left Column */}
          <div className="flex flex-col gap-6">
            
            {/* OCR Settings */}
            <div className="app-card import-settings-card">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <span className="type-overline text-blue-700 bg-blue-600/10 px-2 py-1 rounded mb-2 inline-block">Langkah 2</span>
                  <h3 className="type-subtitle text-slate-900 m-0 flex items-center gap-2">Mode pemrosesan OCR</h3>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Mode pemrosesan OCR">
                {['speed', 'balanced', 'heavy'].map(mode => {
                  const isActive = state.ocrMode === mode;
                  let icon = 'balance';
                  let speedText = '20-30S / FILE';
                  if (mode === 'speed') { icon = 'bolt'; speedText = '15-20S / FILE'; }
                  if (mode === 'heavy') { icon = 'psychology'; speedText = '60S+ / FILE'; }

                  return (
                    <button
                      key={mode} 
                      className={`flex items-center gap-3 p-4 bg-slate-50 border rounded-xl cursor-pointer transition-all hover:bg-white hover:border-blue-400 hover:shadow-md ${isActive ? 'bg-blue-50 border-blue-500 shadow-[0_4px_12px_rgba(59,130,246,0.15)] ring-1 ring-blue-500' : 'border-slate-200'}`}
                      onClick={() => updateState({ ocrMode: mode })}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                    >
                      <div className={`w-10 h-10 flex items-center justify-center rounded-lg border transition-colors ${isActive ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-500'}`}>
                        <AppIcon name={icon} size={24} />
                      </div>
                      <div className="flex flex-col">
                        <div className="type-body-strong text-slate-900">{mode.charAt(0).toUpperCase() + mode.slice(1)} mode</div>
                        <div className={`type-caption mt-0.5 ${isActive ? 'text-blue-700' : 'text-slate-500'}`}>{speedText}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 pt-5 border-t border-slate-200 flex items-center">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className={`w-6 h-6 rounded flex items-center justify-center border transition-all ${state.pdfBatchMode ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-100 border-slate-300 text-transparent group-hover:border-blue-400'}`}>
                    <AppIcon name="check" size={16} />
                  </div>
                  <input 
                    type="checkbox" 
                    className="sr-only"
                    checked={state.pdfBatchMode} 
                    onChange={e => updateState({ pdfBatchMode: e.target.checked })} 
                  />
                  <div className="flex flex-col">
                    <span className="type-body-strong text-slate-900">Ekstrak semua halaman PDF</span>
                    <span className="type-caption text-slate-500">Aktifkan jika 1 file PDF berisi banyak passport. (Proses lebih lambat)</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Default Entry */}
            <div className="app-card import-defaults-card">
              <div className="absolute top-0 right-0 w-[300px] h-full bg-gradient-to-bl from-blue-50 to-transparent -z-10 opacity-60 pointer-events-none"></div>
              <span className="type-overline text-blue-700 bg-blue-600/10 px-2 py-1 rounded mb-2 inline-block">Default entry</span>
              <h3 className="type-subtitle text-slate-900 m-0 flex items-center gap-2">Nilai rombongan <AppIcon name="info" size={20} className="text-slate-400" /></h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 mt-6">
                <div className="flex flex-col gap-2">
                  <label className="type-caption-strong text-slate-600">Profesi</label>
                  <div className="relative flex-1">
                    <AppIcon name="work" size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="text" className="w-full h-10 !pl-10 pr-3" value={state.defaultEntry.profesi} onChange={e => handleDefaultChange('profesi', e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="type-caption-strong text-slate-600">Status nikah</label>
                  <div className="relative flex-1">
                    <AppIcon name="blinds" size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="text" className="w-full h-10 !pl-10 pr-3" value={state.defaultEntry.statusNikah} onChange={e => handleDefaultChange('statusNikah', e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="type-caption-strong text-slate-600">Tipe passport</label>
                  <div className="relative flex-1">
                    <AppIcon name="menu_book" size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="text" className="w-full h-10 !pl-10 pr-3" value={state.defaultEntry.tipePassport} onChange={e => handleDefaultChange('tipePassport', e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="type-caption-strong text-slate-600">Email</label>
                  <div className="relative flex-1">
                    <AppIcon name="mail" size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="text" className="w-full h-10 !pl-10 pr-3" value={state.defaultEntry.email} onChange={e => handleDefaultChange('email', e.target.value)} placeholder="Contoh: husein@gmail.com" />
                  </div>
                </div>
                <div className="flex flex-col gap-2 col-span-1 sm:col-span-2">
                  <label className="type-caption-strong text-slate-600">Nomor telepon</label>
                  <div className="relative flex-1">
                    <AppIcon name="call" size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-pink-500" />
                    <input type="text" className="w-full h-10 !pl-10 pr-3" value={state.defaultEntry.nomorTelepon} onChange={e => handleDefaultChange('nomorTelepon', e.target.value)} placeholder="Contoh: 62821..." />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-6 pt-5 border-t border-slate-200">
                <button className="secondary-button" onClick={handleApplyDefault}>
                  <AppIcon name="done_all" size={18} /> Terapkan Default
                </button>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 type-caption-strong rounded-full border border-emerald-200">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                  <span>Default otomatis aktif</span>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column */}
          <div className="flex flex-col gap-6 h-full">
            <div className="app-card import-history-card">
              <span className="type-overline text-blue-700 bg-blue-600/10 px-2 py-1 rounded mb-2 inline-block self-start">Folder terakhir</span>
              <h3 className="type-subtitle text-slate-900 m-0 mb-2">Riwayat pilihan</h3>
              
              <div className="flex flex-col gap-3 mt-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {state.recentBatches.length === 0 ? (
                  <p className="text-slate-500 type-body py-4 text-center">Belum ada riwayat folder.</p>
                ) : (
                  state.recentBatches.map((batch, i) => (
                    <div 
                      key={i} 
                      className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl cursor-pointer transition-all hover:border-blue-400 hover:shadow-md hover:-translate-y-px"
                      onClick={() => handleRecentClick(batch.path)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-blue-50 text-blue-600 shrink-0">
                          <AppIcon name="folder" size={24} />
                        </div>
                        <div className="min-w-0">
                          <div className="type-body-strong text-slate-900 truncate max-w-[140px]" title={batch.name}>{batch.name}</div>
                          <div className="flex items-center gap-1 type-caption text-slate-500 mt-0.5">
                            <AppIcon name="schedule" size={14} />
                            {formatRecentStamp(new Date(batch.date))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="type-caption-strong text-blue-700 bg-blue-50 px-2 py-1 rounded-md">{batch.fileCount} file</div>
                        <button 
                          className="flex items-center justify-center w-8 h-8 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBatchToDelete({ path: batch.path, name: batch.name });
                          }}
                          title="Hapus riwayat"
                          aria-label={`Hapus ${batch.name} dari riwayat`}
                        >
                          <AppIcon name="delete" size={18} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

      {showToast && (
        <div role="status" aria-live="polite" style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          backgroundColor: '#10b981',
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
          <AppIcon name="check_circle" size={24} />
          <span className="type-body-strong">Default otomatis aktif</span>
        </div>
      )}
      {/* Modal Hapus Riwayat */}
      {batchToDelete && (
        <div className="modal-overlay">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-history-title">
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
              <button 
                className="secondary-button"
                onClick={() => setBatchToDelete(null)}
              >
                Batal
              </button>
              <button 
                className="primary-action !bg-red-600 hover:!bg-red-700"
                onClick={handleDeleteHistory}
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  );
}
