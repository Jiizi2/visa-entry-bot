import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import CropTool, { CropRect } from '../components/CropTool';
import { getEffectiveImagePath } from '../utils/paths';
import AppIcon from '../components/ui/AppIcon';

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
    <section id="page-prepare" className="page-container prepare-page">
      <header className="app-page-header">
        <div className="app-page-header-left">
          <div className="app-page-header-icon">
            <AppIcon name="crop" size={20} />
          </div>
          <div className="app-page-header-info">
            <span className="app-page-step-label">Langkah 2 · Siapkan foto</span>
            <h1 className="app-page-title">Rapikan foto passport</h1>
            <p className="app-page-subtitle">Putar, potong (crop), atau kompres foto agar teks terbaca jelas oleh OCR.</p>
          </div>
        </div>
      </header>

      <div className="prepare-workspace">
        
        {/* Left Panel: Photo List */}
        <aside className="prepare-queue workstation-pane" aria-label="Daftar foto passport">
          <div className="p-4 border-b border-slate-300/40 bg-slate-50/50 flex justify-center">
            <AppIcon name="photo_library" size={24} className="text-slate-600" />
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
                          <AppIcon name="check" size={10} strokeWidth={3} />
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
                aria-label="Halaman foto sebelumnya"
                className={`flex items-center justify-center w-6 h-6 bg-transparent border-none text-blue-700 ${listPage === 0 ? 'opacity-30 cursor-default' : 'cursor-pointer hover:bg-blue-50 rounded-md'}`}
              >
                <AppIcon name="chevron_left" size={18} />
              </button>
              <span className="type-caption-strong text-slate-700 whitespace-nowrap min-w-[32px] text-center">
                {listPage + 1} / {totalPages}
              </span>
              <button 
                onClick={() => setListPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={listPage === totalPages - 1}
                aria-label="Halaman foto berikutnya"
                className={`flex items-center justify-center w-6 h-6 bg-transparent border-none text-blue-700 ${listPage === totalPages - 1 ? 'opacity-30 cursor-default' : 'cursor-pointer hover:bg-blue-50 rounded-md'}`}
              >
                <AppIcon name="chevron_right" size={18} />
              </button>
            </div>
          )}
        </aside>

        {/* Right Panel: Main Preview & Actions */}
        <section className="prepare-stage">
          
          {/* Image Canvas */}
          <div className="prepare-viewer workstation-pane">
            
            {/* Preview Area */}
            <div className="prepare-canvas">
              <div className="absolute inset-0 z-0 opacity-[0.07] pointer-events-none bg-[linear-gradient(45deg,#94a3b8_25%,transparent_25%),linear-gradient(-45deg,#94a3b8_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#94a3b8_75%),linear-gradient(-45deg,transparent_75%,#94a3b8_75%)] bg-[size:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]"></div>
              
              {state.isPreparingImages && (
                <div className="flex flex-col items-center z-10">
                  <div className="w-12 h-12 border-4 mx-auto mb-2.5 border-slate-200 border-t-blue-700 rounded-full animate-spin"></div>
                  <h3 className="mt-5 text-slate-900 type-body-large-strong">Menyiapkan foto...</h3>
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
                      <div className={`absolute bottom-4 right-4 z-20 px-3 py-1.5 rounded-lg type-body-strong shadow-sm backdrop-blur-md flex items-center gap-1.5 ${info.isOversize ? 'bg-red-500/90 text-white' : 'bg-green-500/90 text-white'}`}>
                        <AppIcon name={info.isOversize ? 'warning' : 'check_circle'} size={16} />
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
                <div className="prepare-action-bar workstation-toolbar" aria-label="Aksi pilihan foto">
                  <button 
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setIsSelectMode(false);
                      setSelectedIds([]);
                    }}
                  >
                    <AppIcon name="arrow_back" size={18} />
                    Batal
                  </button>
                  <span className="type-body-strong text-slate-700 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg border border-blue-100 h-10 flex items-center">
                    {selectedIds.length} terpilih
                  </span>

                  <div className="h-5 w-px bg-slate-300/60 mx-1"></div>

                  <button 
                    className="secondary-button"
                    type="button"
                    onClick={() => setSelectedIds(items.map((i: any) => String(i.id)))}
                  >
                    <AppIcon name="select_all" size={18} />
                    Semua
                  </button>
                  <button 
                    className="secondary-button"
                    type="button"
                    disabled={selectedIds.length === 0}
                    onClick={() => setSelectedIds([])}
                  >
                    <AppIcon name="deselect" size={18} />
                    Bersihkan
                  </button>

                  <div className="h-5 w-px bg-slate-300/60 mx-1"></div>

                  <button 
                    className="primary-action !bg-amber-600 hover:!bg-amber-700"
                    type="button"
                    disabled={selectedIds.length === 0}
                    onClick={() => setShowBatchEndorseConfirm(true)}
                  >
                    <AppIcon name="folder_special" size={18} />
                    Endorsement ({selectedIds.length})
                  </button>
                  <button 
                    className="primary-action !bg-red-600 hover:!bg-red-700"
                    type="button"
                    disabled={selectedIds.length === 0}
                    onClick={() => setShowBatchDeleteConfirm(true)}
                  >
                    <AppIcon name="delete" size={18} />
                    Hapus ({selectedIds.length})
                  </button>
                </div>
              ) : (
                activeItem && (
                  <div className="prepare-action-bar workstation-toolbar" aria-label="Alat foto">
                    <button className="secondary-button !text-blue-700 !bg-blue-50 hover:!bg-blue-100" type="button" onClick={() => {
                      setIsSelectMode(true);
                      setSelectedIds([]);
                    }}>
                      <AppIcon name="checklist" size={18} />
                      Pilih Banyak
                    </button>
                    <div className="h-5 w-px bg-slate-300/60 mx-1"></div>
                    
                    <button className="secondary-button" onClick={() => setIsCropping(true)} disabled={!activeImageData.dataUrl}>
                      <AppIcon name="crop" size={18} />
                      Crop
                    </button>

                    {/* Rotation Group */}
                    <div className="flex border border-slate-300/60 rounded-lg overflow-hidden shadow-sm bg-white h-10">
                      <button className="flex items-center justify-center w-9 h-full text-slate-700 hover:bg-slate-100 hover:text-blue-700 active:scale-95 cursor-pointer border-none border-r border-slate-200 disabled:opacity-40" onClick={() => handleRotate(-90)} disabled={!activeImageData.dataUrl} title="Putar Kiri">
                        <AppIcon name="rotate_left" size={18} />
                      </button>
                      <button className="flex items-center justify-center w-9 h-full text-slate-700 hover:bg-slate-100 hover:text-blue-700 active:scale-95 cursor-pointer border-none disabled:opacity-40" onClick={() => handleRotate(90)} disabled={!activeImageData.dataUrl} title="Putar Kanan">
                        <AppIcon name="rotate_right" size={18} />
                      </button>
                    </div>

                    <button className="secondary-button" onClick={() => setShowEndorseConfirm(true)} disabled={!activeImageData.dataUrl}>
                      <AppIcon name="folder_special" size={18} />
                      Endorsement
                    </button>

                    {activeImageData.dataUrl && getFileSizeInfo(activeImageData.dataUrl).isOversize && (
                      <button className="secondary-button !text-amber-700 !bg-amber-50 hover:!bg-amber-100" onClick={handleCompress}>
                        <AppIcon name="compress" size={18} />
                        Kompres
                      </button>
                    )}

                    <button className="secondary-button !text-red-700 !bg-red-50 hover:!bg-red-100" onClick={() => setShowDeleteConfirm(true)} disabled={!activeImageData.dataUrl}>
                      <AppIcon name="delete" size={18} />
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
                          <AppIcon name="navigate_next" size={18} />
                        </button>
                      );
                    })()}
                  </div>
                )
              )
            )}
          </div>

          {/* Footer Actions */}
          <div className="prepare-footer">
            <p className="type-body text-slate-700 flex items-center gap-3 m-0">
              <AppIcon name="info" size={20} className="text-blue-700/60" />
              Pastikan semua foto sudah terbaca jelas sebelum OCR dimulai.
            </p>
            {error && <div className="text-red-600 type-body-strong m-0 mb-2.5 p-2.5 bg-red-600/10 rounded-md border border-red-600/30">{error}</div>}
            <div className="flex gap-4">
              <button className="secondary-button" type="button" onClick={() => updateState({ currentPage: 'import' })}>
                Kembali Folder
              </button>
              <button className="primary-action" type="button" onClick={handleStartScan} disabled={state.isScanning || state.isPreparingImages}>
                Start Scan
                <AppIcon name="arrow_forward" size={20} />
              </button>
            </div>
          </div>
          
        </section>
      </div>

      {isCropping && activeImageData.dataUrl && (
        <CropTool
          imageSrc={activeImageData.dataUrl}
          onSave={handleSaveCrop}
          onCancel={() => setIsCropping(false)}
        />
      )}

      {showDeleteConfirm && (
        <div className="modal-overlay">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="prepare-delete-title">
            <div className="modal-header">
              <AppIcon name="warning" className="text-red-600" />
              <h3 id="prepare-delete-title">Konfirmasi hapus</h3>
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
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="prepare-endorse-title">
            <div className="modal-header">
              <AppIcon name="folder_special" className="text-amber-600" />
              <h3 id="prepare-endorse-title">Konfirmasi endorsement</h3>
            </div>
            <div className="modal-body">
              <p>
                Apakah Anda yakin ingin menjadikan foto ini sebagai Endorsement? Foto ini tidak akan discan, tapi akan disimpan di folder terpisah (<code className="bg-slate-100 px-1 py-0.5 rounded font-mono type-caption">endorsement-images</code>) sehingga bisa Anda lihat kembali.
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
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="prepare-batch-endorse-title">
            <div className="modal-header">
              <AppIcon name="folder_special" className="text-amber-600" />
              <h3 id="prepare-batch-endorse-title">Konfirmasi endorsement massal</h3>
            </div>
            <div className="modal-body">
              <p>
                Apakah Anda yakin ingin menjadikan <strong>{selectedIds.length} foto</strong> terpilih sebagai Endorsement? Foto-foto ini tidak akan discan, tapi akan disimpan di folder terpisah (<code className="bg-slate-100 px-1 py-0.5 rounded font-mono type-caption">endorsement-images</code>) sehingga bisa Anda lihat kembali.
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
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="prepare-batch-delete-title">
            <div className="modal-header">
              <AppIcon name="warning" className="text-red-600" />
              <h3 id="prepare-batch-delete-title">Konfirmasi hapus massal</h3>
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
