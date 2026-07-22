import React, { useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import AppIcon from './ui/AppIcon';

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
      setErrorMsg(e ? String(e) : 'Gagal memeriksa pembaruan.');
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
      setErrorMsg(e ? String(e) : 'Gagal mengunduh pembaruan.');
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

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
        {/* Header */}
        <div className="modal-header">
          <AppIcon name="system_update" className="text-blue-600" />
          <h3 id="update-dialog-title">Pembaruan aplikasi</h3>
        </div>

        {/* Body */}
        <div className="modal-body">
          {status === 'checking' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <AppIcon name="refresh" size={32} className="text-blue-500 animate-spin" />
              <p>Sedang memeriksa pembaruan...</p>
            </div>
          )}

          {status === 'up-to-date' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <AppIcon name="check_circle" size={48} className="text-emerald-500" />
              <div>
                <p className="type-body-strong text-slate-800 mb-1">Aplikasi sudah versi terbaru</p>
                <p className="text-slate-500 type-caption">Anda sudah menggunakan versi terbaru EntryMate.</p>
              </div>
            </div>
          )}

          {status === 'available' && updateInfo && (
            <div className="flex flex-col gap-4">
              <div className="bg-blue-50 text-blue-800 p-4 rounded-xl">
                <p className="type-body-strong mb-1">Versi {updateInfo.version} tersedia!</p>
                <p className="type-body opacity-90">{updateInfo.body}</p>
              </div>
              <p>Apakah Anda ingin mengunduh dan menginstal pembaruan ini sekarang?</p>
            </div>
          )}

          {status === 'downloading' && (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex justify-between type-body">
                <span className="text-slate-700">Mengunduh pembaruan...</span>
                <span className="text-blue-600">{downloadProgress}%</span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${downloadProgress}%` }}
                ></div>
              </div>
              <p className="type-caption text-slate-500 text-center">Mohon jangan tutup aplikasi saat mengunduh.</p>
            </div>
          )}

          {status === 'ready' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <AppIcon name="rocket_launch" size={48} className="text-emerald-500" />
              <div>
                <p className="type-body-strong text-slate-800 mb-1">Pembaruan siap!</p>
                <p className="text-slate-500 type-caption">Pembaruan telah diunduh dan siap diinstal. Aplikasi perlu dimuat ulang.</p>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <AppIcon name="error" size={48} className="text-red-500" />
              <div>
                <p className="type-body-strong text-red-600 mb-1">Gagal memeriksa pembaruan</p>
                <p className="text-slate-500 type-caption break-all">{errorMsg}</p>
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
