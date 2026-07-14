import React, { useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

interface UpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UpdateDialog({ isOpen, onClose }: UpdateDialogProps) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'up-to-date'>('idle');
  const [updateInfo, setUpdateInfo] = useState<{ version: string; body: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updaterContext, setUpdaterContext] = useState<any>(null);

  if (!isOpen) return null;

  const handleCheckUpdate = async () => {
    setStatus('checking');
    try {
      const update = await check();
      if (update) {
        setUpdateInfo({
          version: update.version,
          body: update.body || 'Pembaruan baru tersedia.',
        });
        setUpdaterContext(update);
        setStatus('available');
      } else {
        setStatus('up-to-date');
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.toString());
      setStatus('error');
    }
  };

  const handleDownloadAndInstall = async () => {
    if (!updaterContext) return;
    setStatus('downloading');
    try {
      let downloaded = 0;
      let contentLength = 0;
      await updaterContext.downloadAndInstall((event: any) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setDownloadProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case 'Finished':
            break;
        }
      });
      setStatus('ready');
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.toString());
      setStatus('error');
    }
  };

  const handleRelaunch = async () => {
    await relaunch();
  };

  // Auto trigger check when modal opens if idle
  React.useEffect(() => {
    if (isOpen && status === 'idle') {
      handleCheckUpdate();
    }
  }, [isOpen]);

  // Reset status when modal closes
  React.useEffect(() => {
    if (!isOpen) {
      setTimeout(() => {
        setStatus('idle');
        setDownloadProgress(0);
        setErrorMsg('');
      }, 300);
    }
  }, [isOpen]);

  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <div className="modal-card">
        {/* Header */}
        <div className="modal-header">
          <span className="material-symbols-outlined text-blue-600">system_update</span>
          <h3>Pembaruan Aplikasi</h3>
        </div>

        {/* Body */}
        <div className="modal-body">
          {status === 'checking' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="material-symbols-outlined text-[32px] text-blue-500 animate-spin">refresh</span>
              <p>Sedang memeriksa pembaruan...</p>
            </div>
          )}

          {status === 'up-to-date' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="material-symbols-outlined text-[48px] text-emerald-500">check_circle</span>
              <div>
                <p className="font-medium text-slate-800 text-base mb-1">Aplikasi sudah versi terbaru</p>
                <p className="text-slate-500 text-xs">Anda sudah menggunakan versi terbaru EntryMate.</p>
              </div>
            </div>
          )}

          {status === 'available' && updateInfo && (
            <div className="flex flex-col gap-4">
              <div className="bg-blue-50 text-blue-800 p-4 rounded-xl">
                <p className="font-bold mb-1 text-base">Versi {updateInfo.version} tersedia!</p>
                <p className="text-sm opacity-90">{updateInfo.body}</p>
              </div>
              <p>Apakah Anda ingin mengunduh dan menginstal pembaruan ini sekarang?</p>
            </div>
          )}

          {status === 'downloading' && (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex justify-between text-sm font-medium">
                <span className="text-slate-700">Mengunduh pembaruan...</span>
                <span className="text-blue-600">{downloadProgress}%</span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${downloadProgress}%` }}
                ></div>
              </div>
              <p className="text-xs text-slate-400 text-center">Mohon jangan tutup aplikasi saat mengunduh.</p>
            </div>
          )}

          {status === 'ready' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="material-symbols-outlined text-[48px] text-emerald-500">rocket_launch</span>
              <div>
                <p className="font-bold text-slate-800 text-base mb-1">Pembaruan Siap!</p>
                <p className="text-slate-500 text-xs">Pembaruan telah diunduh dan siap diinstal. Aplikasi perlu dimuat ulang.</p>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="material-symbols-outlined text-[48px] text-red-500">error</span>
              <div>
                <p className="font-medium text-red-600 text-base mb-1">Gagal Memeriksa Pembaruan</p>
                <p className="text-slate-500 text-xs break-all">{errorMsg}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          {(status === 'checking' || status === 'up-to-date' || status === 'error' || status === 'available') && (
            <button 
              onClick={onClose}
              className="secondary-button"
            >
              {status === 'available' ? 'Nanti Saja' : 'Tutup'}
            </button>
          )}

          {status === 'available' && (
            <button 
              onClick={handleDownloadAndInstall}
              className="primary-action"
            >
              Unduh & Instal
            </button>
          )}

          {status === 'ready' && (
            <button 
              onClick={handleRelaunch}
              className="primary-action w-full !bg-emerald-600 hover:!bg-emerald-700"
            >
              Mulai Ulang Sekarang
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
