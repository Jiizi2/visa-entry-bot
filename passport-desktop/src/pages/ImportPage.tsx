import React, { useState } from 'react';
import { useAppContext } from '../AppContext';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { formatRecentStamp } from '../utils/helpers';
import '../import-modern.css';

export default function ImportPage() {
  const { state, updateState } = useAppContext();
  const [showToast, setShowToast] = useState(false);

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
      }
    } catch (e) {
      console.error('Failed to load manifest for recent path', e);
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
    <section id="page-import" className="page-section import-page-modern">

      <div className="import-content-modern">
        {/* Pilih Folder Dropzone */}
        <div className="modern-card dropzone-card-modern" onClick={handleChooseFolder} role="button" tabIndex={0}>
          <div className="dropzone-info">
            <div className="dropzone-icon">
              <span className="material-symbols-outlined">folder_open</span>
            </div>
            <div>
              <h2>Folder Passport</h2>
              <p>Pilih folder berisi foto atau PDF passport untuk diproses.</p>
            </div>
          </div>
          
          <div className="dropzone-action" style={{ maxWidth: '600px' }}>
            <div className="input-with-icon">
              <span className="material-symbols-outlined">search</span>
              <input 
                type="text" 
                readOnly 
                value={state.selectedDir} 
                placeholder="Belum ada folder terpilih..." 
              />
            </div>
            <button className="btn-primary-modern" onClick={(e) => { e.stopPropagation(); handleChooseFolder(); }}>
              {state.selectedDir ? 'Ganti' : 'Pilih Folder'}
            </button>
            {state.selectedDir && (
              <button 
                className="btn-next-modern" 
                onClick={(e) => { e.stopPropagation(); handleNext(); }} 
                style={{ padding: '10px 24px', display: 'flex', gap: '8px', alignItems: 'center' }}
              >
                Lanjutkan
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_forward</span>
              </button>
            )}
          </div>
        </div>

        <div className="import-grid-modern">
          {/* Left Column */}
          <div className="import-left-col">
            
            {/* OCR Settings */}
            <div className="modern-card ocr-settings-modern">
              <div className="card-header">
                <div>
                  <span className="step-eyebrow">LANGKAH 2</span>
                  <h3>Mode Pemrosesan OCR</h3>
                </div>
                <button className="btn-secondary-modern">
                  <span className="material-symbols-outlined">settings</span>
                  KONFIGURASI
                </button>
              </div>

              <div className="ocr-mode-grid">
                {['speed', 'balanced', 'heavy'].map(mode => {
                  const isActive = state.ocrMode === mode;
                  let icon = 'balance';
                  let speedText = '20-30S / FILE';
                  if (mode === 'speed') { icon = 'bolt'; speedText = '10-15S / FILE'; }
                  if (mode === 'heavy') { icon = 'psychology'; speedText = '60S+ / FILE'; }

                  return (
                    <div 
                      key={mode} 
                      className={`ocr-mode-card ${isActive ? 'active' : ''}`}
                      onClick={() => updateState({ ocrMode: mode })}
                    >
                      <div className="ocr-mode-icon">
                        <span className="material-symbols-outlined">{icon}</span>
                      </div>
                      <div className="ocr-mode-text">
                        <div className="mode-title">{mode.charAt(0).toUpperCase() + mode.slice(1)} Mode</div>
                        <div className="mode-speed">{speedText}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Default Entry */}
            <div className="modern-card default-entry-modern">
              <div className="decorative-bg"></div>
              <span className="step-eyebrow">DEFAULT ENTRY</span>
              <h3 className="card-title">Nilai Rombongan <span className="material-symbols-outlined">info</span></h3>
              
              <div className="form-grid">
                <div className="form-group">
                  <label>PROFESI</label>
                  <div className="input-with-icon">
                    <span className="material-symbols-outlined">work</span>
                    <input type="text" value={state.defaultEntry.profesi} onChange={e => handleDefaultChange('profesi', e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label>STATUS NIKAH</label>
                  <div className="input-with-icon">
                    <span className="material-symbols-outlined">blinds</span>
                    <input type="text" value={state.defaultEntry.statusNikah} onChange={e => handleDefaultChange('statusNikah', e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label>TIPE PASSPORT</label>
                  <div className="input-with-icon">
                    <span className="material-symbols-outlined">menu_book</span>
                    <input type="text" value={state.defaultEntry.tipePassport} onChange={e => handleDefaultChange('tipePassport', e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label>EMAIL</label>
                  <div className="input-with-icon">
                    <span className="material-symbols-outlined">mail</span>
                    <input type="text" value={state.defaultEntry.email} onChange={e => handleDefaultChange('email', e.target.value)} placeholder="Contoh: husein@gmail.com" />
                  </div>
                </div>
                <div className="form-group full-width">
                  <label>NOMOR TELEPON</label>
                  <div className="input-with-icon">
                    <span className="material-symbols-outlined" style={{color: '#ec4899'}}>call</span>
                    <input type="text" value={state.defaultEntry.nomorTelepon} onChange={e => handleDefaultChange('nomorTelepon', e.target.value)} placeholder="Contoh: 62821..." />
                  </div>
                </div>
              </div>

              <div className="default-entry-footer">
                <button className="btn-secondary-modern" onClick={handleApplyDefault}>
                  <span className="material-symbols-outlined">done_all</span> Terapkan Default
                </button>
                <div className="active-defaults-badge">
                  <div className="active-dot"></div>
                  <span>Default otomatis aktif</span>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column */}
          <div className="import-right-col">
            <div className="modern-card recent-history-modern">
              <span className="step-eyebrow">FOLDER TERAKHIR</span>
              <h3 className="card-title">Riwayat Pilihan</h3>
              
              <div className="recent-list custom-scrollbar">
                {state.recentBatches.length === 0 ? (
                  <p className="no-recent">Belum ada riwayat folder.</p>
                ) : (
                  state.recentBatches.map((batch, i) => (
                    <div 
                      key={i} 
                      className="recent-item-modern"
                      onClick={() => handleRecentClick(batch.path)}
                    >
                      <div className="recent-item-info">
                        <div className="recent-item-icon">
                          <span className="material-symbols-outlined">folder</span>
                        </div>
                        <div>
                          <div className="recent-name" title={batch.name}>{batch.name}</div>
                          <div className="recent-date">
                            <span className="material-symbols-outlined">schedule</span>
                            {formatRecentStamp(new Date(batch.date))}
                          </div>
                        </div>
                      </div>
                      <div className="recent-item-count">{batch.fileCount} file</div>
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
          <span className="material-symbols-outlined">check_circle</span>
          <span style={{ fontWeight: 500 }}>Default otomatis aktif</span>
        </div>
      )}

    </section>
  );
}
