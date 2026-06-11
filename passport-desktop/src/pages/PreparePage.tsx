import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import CropTool, { CropRect } from '../components/CropTool';
import { getEffectiveImagePath } from '../utils/paths';

export default function PreparePage() {
  const state = useStore();
  const updateState = useStore(s => s.updateState);
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
          imagePath: getEffectiveImagePath(item),
          fileName: item.fileName || '',
        }).then((res: any) => {
          if (res?.dataUrl) {
            setThumbCache(prev => ({ ...prev, [item.id]: res.dataUrl }));
          }
        }).catch(console.error);
      }
    });
  }, [items]);

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
        imagePath: getEffectiveImagePath(item),
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
        sourceImagePath: getEffectiveImagePath(activeItem),
        dataUrl: newUrl,
        crop: { operation: 'rotate', rotationDeltaDegrees: delta, rotationDegrees: nextRotation, sourceImagePath: getEffectiveImagePath(activeItem) },
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
        sourceImagePath: getEffectiveImagePath(activeItem),
        dataUrl,
        crop: { rect, operation: 'crop', sourceImagePath: getEffectiveImagePath(activeItem) },
        rotationDegrees: Number(activeItem.rotationDegrees || 0),
      });
      updateState({ preparedSession: session, statusHeadline: 'Crop tersimpan' });
      setIsCropping(false);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section id="page-prepare" className="flex flex-col h-full p-4 pb-6 px-6">
      <div className="flex w-full max-w-[1440px] mx-auto gap-6 h-full overflow-hidden p-0">
        
        {/* Left Panel: Photo List */}
        <aside className="shrink-0 bg-white/95 backdrop-blur-md rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-slate-300/40 flex flex-col overflow-hidden h-full w-[96px]">
          <div className="p-4 border-b border-slate-300/40 bg-slate-50/50 flex justify-center">
            <span className="material-symbols-outlined text-[24px] text-slate-600">photo_library</span>
          </div>
          
          <div className="grow overflow-y-auto p-3 flex flex-col gap-4 bg-slate-50/50 items-center">
            {state.isPreparingImages && (
              <div style={{ textAlign: 'center', color: '#9ca3af' }}>
                <div className="w-6 h-6 border-[3px] border-slate-200 border-t-blue-700 rounded-full animate-spin mx-auto mb-2.5"></div>
              </div>
            )}
            {!state.isPreparingImages && currentItems.map((item: any, idx: number) => {
              const isActive = String(item.id) === state.activePreparedItemId;
              const globalIdx = listPage * pageSize + idx;
              return (
                <button
                  key={item.id}
                  className={`relative cursor-pointer bg-transparent border-none p-0 outline-none group ${isActive ? "before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-1 before:bg-blue-700 before:rounded-r-full" : ""}`}
                  type="button"
                  onClick={() => updateState({ activePreparedItemId: String(item.id) })}
                  title={item.fileName || `passport-${globalIdx + 1}`}
                >
                  <img 
                    className={`w-16 h-20 object-cover rounded-lg transition-all duration-200 ${isActive ? 'border-2 border-blue-700 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06)]' : 'border border-slate-300/50 group-hover:border-blue-700'}`} 
                    src={thumbCache[item.id] || ''} 
                    alt={item.fileName || `Passport ${globalIdx + 1}`} 
                  />
                </button>
              );
            })}
          </div>

          {!state.isPreparingImages && totalPages > 1 && (
            <div className="flex justify-between items-center p-3 border-t border-slate-300/40">
              <button 
                onClick={() => setListPage(p => Math.max(0, p - 1))}
                disabled={listPage === 0}
                className={`flex items-center justify-center p-1 bg-transparent border-none text-blue-700 ${listPage === 0 ? 'opacity-30 cursor-default' : 'cursor-pointer hover:bg-blue-50 rounded'}`}
              >
                <span className="material-symbols-outlined text-[20px]">chevron_left</span>
              </button>
              <span className="text-[11px] font-semibold text-slate-700 whitespace-nowrap">
                {listPage + 1} / {totalPages}
              </span>
              <button 
                onClick={() => setListPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={listPage === totalPages - 1}
                className={`flex items-center justify-center p-1 bg-transparent border-none text-blue-700 ${listPage === totalPages - 1 ? 'opacity-30 cursor-default' : 'cursor-pointer hover:bg-blue-50 rounded'}`}
              >
                <span className="material-symbols-outlined text-[20px]">chevron_right</span>
              </button>
            </div>
          )}
        </aside>

        {/* Right Panel: Main Preview & Actions */}
        <section className="grow flex flex-col gap-6 h-full overflow-hidden w-full min-h-0">
          
          {/* Image Canvas */}
          <div className="grow bg-white/95 backdrop-blur-md rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-slate-300/40 relative overflow-hidden flex flex-col min-h-0">
            
            {/* Preview Area */}
            <div className="grow bg-slate-200/40 relative flex items-center justify-center overflow-hidden rounded-t-2xl p-6 min-h-0">
              <div className="absolute inset-0 z-0 opacity-[0.07] pointer-events-none bg-[linear-gradient(45deg,#94a3b8_25%,transparent_25%),linear-gradient(-45deg,#94a3b8_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#94a3b8_75%),linear-gradient(-45deg,transparent_75%,#94a3b8_75%)] bg-[size:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]"></div>
              
              {state.isPreparingImages && (
                <div className="flex flex-col items-center z-10">
                  <div className="w-12 h-12 border-4 mx-auto mb-2.5 border-slate-200 border-t-blue-700 rounded-full animate-spin"></div>
                  <h3 className="mt-5 text-slate-900 font-semibold text-lg">Menyiapkan Foto...</h3>
                  <p className="text-slate-700 mt-2">Mohon tunggu, sedang membaca dan memproses dokumen dari folder.</p>
                </div>
              )}
              
              {!state.isPreparingImages && !activeImageData.dataUrl && activeItem && (
                 <div className="flex flex-col items-center z-10 text-slate-700">
                   <div className="w-6 h-6 border-[3px] border-slate-200 border-t-blue-700 rounded-full animate-spin mx-auto mb-2.5"></div>
                   Memuat pratinjau gambar...
                 </div>
              )}
              
              {!state.isPreparingImages && !activeItem && (
                <div className="z-10 text-slate-700">Belum ada foto dipilih.</div>
              )}
              
              {!state.isPreparingImages && activeImageData.dataUrl && (
                <img 
                  className="max-w-full max-h-full object-contain relative z-10 drop-shadow-[0_10px_20px_rgba(0,0,0,0.15)] rounded-lg transition-transform duration-300 hover:scale-[1.02]" 
                  src={activeImageData.dataUrl} 
                  alt="Large passport preview" 
                />
              )}
            </div>
            
            {/* Image Action Bar */}
            {!state.isPreparingImages && activeItem && (
              <div className="bg-white/70 backdrop-blur-md border-b border-slate-300/30 absolute top-0 left-0 right-0 rounded-t-2xl p-4 flex justify-center gap-4 z-20">
                <button className="flex items-center gap-2 bg-white border border-slate-300/60 px-5 py-2 rounded-xl shadow-sm text-[14px] font-semibold text-slate-700 cursor-pointer transition-all duration-200 hover:bg-slate-200 hover:border-slate-400 hover:text-blue-700 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" onClick={() => setIsCropping(true)} disabled={!activeImageData.dataUrl}>
                  <span className="material-symbols-outlined text-[20px]">crop</span>
                  Crop Foto
                </button>
                <button className="flex items-center gap-2 bg-white border border-slate-300/60 px-5 py-2 rounded-xl shadow-sm text-[14px] font-semibold text-slate-700 cursor-pointer transition-all duration-200 hover:bg-slate-200 hover:border-slate-400 hover:text-blue-700 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" onClick={() => handleRotate(-90)} disabled={!activeImageData.dataUrl}>
                  <span className="material-symbols-outlined text-[20px]">rotate_left</span>
                  Rotasi Kiri
                </button>
                <button className="flex items-center gap-2 bg-white border border-slate-300/60 px-5 py-2 rounded-xl shadow-sm text-[14px] font-semibold text-slate-700 cursor-pointer transition-all duration-200 hover:bg-slate-200 hover:border-slate-400 hover:text-blue-700 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" onClick={() => handleRotate(90)} disabled={!activeImageData.dataUrl}>
                  <span className="material-symbols-outlined text-[20px]">rotate_right</span>
                  Rotasi Kanan
                </button>
                <button className="flex items-center gap-2 bg-red-600/5 border border-red-600/30 px-5 py-2 rounded-xl text-[14px] font-semibold text-red-700 cursor-pointer transition-all duration-200 hover:bg-red-700 hover:border-red-700 hover:text-white active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ml-4" onClick={() => setShowDeleteConfirm(true)} disabled={!activeImageData.dataUrl}>
                  <span className="material-symbols-outlined text-[20px]">delete</span>
                  Hapus Foto
                </button>
                
                {/* Find next item for "Berikutnya" */}
                {(() => {
                  const currentIndex = items.findIndex((i: any) => String(i.id) === state.activePreparedItemId);
                  const hasNext = currentIndex >= 0 && currentIndex < items.length - 1;
                  return (
                    <button 
                      className="flex items-center gap-2 bg-white border border-slate-300/60 px-5 py-2 rounded-xl shadow-sm text-[14px] font-semibold text-slate-700 cursor-pointer transition-all duration-200 hover:bg-slate-200 hover:border-slate-400 hover:text-blue-700 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ml-2" 
                      disabled={!hasNext}
                      onClick={() => {
                        if (hasNext) updateState({ activePreparedItemId: String(items[currentIndex + 1].id) });
                      }}
                    >
                      Berikutnya
                      <span className="material-symbols-outlined text-[20px]">navigate_next</span>
                    </button>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-slate-300/40 px-6 py-3 flex justify-between items-center shrink-0">
            <p className="font-medium text-[14px] text-slate-700 flex items-center gap-3 m-0">
              <span className="material-symbols-outlined text-blue-700/60 text-[20px]">info</span>
              Pastikan semua foto sudah terbaca jelas sebelum OCR dimulai.
            </p>
            {error && <div className="text-red-600 font-bold m-0 mb-2.5 text-sm p-2.5 bg-red-600/10 rounded-md border border-red-600/30">{error}</div>}
            <div className="flex gap-4">
              <button className="border border-slate-300/50 rounded-xl font-semibold text-[14px] text-slate-700 bg-white px-4 py-2 shadow-sm cursor-pointer transition-all duration-200 hover:bg-slate-100 hover:text-slate-900 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" type="button" onClick={() => updateState({ currentPage: 'import' })}>
                Kembali Folder
              </button>
              <button className="bg-blue-700 text-white rounded-xl font-bold text-[14px] px-5 py-2 flex items-center gap-2 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-1px_rgba(0,0,0,0.06)] cursor-pointer transition-all duration-200 border-none hover:shadow-[0_10px_15px_-3px_rgba(0,74,198,0.3),0_4px_6px_-2px_rgba(0,74,198,0.05)] hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed" type="button" onClick={handleStartScan} disabled={state.isScanning || state.isPreparingImages}>
                Start Scan
                <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
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
              <span className="material-symbols-outlined" style={{ color: '#ba1a1a', fontSize: '24px' }}>warning</span>
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
