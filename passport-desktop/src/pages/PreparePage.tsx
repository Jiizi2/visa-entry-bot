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
  const [showEndorseConfirm, setShowEndorseConfirm] = useState(false);
  const [thumbCache, setThumbCache] = useState<Record<string, string>>({});
  const [listPage, setListPage] = useState(0);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBatchEndorseConfirm, setShowBatchEndorseConfirm] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

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
    currentItems.forEach((item: any) => {
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
  }, [currentItems]);

  const prepareImages = async () => {
    updateState({ isPreparingImages: true, statusHeadline: 'Menyiapkan foto' });
    try {
      const session = await invoke('prepare_passport_images', { 
        selectedDir: state.selectedDir,
        pdfBatchMode: state.pdfBatchMode || false
      });
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

  const handleEndorse = async () => {
    if (!activeItem) return;
    try {
      const session: any = await invoke('endorse_prepared_passport_image', {
        preparedManifestPath: state.preparedSession?.preparedManifestPath || '',
        itemId: String(activeItem.id),
      });
      const nextActive = session?.items?.length ? String(session.items[0].id) : '';
      updateState({ preparedSession: session, activePreparedItemId: nextActive });
      setShowEndorseConfirm(false);
    } catch (e) {
      setError(String(e));
      setShowEndorseConfirm(false);
    }
  };

  const handleBatchEndorse = async () => {
    if (selectedIds.length === 0) return;
    try {
      const session: any = await invoke('endorse_prepared_passport_images_batch', {
        preparedManifestPath: state.preparedSession?.preparedManifestPath || '',
        itemIds: selectedIds,
      });
      const nextActive = session?.items?.length ? String(session.items[0].id) : '';
      updateState({ preparedSession: session, activePreparedItemId: nextActive });
      setSelectedIds([]);
      setIsSelectMode(false);
      setShowBatchEndorseConfirm(false);
    } catch (e) {
      setError(String(e));
      setShowBatchEndorseConfirm(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      const session: any = await invoke('remove_prepared_passport_images_batch', {
        preparedManifestPath: state.preparedSession?.preparedManifestPath || '',
        itemIds: selectedIds,
      });
      const nextActive = session?.items?.length ? String(session.items[0].id) : '';
      updateState({ preparedSession: session, activePreparedItemId: nextActive });
      setSelectedIds([]);
      setIsSelectMode(false);
      setShowBatchDeleteConfirm(false);
    } catch (e) {
      setError(String(e));
      setShowBatchDeleteConfirm(false);
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

  const getFileSizeInfo = (dataUrl: string) => {
    if (!dataUrl || !dataUrl.includes('base64,')) return { bytes: 0, formatted: '0 KB', isOversize: false };
    const base64str = dataUrl.split('base64,')[1];
    const bytes = Math.round(base64str.length * 0.75);
    const mb = bytes / 1000000;
    const formatted = mb >= 1 ? `${mb.toFixed(2)} MB` : `${Math.round(bytes / 1000)} KB`;
    return { bytes, formatted, isOversize: bytes > 1000000 };
  };

  const handleCompress = async () => {
    if (!activeItem || !activeImageData.dataUrl) return;
    updateState({ statusHeadline: 'Mengkompresi foto...' });
    try {
      const img = new Image();
      img.src = activeImageData.dataUrl;
      await new Promise((resolve) => { img.onload = resolve; });
      
      const canvas = document.createElement("canvas");
      let width = img.naturalWidth;
      let height = img.naturalHeight;
      if (width > 1600) {
        height = Math.round((height * 1600) / width);
        width = 1600;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Canvas error");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      
      const newUrl = canvas.toDataURL("image/jpeg", 0.7);
      
      const session = await invoke('save_prepared_passport_image', {
        preparedManifestPath: state.preparedSession?.preparedManifestPath || '',
        itemId: String(activeItem.id),
        sourceImagePath: getEffectiveImagePath(activeItem),
        dataUrl: newUrl,
        crop: { operation: 'compress', sourceImagePath: getEffectiveImagePath(activeItem) },
        rotationDegrees: Number(activeItem.rotationDegrees || 0),
      });
      updateState({ preparedSession: session, statusHeadline: 'Kompresi berhasil' });
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section id="page-prepare" className="page-container">
      <header className="app-page-header">
        <div className="app-page-header-left">
          <div className="app-page-header-icon">
            <span className="material-symbols-outlined">crop</span>
          </div>
          <div className="app-page-header-info">
            <span className="app-page-step-label">LANGKAH 2: SIAPKAN FOTO</span>
            <h1 className="app-page-title">Rapikan Foto Passport</h1>
            <p className="app-page-subtitle">Putar, potong (crop), atau kompres foto agar teks terbaca jelas oleh OCR.</p>
          </div>
        </div>
      </header>

      <div className="flex w-full max-w-[1200px] mx-auto gap-6 flex-1 min-h-0 p-0">
        
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
              const isSelected = selectedIds.includes(String(item.id));
              const globalIdx = listPage * pageSize + idx;
              return (
                <button
                  key={item.id}
                  className={`relative cursor-pointer bg-transparent border-none p-0 outline-none group ${isActive && !isSelectMode ? "before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-1 before:bg-blue-700 before:rounded-r-full" : ""}`}
                  type="button"
                  onClick={() => {
                    if (isSelectMode) {
                      const itemIdStr = String(item.id);
                      setSelectedIds(prev => 
                        prev.includes(itemIdStr) 
                          ? prev.filter(id => id !== itemIdStr) 
                          : [...prev, itemIdStr]
                      );
                    } else {
                      updateState({ activePreparedItemId: String(item.id) });
                    }
                  }}
                  title={item.fileName || `passport-${globalIdx + 1}`}
                >
                  <div className="relative">
                    <img 
                      className={`w-16 h-20 object-cover rounded-lg transition-all duration-200 ${
                        isSelectMode 
                          ? (isSelected ? 'border-2 border-blue-700 shadow-md ring-2 ring-blue-100' : 'border border-slate-300 opacity-60 hover:opacity-100 hover:border-slate-400')
                          : (isActive ? 'border-2 border-blue-700 shadow-md' : 'border border-slate-300/50 group-hover:border-blue-700')
                      }`} 
                      src={thumbCache[item.id] || ''} 
                      alt={item.fileName || `Passport ${globalIdx + 1}`} 
                    />
                    {isSelectMode && (
                      <div className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center border shadow-sm transition-all duration-200 ${
                        isSelected 
                          ? 'bg-blue-700 border-blue-700 text-white' 
                          : 'bg-white border-slate-300 text-slate-400'
                      }`}>
                        {isSelected ? (
                          <span className="material-symbols-outlined text-[10px] font-bold">check</span>
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-200"></div>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {!state.isPreparingImages && totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 p-3 border-t border-slate-300/40">
              <button 
                onClick={() => setListPage(p => Math.max(0, p - 1))}
                disabled={listPage === 0}
                className={`flex items-center justify-center w-6 h-6 bg-transparent border-none text-blue-700 ${listPage === 0 ? 'opacity-30 cursor-default' : 'cursor-pointer hover:bg-blue-50 rounded-md'}`}
              >
                <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>
              <span className="text-[11px] font-semibold text-slate-700 whitespace-nowrap min-w-[32px] text-center">
                {listPage + 1} / {totalPages}
              </span>
              <button 
                onClick={() => setListPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={listPage === totalPages - 1}
                className={`flex items-center justify-center w-6 h-6 bg-transparent border-none text-blue-700 ${listPage === totalPages - 1 ? 'opacity-30 cursor-default' : 'cursor-pointer hover:bg-blue-50 rounded-md'}`}
              >
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
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
                <>
                  {(() => {
                    const info = getFileSizeInfo(activeImageData.dataUrl);
                    return (
                      <div className={`absolute bottom-4 right-4 z-20 px-3 py-1.5 rounded-lg text-[13px] font-bold shadow-sm backdrop-blur-md flex items-center gap-1.5 ${info.isOversize ? 'bg-red-500/90 text-white' : 'bg-green-500/90 text-white'}`}>
                        <span className="material-symbols-outlined text-[16px]">{info.isOversize ? 'warning' : 'check_circle'}</span>
                        {info.formatted} {info.isOversize && '(> 1 MB)'}
                      </div>
                    );
                  })()}
                  <img 
                    className="max-w-full max-h-full object-contain relative z-10 drop-shadow-[0_10px_20px_rgba(0,0,0,0.15)] rounded-lg transition-transform duration-300 hover:scale-[1.02]" 
                    src={activeImageData.dataUrl} 
                    alt="Large passport preview" 
                  />
                </>
              )}
            </div>
            
            {/* Image Action Bar */}
            {!state.isPreparingImages && (
              isSelectMode ? (
                <div className="bg-white/90 backdrop-blur-md border-b border-slate-300/30 absolute top-0 left-0 right-0 rounded-t-2xl p-3 flex flex-wrap items-center justify-center gap-2 z-20">
                  <button 
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setIsSelectMode(false);
                      setSelectedIds([]);
                    }}
                  >
                    <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                    Batal
                  </button>
                  <span className="text-[13px] font-bold text-slate-700 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg border border-blue-100 h-10 flex items-center">
                    {selectedIds.length} terpilih
                  </span>

                  <div className="h-5 w-px bg-slate-300/60 mx-1"></div>

                  <button 
                    className="secondary-button"
                    type="button"
                    onClick={() => setSelectedIds(items.map((i: any) => String(i.id)))}
                  >
                    <span className="material-symbols-outlined text-[18px]">select_all</span>
                    Semua
                  </button>
                  <button 
                    className="secondary-button"
                    type="button"
                    disabled={selectedIds.length === 0}
                    onClick={() => setSelectedIds([])}
                  >
                    <span className="material-symbols-outlined text-[18px]">deselect</span>
                    Bersihkan
                  </button>

                  <div className="h-5 w-px bg-slate-300/60 mx-1"></div>

                  <button 
                    className="primary-action !bg-amber-600 hover:!bg-amber-700"
                    type="button"
                    disabled={selectedIds.length === 0}
                    onClick={() => setShowBatchEndorseConfirm(true)}
                  >
                    <span className="material-symbols-outlined text-[18px]">folder_special</span>
                    Endorsement ({selectedIds.length})
                  </button>
                  <button 
                    className="primary-action !bg-red-600 hover:!bg-red-700"
                    type="button"
                    disabled={selectedIds.length === 0}
                    onClick={() => setShowBatchDeleteConfirm(true)}
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                    Hapus ({selectedIds.length})
                  </button>
                </div>
              ) : (
                activeItem && (
                  <div className="bg-white/80 backdrop-blur-md border-b border-slate-300/30 absolute top-0 left-0 right-0 rounded-t-2xl p-3 flex flex-wrap items-center justify-center gap-2 z-20">
                    <button className="secondary-button !text-blue-700 !bg-blue-50 hover:!bg-blue-100" type="button" onClick={() => {
                      setIsSelectMode(true);
                      setSelectedIds([]);
                    }}>
                      <span className="material-symbols-outlined text-[18px]">checklist</span>
                      Pilih Banyak
                    </button>
                    <div className="h-5 w-px bg-slate-300/60 mx-1"></div>
                    
                    <button className="secondary-button" onClick={() => setIsCropping(true)} disabled={!activeImageData.dataUrl}>
                      <span className="material-symbols-outlined text-[18px]">crop</span>
                      Crop
                    </button>

                    {/* Rotation Group */}
                    <div className="flex border border-slate-300/60 rounded-lg overflow-hidden shadow-sm bg-white h-10">
                      <button className="flex items-center justify-center w-9 h-full text-slate-700 hover:bg-slate-100 hover:text-blue-700 active:scale-95 cursor-pointer border-none border-r border-slate-200 disabled:opacity-40" onClick={() => handleRotate(-90)} disabled={!activeImageData.dataUrl} title="Putar Kiri">
                        <span className="material-symbols-outlined text-[18px]">rotate_left</span>
                      </button>
                      <button className="flex items-center justify-center w-9 h-full text-slate-700 hover:bg-slate-100 hover:text-blue-700 active:scale-95 cursor-pointer border-none disabled:opacity-40" onClick={() => handleRotate(90)} disabled={!activeImageData.dataUrl} title="Putar Kanan">
                        <span className="material-symbols-outlined text-[18px]">rotate_right</span>
                      </button>
                    </div>

                    <button className="secondary-button" onClick={() => setShowEndorseConfirm(true)} disabled={!activeImageData.dataUrl}>
                      <span className="material-symbols-outlined text-[18px]">folder_special</span>
                      Endorsement
                    </button>

                    {activeImageData.dataUrl && getFileSizeInfo(activeImageData.dataUrl).isOversize && (
                      <button className="secondary-button !text-amber-700 !bg-amber-50 hover:!bg-amber-100" onClick={handleCompress}>
                        <span className="material-symbols-outlined text-[18px]">compress</span>
                        Kompres
                      </button>
                    )}

                    <button className="secondary-button !text-red-700 !bg-red-50 hover:!bg-red-100" onClick={() => setShowDeleteConfirm(true)} disabled={!activeImageData.dataUrl}>
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                      Hapus
                    </button>
                    
                    {/* Find next item for "Berikutnya" */}
                    {(() => {
                      const currentIndex = items.findIndex((i: any) => String(i.id) === state.activePreparedItemId);
                      const hasNext = currentIndex >= 0 && currentIndex < items.length - 1;
                      return (
                        <button 
                          className="secondary-button" 
                          type="button"
                          disabled={!hasNext}
                          onClick={() => {
                            if (hasNext) updateState({ activePreparedItemId: String(items[currentIndex + 1].id) });
                          }}
                        >
                          Berikutnya
                          <span className="material-symbols-outlined text-[18px]">navigate_next</span>
                        </button>
                      );
                    })()}
                  </div>
                )
              )
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
              <button className="secondary-button" type="button" onClick={() => updateState({ currentPage: 'import' })}>
                Kembali Folder
              </button>
              <button className="primary-action" type="button" onClick={handleStartScan} disabled={state.isScanning || state.isPreparingImages}>
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
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <span className="material-symbols-outlined text-red-600">warning</span>
              <h3>Konfirmasi Hapus</h3>
            </div>
            <div className="modal-body">
              <p>Apakah Anda yakin ingin menghapus foto ini? Tindakan ini tidak dapat dibatalkan.</p>
            </div>
            <div className="modal-footer">
              <button className="secondary-button" onClick={() => setShowDeleteConfirm(false)}>
                Batal
              </button>
              <button className="primary-action !bg-red-600 hover:!bg-red-700" onClick={handleDelete}>
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Endorsement Confirm */}
      {showEndorseConfirm && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <span className="material-symbols-outlined text-amber-600">folder_special</span>
              <h3>Konfirmasi Endorsement</h3>
            </div>
            <div className="modal-body">
              <p>
                Apakah Anda yakin ingin menjadikan foto ini sebagai Endorsement? Foto ini tidak akan discan, tapi akan disimpan di folder terpisah (<code className="bg-slate-100 px-1 py-0.5 rounded text-[13px]">endorsement-images</code>) sehingga bisa Anda lihat kembali.
              </p>
            </div>
            <div className="modal-footer">
              <button className="secondary-button" onClick={() => setShowEndorseConfirm(false)}>
                Batal
              </button>
              <button className="primary-action !bg-amber-600 hover:!bg-amber-700" onClick={handleEndorse}>
                Pindahkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Batch Endorsement Confirm */}
      {showBatchEndorseConfirm && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <span className="material-symbols-outlined text-amber-600">folder_special</span>
              <h3>Konfirmasi Endorsement Masal</h3>
            </div>
            <div className="modal-body">
              <p>
                Apakah Anda yakin ingin menjadikan <strong>{selectedIds.length} foto</strong> terpilih sebagai Endorsement? Foto-foto ini tidak akan discan, tapi akan disimpan di folder terpisah (<code className="bg-slate-100 px-1 py-0.5 rounded text-[13px]">endorsement-images</code>) sehingga bisa Anda lihat kembali.
              </p>
            </div>
            <div className="modal-footer">
              <button className="secondary-button" onClick={() => setShowBatchEndorseConfirm(false)}>
                Batal
              </button>
              <button className="primary-action !bg-amber-600 hover:!bg-amber-700" onClick={handleBatchEndorse}>
                Pindahkan Semua
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Batch Delete Confirm */}
      {showBatchDeleteConfirm && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <span className="material-symbols-outlined text-red-600">warning</span>
              <h3>Konfirmasi Hapus Masal</h3>
            </div>
            <div className="modal-body">
              <p>Apakah Anda yakin ingin menghapus <strong>{selectedIds.length} foto</strong> terpilih? Tindakan ini tidak dapat dibatalkan.</p>
            </div>
            <div className="modal-footer">
              <button className="secondary-button" onClick={() => setShowBatchDeleteConfirm(false)}>
                Batal
              </button>
              <button className="primary-action !bg-red-600 hover:!bg-red-700" onClick={handleBatchDelete}>
                Hapus Semua
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
