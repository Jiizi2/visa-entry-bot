import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../AppContext';
import { invoke } from '@tauri-apps/api/core';
import CropTool, { CropRect } from '../components/CropTool';
import './prepare-page.css';

export default function PreparePage() {
  const { state, updateState } = useAppContext();
  const [error, setError] = useState('');
  const [activeItem, setActiveItem] = useState<any>(null);
  const [activeImageData, setActiveImageData] = useState<{dataUrl?: string, path?: string}>({});
  const [isCropping, setIsCropping] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [thumbCache, setThumbCache] = useState<Record<string, string>>({});
  const [listPage, setListPage] = useState(0);

  const items = state.preparedSession?.items || [];

  useEffect(() => {
    if (!state.preparedSession && state.selectedDir && !state.isPreparingImages) {
      prepareImages();
    }
  }, [state.selectedDir, state.preparedSession]);

  useEffect(() => {
    if (items.length > 0) {
      if (!state.activePreparedItemId) {
        updateState({ activePreparedItemId: String(items[0].id) });
      } else {
        const item = items.find((i: any) => String(i.id) === state.activePreparedItemId);
        setActiveItem(item || items[0]);
      }
    } else {
      setActiveItem(null);
    }
  }, [items, state.activePreparedItemId]);

  const pageSize = 8;
  const totalPages = Math.ceil(items.length / pageSize);
  const currentItems = items.slice(listPage * pageSize, (listPage + 1) * pageSize);

  useEffect(() => {
    if (state.activePreparedItemId && items.length > 0) {
      const index = items.findIndex((i: any) => String(i.id) === state.activePreparedItemId);
      if (index >= 0) {
        setListPage(Math.floor(index / pageSize));
      }
    }
  }, [state.activePreparedItemId, items, pageSize]);

  useEffect(() => {
    if (activeItem) {
      loadActiveImage(activeItem);
    } else {
      setActiveImageData({});
    }
  }, [activeItem]);

  // Load thumbnails
  useEffect(() => {
    items.forEach((item: any) => {
      if (!thumbCache[item.id]) {
        invoke('load_passport_image_data', {
          manifestPath: '',
          imagePath: effectiveImagePath(item),
          fileName: item.fileName || '',
        }).then((res: any) => {
          if (res?.dataUrl) {
            setThumbCache(prev => ({ ...prev, [item.id]: res.dataUrl }));
          }
        }).catch(console.error);
      }
    });
  }, [items]);

  const effectiveImagePath = (item: any) => String(item?.editedPath || item?.scanPath || '').trim();

  const prepareImages = async () => {
    updateState({ isPreparingImages: true, statusHeadline: 'Menyiapkan foto' });
    try {
      const session = await invoke('prepare_passport_images', { selectedDir: state.selectedDir });
      updateState({ preparedSession: session, isPreparingImages: false, statusHeadline: 'Foto siap dicek' });
    } catch (e) {
      setError(String(e));
      updateState({ isPreparingImages: false });
    }
  };

  const loadActiveImage = async (item: any) => {
    try {
      const res: any = await invoke('load_passport_image_data', {
        manifestPath: '',
        imagePath: effectiveImagePath(item),
        fileName: item.fileName || '',
      });
      setActiveImageData(res || {});
    } catch (e) {
      console.error(e);
      setActiveImageData({});
    }
  };

  const handleStartScan = async () => {
    if (!state.selectedDir) {
      setError('Folder belum dipilih.');
      return;
    }
    
    updateState({ isScanning: true, statusHeadline: 'Memulai scan' });
    try {
      await invoke('start_scan', {
        selectedDir: state.selectedDir,
        ocrMode: state.ocrMode,
        preparedManifestPath: state.preparedSession?.preparedManifestPath || null,
      });
      updateState({ currentPage: 'scan' });
    } catch (e) {
      setError(String(e));
      updateState({ isScanning: false });
    }
  };

  const renderRotatedDataUrl = (dataUrl: string, deltaDegrees: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const rotateQuarter = Math.abs(deltaDegrees) % 180 === 90;
        const canvas = document.createElement("canvas");
        canvas.width = rotateQuarter ? img.naturalHeight : img.naturalWidth;
        canvas.height = rotateQuarter ? img.naturalWidth : img.naturalHeight;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return reject("Canvas error");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((deltaDegrees * Math.PI) / 180);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  };

  const handleRotate = async (delta: number) => {
    if (!activeItem || !activeImageData.dataUrl) return;
    updateState({ statusHeadline: 'Menyimpan rotasi...' });
    try {
      const newUrl = await renderRotatedDataUrl(activeImageData.dataUrl, delta);
      const nextRotation = (((Number(activeItem.rotationDegrees || 0) + delta) % 360) + 360) % 360;
      const session = await invoke('save_prepared_passport_image', {
        preparedManifestPath: state.preparedSession?.preparedManifestPath || '',
        itemId: String(activeItem.id),
        sourceImagePath: effectiveImagePath(activeItem),
        dataUrl: newUrl,
        crop: { operation: 'rotate', rotationDeltaDegrees: delta, rotationDegrees: nextRotation, sourceImagePath: effectiveImagePath(activeItem) },
        rotationDegrees: nextRotation,
      });
      updateState({ preparedSession: session, statusHeadline: 'Rotasi tersimpan' });
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDelete = async () => {
    if (!activeItem) return;
    try {
      const session: any = await invoke('remove_prepared_passport_image', {
        preparedManifestPath: state.preparedSession?.preparedManifestPath || '',
        itemId: String(activeItem.id),
      });
      const nextActive = session?.items?.length ? String(session.items[0].id) : '';
      updateState({ preparedSession: session, activePreparedItemId: nextActive });
      setShowDeleteConfirm(false);
    } catch (e) {
      setError(String(e));
      setShowDeleteConfirm(false);
    }
  };

  const handleSaveCrop = async (dataUrl: string, rect: CropRect) => {
    if (!activeItem) return;
    updateState({ statusHeadline: 'Menyimpan crop...' });
    try {
      const session = await invoke('save_prepared_passport_image', {
        preparedManifestPath: state.preparedSession?.preparedManifestPath || '',
        itemId: String(activeItem.id),
        sourceImagePath: effectiveImagePath(activeItem),
        dataUrl,
        crop: { rect, operation: 'crop', sourceImagePath: effectiveImagePath(activeItem) },
        rotationDegrees: Number(activeItem.rotationDegrees || 0),
      });
      updateState({ preparedSession: session, statusHeadline: 'Crop tersimpan' });
      setIsCropping(false);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section id="page-prepare" className="page-section" style={{ height: '100%', padding: '16px 24px 24px 24px', display: 'flex', flexDirection: 'column' }}>
      <div className="prepare-page-container">
        
        {/* Left Panel: Photo List */}
        <aside className="prepare-aside">
          <div className="prepare-aside-header">
            <span className="material-symbols-outlined text-on-surface-variant">photo_library</span>
          </div>
          
          <div className="prepare-aside-list">
            {state.isPreparingImages && (
              <div style={{ textAlign: 'center', color: '#9ca3af' }}>
                <div className="prepare-spinner"></div>
              </div>
            )}
            {!state.isPreparingImages && currentItems.map((item: any, idx: number) => {
              const isActive = String(item.id) === state.activePreparedItemId;
              const globalIdx = listPage * pageSize + idx;
              return (
                <button
                  key={item.id}
                  className={`prepare-aside-item ${isActive ? "is-active" : ""}`}
                  type="button"
                  onClick={() => updateState({ activePreparedItemId: String(item.id) })}
                  title={item.fileName || `passport-${globalIdx + 1}`}
                >
                  <img 
                    className="prepare-aside-thumb" 
                    src={thumbCache[item.id] || ''} 
                    alt={item.fileName || `Passport ${globalIdx + 1}`} 
                  />
                </button>
              );
            })}
          </div>

          {!state.isPreparingImages && totalPages > 1 && (
            <div className="prepare-aside-pagination" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 8px', borderTop: '1px solid rgba(195, 198, 215, 0.4)' }}>
              <button 
                onClick={() => setListPage(p => Math.max(0, p - 1))}
                disabled={listPage === 0}
                style={{ background: 'none', border: 'none', cursor: listPage === 0 ? 'default' : 'pointer', opacity: listPage === 0 ? 0.3 : 1, padding: '4px', display: 'flex', alignItems: 'center', color: '#004ac6' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>chevron_left</span>
              </button>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#434655', whiteSpace: 'nowrap' }}>
                {listPage + 1} / {totalPages}
              </span>
              <button 
                onClick={() => setListPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={listPage === totalPages - 1}
                style={{ background: 'none', border: 'none', cursor: listPage === totalPages - 1 ? 'default' : 'pointer', opacity: listPage === totalPages - 1 ? 0.3 : 1, padding: '4px', display: 'flex', alignItems: 'center', color: '#004ac6' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>chevron_right</span>
              </button>
            </div>
          )}
        </aside>

        {/* Right Panel: Main Preview & Actions */}
        <section className="prepare-main">
          
          {/* Image Canvas */}
          <div className="prepare-image-canvas">
            
            {/* Preview Area */}
            <div className="prepare-preview-area">
              <div className="checkerboard-bg"></div>
              
              {state.isPreparingImages && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10 }}>
                  <div className="prepare-spinner prepare-spinner-lg"></div>
                  <h3 style={{ marginTop: '20px', color: '#191c1e' }}>Menyiapkan Foto...</h3>
                  <p style={{ color: '#434655', marginTop: '8px' }}>Mohon tunggu, sedang membaca dan memproses dokumen dari folder.</p>
                </div>
              )}
              
              {!state.isPreparingImages && !activeImageData.dataUrl && activeItem && (
                 <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10, color: '#434655' }}>
                   <div className="prepare-spinner" style={{ marginBottom: '10px' }}></div>
                   Memuat pratinjau gambar...
                 </div>
              )}
              
              {!state.isPreparingImages && !activeItem && (
                <div style={{ zIndex: 10, color: '#434655' }}>Belum ada foto dipilih.</div>
              )}
              
              {!state.isPreparingImages && activeImageData.dataUrl && (
                <img 
                  className="prepare-preview-img" 
                  src={activeImageData.dataUrl} 
                  alt="Large passport preview" 
                />
              )}
            </div>
            
            {/* Image Action Bar */}
            {!state.isPreparingImages && activeItem && (
              <div className="prepare-glass-panel">
                <button className="prepare-action-btn" onClick={() => setIsCropping(true)} disabled={!activeImageData.dataUrl}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>crop</span>
                  Crop Foto
                </button>
                <button className="prepare-action-btn" onClick={() => handleRotate(-90)} disabled={!activeImageData.dataUrl}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>rotate_left</span>
                  Rotasi Kiri
                </button>
                <button className="prepare-action-btn" onClick={() => handleRotate(90)} disabled={!activeImageData.dataUrl}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>rotate_right</span>
                  Rotasi Kanan
                </button>
                <button className="prepare-action-btn danger" onClick={() => setShowDeleteConfirm(true)} disabled={!activeImageData.dataUrl}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
                  Hapus Foto
                </button>
                
                {/* Find next item for "Berikutnya" */}
                {(() => {
                  const currentIndex = items.findIndex((i: any) => String(i.id) === state.activePreparedItemId);
                  const hasNext = currentIndex >= 0 && currentIndex < items.length - 1;
                  return (
                    <button 
                      className="prepare-action-btn primary-like" 
                      disabled={!hasNext}
                      onClick={() => {
                        if (hasNext) updateState({ activePreparedItemId: String(items[currentIndex + 1].id) });
                      }}
                    >
                      Berikutnya
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>navigate_next</span>
                    </button>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="prepare-footer">
            <p className="prepare-footer-text">
              <span className="material-symbols-outlined">info</span>
              Pastikan semua foto sudah terbaca jelas sebelum OCR dimulai.
            </p>
            {error && <div style={{ color: 'red', fontWeight: 'bold', margin: '0 0 10px 0', fontSize: '14px', padding: '10px', background: 'rgba(186, 26, 26, 0.1)', borderRadius: '6px', border: '1px solid rgba(186, 26, 26, 0.3)' }}>{error}</div>}
            <div className="prepare-footer-actions">
              <button className="prepare-btn-secondary" type="button" onClick={() => updateState({ currentPage: 'import' })}>
                Kembali Folder
              </button>
              <button className="prepare-btn-primary" type="button" onClick={handleStartScan} disabled={state.isScanning || state.isPreparingImages}>
                Start Scan
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_forward</span>
              </button>
            </div>
          </div>
          
        </section>
      </div>

      {isCropping && activeImageData.dataUrl && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, background: 'rgba(0,0,0,0.8)', padding: '40px' }}>
           <CropTool 
             imageSrc={activeImageData.dataUrl}
             onSave={handleSaveCrop}
             onCancel={() => setIsCropping(false)}
           />
        </div>
      )}

      {showDeleteConfirm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '400px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 16px 0', color: '#1a1c1e', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ color: '#ba1a1a' }}>warning</span>
              Konfirmasi Hapus
            </h3>
            <p style={{ margin: '0 0 24px 0', color: '#43474e', fontSize: '15px', lineHeight: '1.5' }}>
              Apakah Anda yakin ingin menghapus foto ini? Tindakan ini tidak dapat dibatalkan.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button 
                onClick={() => setShowDeleteConfirm(false)}
                style={{ background: 'transparent', border: '1px solid #74777f', color: '#43474e', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 500 }}
              >
                Batal
              </button>
              <button 
                onClick={handleDelete}
                style={{ background: '#ba1a1a', border: 'none', color: '#ffffff', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 500 }}
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
