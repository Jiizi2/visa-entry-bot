import React, { useState } from 'react';
import { useStore } from '../store';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { formatRecentStamp } from '../utils/helpers';

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
    <section id="page-import" className="flex flex-col h-full relative overflow-x-hidden bg-slate-50 font-sans text-slate-900 p-4 sm:p-6">
      <div className="flex flex-col gap-6 flex-1">
        {/* Pilih Folder Dropzone */}
        <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-300/40 shadow-[0_8px_30px_rgba(0,0,0,0.04)] p-6 relative overflow-hidden flex items-center justify-between gap-6 cursor-pointer transition-shadow duration-300 hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)]" onClick={handleChooseFolder} role="button" tabIndex={0}>
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-blue-200 rounded-xl flex items-center justify-center text-blue-700">
              <span className="material-symbols-outlined text-[28px]">folder_open</span>
            </div>
            <div>
              <h2 className="text-[20px] font-bold text-slate-900 m-0 tracking-tight">Folder Passport</h2>
              <p className="text-sm text-slate-500 mt-1 mb-0">Pilih folder berisi foto atau PDF passport untuk diproses.</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 w-full" style={{ maxWidth: '600px' }}>
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">search</span>
              <input 
                type="text" 
                readOnly 
                value={state.selectedDir} 
                placeholder="Belum ada folder terpilih..." 
                className="w-full h-11 !pl-10 pr-4 bg-slate-100 border border-transparent rounded-lg text-sm text-slate-700 transition-all focus:bg-white focus:border-blue-500/30 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.1)] outline-none"
              />
            </div>
            <button className="h-[46px] px-6 bg-gradient-to-r from-blue-700 to-blue-600 text-white font-semibold text-[14px] rounded-lg shadow-[0_4px_12px_rgba(0,74,198,0.2)] transition-all hover:-translate-y-[1px] hover:shadow-[0_6px_16px_rgba(0,74,198,0.3)] active:scale-[0.98]" onClick={(e) => { e.stopPropagation(); handleChooseFolder(); }}>
              {state.selectedDir ? 'Ganti' : 'Pilih Folder'}
            </button>
            {state.selectedDir && (
              <button 
                className="flex items-center gap-2 h-[46px] px-6 bg-emerald-500 text-white font-semibold text-[14px] rounded-lg shadow-[0_4px_12px_rgba(16,185,129,0.2)] transition-all hover:-translate-y-[1px] hover:shadow-[0_6px_16px_rgba(16,185,129,0.3)] active:scale-[0.98]" 
                onClick={(e) => { e.stopPropagation(); handleNext(); }} 
              >
                Lanjutkan
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>arrow_forward</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="flex flex-col gap-6 xl:col-span-2">
            
            {/* OCR Settings */}
            <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-300/40 shadow-[0_8px_30px_rgba(0,0,0,0.04)] p-6 relative overflow-hidden">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <span className="text-[10px] font-bold tracking-widest text-blue-700 bg-blue-600/10 px-2 py-1 rounded uppercase mb-2 inline-block">LANGKAH 2</span>
                  <h3 className="text-[20px] font-bold text-slate-900 m-0 tracking-tight flex items-center gap-2">Mode Pemrosesan OCR</h3>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {['speed', 'balanced', 'heavy'].map(mode => {
                  const isActive = state.ocrMode === mode;
                  let icon = 'balance';
                  let speedText = '20-30S / FILE';
                  if (mode === 'speed') { icon = 'bolt'; speedText = '10-15S / FILE'; }
                  if (mode === 'heavy') { icon = 'psychology'; speedText = '60S+ / FILE'; }

                  return (
                    <div 
                      key={mode} 
                      className={`flex items-center gap-3 p-4 bg-slate-50 border rounded-xl cursor-pointer transition-all hover:bg-white hover:border-blue-400 hover:shadow-md ${isActive ? 'bg-blue-50 border-blue-500 shadow-[0_4px_12px_rgba(59,130,246,0.15)] ring-1 ring-blue-500' : 'border-slate-200'}`}
                      onClick={() => updateState({ ocrMode: mode })}
                    >
                      <div className={`w-10 h-10 flex items-center justify-center rounded-lg border transition-colors ${isActive ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-500'}`}>
                        <span className="material-symbols-outlined text-[24px]">{icon}</span>
                      </div>
                      <div className="flex flex-col">
                        <div className="text-[14px] font-bold text-slate-900 leading-snug">{mode.charAt(0).toUpperCase() + mode.slice(1)} Mode</div>
                        <div className={`text-[11px] font-medium mt-0.5 ${isActive ? 'text-blue-700' : 'text-slate-500'}`}>{speedText}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 pt-5 border-t border-slate-200 flex items-center">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className={`w-6 h-6 rounded flex items-center justify-center border transition-all ${state.pdfBatchMode ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-100 border-slate-300 text-transparent group-hover:border-blue-400'}`}>
                    <span className="material-symbols-outlined text-[16px]">check</span>
                  </div>
                  <input 
                    type="checkbox" 
                    className="hidden" 
                    checked={state.pdfBatchMode} 
                    onChange={e => updateState({ pdfBatchMode: e.target.checked })} 
                  />
                  <div className="flex flex-col">
                    <span className="text-[14px] font-bold text-slate-900">Ekstrak Semua Halaman PDF</span>
                    <span className="text-[11px] text-slate-500">Aktifkan jika 1 file PDF berisi banyak passport. (Proses lebih lambat)</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Default Entry */}
            <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-300/40 shadow-[0_8px_30px_rgba(0,0,0,0.04)] p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-[300px] h-full bg-gradient-to-bl from-blue-50 to-transparent -z-10 opacity-60 pointer-events-none"></div>
              <span className="text-[10px] font-bold tracking-widest text-blue-700 bg-blue-600/10 px-2 py-1 rounded uppercase mb-2 inline-block">DEFAULT ENTRY</span>
              <h3 className="text-[20px] font-bold text-slate-900 m-0 tracking-tight flex items-center gap-2">Nilai Rombongan <span className="material-symbols-outlined text-[20px] text-slate-400">info</span></h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 mt-6">
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold tracking-wider text-slate-600">PROFESI</label>
                  <div className="relative flex-1">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">work</span>
                    <input type="text" className="w-full h-9 !pl-10 pr-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 transition-all focus:bg-white focus:border-blue-500 focus:shadow-[0_0_0_2px_rgba(59,130,246,0.2)] outline-none" value={state.defaultEntry.profesi} onChange={e => handleDefaultChange('profesi', e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold tracking-wider text-slate-600">STATUS NIKAH</label>
                  <div className="relative flex-1">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">blinds</span>
                    <input type="text" className="w-full h-9 !pl-10 pr-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 transition-all focus:bg-white focus:border-blue-500 focus:shadow-[0_0_0_2px_rgba(59,130,246,0.2)] outline-none" value={state.defaultEntry.statusNikah} onChange={e => handleDefaultChange('statusNikah', e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold tracking-wider text-slate-600">TIPE PASSPORT</label>
                  <div className="relative flex-1">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">menu_book</span>
                    <input type="text" className="w-full h-9 !pl-10 pr-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 transition-all focus:bg-white focus:border-blue-500 focus:shadow-[0_0_0_2px_rgba(59,130,246,0.2)] outline-none" value={state.defaultEntry.tipePassport} onChange={e => handleDefaultChange('tipePassport', e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold tracking-wider text-slate-600">EMAIL</label>
                  <div className="relative flex-1">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">mail</span>
                    <input type="text" className="w-full h-9 !pl-10 pr-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 transition-all focus:bg-white focus:border-blue-500 focus:shadow-[0_0_0_2px_rgba(59,130,246,0.2)] outline-none" value={state.defaultEntry.email} onChange={e => handleDefaultChange('email', e.target.value)} placeholder="Contoh: husein@gmail.com" />
                  </div>
                </div>
                <div className="flex flex-col gap-2 col-span-1 sm:col-span-2">
                  <label className="text-[11px] font-bold tracking-wider text-slate-600">NOMOR TELEPON</label>
                  <div className="relative flex-1">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-pink-500 text-[20px]">call</span>
                    <input type="text" className="w-full h-9 !pl-10 pr-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 transition-all focus:bg-white focus:border-blue-500 focus:shadow-[0_0_0_2px_rgba(59,130,246,0.2)] outline-none" value={state.defaultEntry.nomorTelepon} onChange={e => handleDefaultChange('nomorTelepon', e.target.value)} placeholder="Contoh: 62821..." />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-6 pt-5 border-t border-slate-200">
                <button className="flex items-center gap-2 h-9 px-4 bg-slate-100 text-slate-600 font-semibold text-[12px] rounded-lg transition-colors hover:bg-slate-200 hover:text-slate-900" onClick={handleApplyDefault}>
                  <span className="material-symbols-outlined text-[18px]">done_all</span> Terapkan Default
                </button>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 text-[12px] font-semibold rounded-full border border-emerald-200">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                  <span>Default otomatis aktif</span>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column */}
          <div className="flex flex-col gap-6 xl:col-span-1 h-full">
            <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-300/40 shadow-[0_8px_30px_rgba(0,0,0,0.04)] p-6 relative overflow-hidden flex flex-col h-full max-h-[800px]">
              <span className="text-[10px] font-bold tracking-widest text-blue-700 bg-blue-600/10 px-2 py-1 rounded uppercase mb-2 inline-block self-start">FOLDER TERAKHIR</span>
              <h3 className="text-[20px] font-bold text-slate-900 m-0 tracking-tight mb-2">Riwayat Pilihan</h3>
              
              <div className="flex flex-col gap-3 mt-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {state.recentBatches.length === 0 ? (
                  <p className="text-slate-500 text-sm italic py-4 text-center">Belum ada riwayat folder.</p>
                ) : (
                  state.recentBatches.map((batch, i) => (
                    <div 
                      key={i} 
                      className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl cursor-pointer transition-all hover:border-blue-400 hover:shadow-md hover:-translate-y-px"
                      onClick={() => handleRecentClick(batch.path)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-blue-50 text-blue-600 shrink-0">
                          <span className="material-symbols-outlined text-[24px]">folder</span>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[14px] font-semibold text-slate-900 truncate max-w-[140px]" title={batch.name}>{batch.name}</div>
                          <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
                            <span className="material-symbols-outlined text-[14px]">schedule</span>
                            {formatRecentStamp(new Date(batch.date))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-[12px] font-bold text-blue-700 bg-blue-50 px-2 py-1 rounded-md">{batch.fileCount} file</div>
                        <button 
                          className="flex items-center justify-center w-8 h-8 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBatchToDelete({ path: batch.path, name: batch.name });
                          }}
                          title="Hapus riwayat"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
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
        <div style={{
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
          <span className="material-symbols-outlined text-[24px]">check_circle</span>
          <span style={{ fontWeight: 500 }}>Default otomatis aktif</span>
        </div>
      )}
      {/* Modal Hapus Riwayat */}
      {batchToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-[0_20px_60px_rgba(0,0,0,0.15)] border border-slate-200 overflow-hidden animate-[slideUp_0.3s_ease-out]">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4 text-red-600">
                <span className="material-symbols-outlined text-[32px]">delete</span>
                <h3 className="text-[20px] font-bold text-slate-900 m-0">Konfirmasi Hapus Riwayat</h3>
              </div>
              <p className="text-[15px] text-slate-600 leading-relaxed m-0">
                Apakah Anda yakin ingin menghapus folder <strong>{batchToDelete.name}</strong> dari riwayat pilihan? Ini tidak akan menghapus file aslinya.
              </p>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200">
              <button 
                className="px-5 py-2 rounded-xl font-semibold text-slate-600 bg-white border border-slate-300 hover:bg-slate-100 transition-colors"
                onClick={() => setBatchToDelete(null)}
              >
                Batal
              </button>
              <button 
                className="px-5 py-2 rounded-xl font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-sm shadow-red-600/20"
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
