import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import AppIcon from '../components/ui/AppIcon';

const formatTime = (totalSeconds: number) => {
  if (totalSeconds === undefined || totalSeconds === null || isNaN(totalSeconds) || totalSeconds < 0) return '--:--';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

type FriendlyScanStage = {
  title: string;
  description: string;
  step: number;
};

const journeySteps = [
  { title: 'Menyiapkan dokumen', description: 'Memastikan foto siap dibaca.' },
  { title: 'Membaca informasi', description: 'Mengambil data penting passport.' },
  { title: 'Memeriksa hasil', description: 'Menyiapkan data untuk direview.' },
];

const friendlyStageFor = (
  stageCode: string,
  rawLabel: string,
  isScanning: boolean,
  isFinished: boolean,
): FriendlyScanStage => {
  if (isFinished) {
    return {
      title: 'Semua passport sudah selesai',
      description: 'Hasil scan sedang disiapkan dan halaman Review akan segera terbuka.',
      step: 2,
    };
  }

  const normalizedCode = String(stageCode || '').toLowerCase();
  const normalizedLabel = String(rawLabel || '').toLowerCase();

  if (normalizedCode === 'error' || /gagal|error/.test(normalizedLabel)) {
    return {
      title: 'Scan mengalami kendala',
      description: 'Proses tidak dapat dilanjutkan. Kembali ke Prepare untuk memeriksa dokumen dan mencoba lagi.',
      step: 2,
    };
  }

  if (!isScanning) {
    if (normalizedCode !== 'stopped' && !/henti/.test(normalizedLabel)) {
      return {
        title: 'Scan siap dimulai',
        description: 'Pilih dokumen dari halaman Prepare untuk memulai proses scan otomatis.',
        step: 0,
      };
    }

    return {
      title: 'Proses scan berhenti',
      description: 'Sebagian dokumen mungkin belum selesai. Anda dapat kembali ke Prepare untuk mencoba lagi.',
      step: 0,
    };
  }

  if (normalizedCode === 'start' || /menyiapkan/.test(normalizedLabel)) {
    return {
      title: 'Menyiapkan dokumen',
      description: 'Foto passport sedang disiapkan agar informasi di dalamnya dapat dibaca dengan jelas.',
      step: 0,
    };
  }

  if (normalizedCode === 'validate' || /validasi|memeriksa/.test(normalizedLabel)) {
    return {
      title: 'Memeriksa hasil pembacaan',
      description: 'Data yang sudah dibaca sedang diperiksa sebelum ditampilkan di halaman Review.',
      step: 2,
    };
  }

  if (normalizedCode === 'complete') {
    return {
      title: 'Dokumen ini sudah selesai',
      description: 'Hasilnya sudah disimpan. EntryMate akan melanjutkan ke dokumen berikutnya.',
      step: 2,
    };
  }

  return {
    title: 'Membaca informasi passport',
    description: 'Nama, nomor passport, dan tanggal penting sedang dibaca secara otomatis.',
    step: 1,
  };
};

export default function ScanPage() {
  const isScanning = useStore(s => s.isScanning);
  const progressTotal = useStore(s => s.progressTotal);
  const progressCurrent = useStore(s => s.progressCurrent);
  const selectedDir = useStore(s => s.selectedDir);
  const progressStageLabel = useStore(s => s.progressStageLabel);
  const progressFileName = useStore(s => s.progressFileName);
  const totalFiles = useStore(s => s.totalFiles);
  const updateState = useStore(s => s.updateState);

  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [currentStageCode, setCurrentStageCode] = useState('start');

  useEffect(() => {
    let interval: number | undefined;
    if (isScanning) {
      interval = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isScanning]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupListener = async () => {
      unlisten = await listen('scan-event', (event) => {
        const payload: any = event.payload;

        switch (payload.event) {
          case 'scan_started':
            setElapsedSeconds(0);
            setCurrentStageCode('start');
            updateState({
              isScanning: true,
              totalFiles: Number(payload.totalFiles ?? 0),
              progressTotal: Number(payload.totalFiles ?? 0),
              progressCurrent: 0,
              progressFileName: '',
              progressStageLabel: 'Menyiapkan antrean scan',
            });
            break;
          case 'scan_stage':
            setCurrentStageCode(String(payload.stage || 'reading'));
            updateState({
              isScanning: true,
              progressCurrent: Number(payload.current ?? 0) + Number(payload.fileProgress ?? 0),
              progressTotal: Number(payload.total ?? progressTotal ?? 0),
              progressFileName: payload.fileName ?? '',
              progressStageLabel: payload.message ?? 'Sedang bekerja',
            });
            break;
          case 'scan_progress':
            setCurrentStageCode(
              Number(payload.current ?? 0) >= Number(payload.total ?? progressTotal ?? 0) ? 'complete' : 'start',
            );
            updateState({
              isScanning: true,
              progressCurrent: Number(payload.current ?? 0),
              progressTotal: Number(payload.total ?? progressTotal ?? 0),
              progressFileName: payload.fileName ?? '',
              progressStageLabel: 'Memproses ' + (payload.fileName ?? ''),
            });
            break;
          case 'scan_complete': {
            const manifestPath = payload.manifestPath ?? '';
            setCurrentStageCode('complete');
            updateState({
              isScanning: false,
              manifestPath,
              resultDir: payload.groupDir ?? '',
              resultSourceDir: selectedDir,
              totalFiles: Number(payload.totalFiles ?? 0),
              validCount: Number(payload.validCount ?? 0),
              errorCount: Number(payload.errorCount ?? 0),
              reviewCount: Number(payload.reviewCount ?? 0),
              progressCurrent: Number(payload.totalFiles ?? 0),
              progressTotal: Number(payload.totalFiles ?? 0),
              progressStageLabel: 'Semua file selesai',
            });
            
            // Load manifest automatically
            if (manifestPath) {
              invoke('load_manifest', { manifestPath }).then((manifest: any) => {
                const members = manifest?.members || [];
                updateState({
                  manifest,
                  originalManifest: JSON.parse(JSON.stringify(manifest)),
                  activeMemberId: members.length > 0 ? members[0].id : '',
                  currentPage: 'validation',
                });
              }).catch((e) => {
                console.error("Gagal load manifest:", e);
                updateState({ currentPage: 'validation' });
              });
            } else {
              updateState({ currentPage: 'validation' });
            }
            break;
          }
          case 'scan_error':
          case 'scan_failed':
          case 'scan_stopped':
            setCurrentStageCode(payload.event === 'scan_stopped' ? 'stopped' : 'error');
            updateState({ isScanning: false, progressStageLabel: payload.message ?? 'Proses gagal atau dihentikan' });
            break;
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [progressTotal, selectedDir, updateState]);

  const handleStopScan = async () => {
    try {
      await invoke('stop_scan');
    } catch (e) {
      console.error(e);
    }
  };

  const displayTotal = progressTotal || totalFiles || 0;
  const completedCount = Math.min(displayTotal, Math.max(0, Math.floor(progressCurrent)));
  const remainingCount = Math.max(0, displayTotal - completedCount);
  const isFinished = !isScanning && progressCurrent >= progressTotal && progressTotal > 0;
  const currentDocumentNumber = displayTotal > 0
    ? Math.min(displayTotal, isScanning ? completedCount + 1 : completedCount)
    : 0;
  const progressPercent = displayTotal > 0 ? Math.round((progressCurrent / displayTotal) * 100) : 0;
  const friendlyStage = friendlyStageFor(currentStageCode, progressStageLabel, isScanning, isFinished);

  let estRemainingText = '--:--';
  if (isFinished) {
    estRemainingText = '00:00';
  } else if (isScanning && progressCurrent > 0 && progressTotal > 0) {
    const timePerItem = elapsedSeconds / progressCurrent;
    const remainingItems = progressTotal - progressCurrent;
    estRemainingText = formatTime(remainingItems * timePerItem);
  }

  return (
    <section id="page-scan" className="page-container scan-page">
      <header className="app-page-header">
        <div className="app-page-header-left">
          <div className="app-page-header-icon">
            <AppIcon name="scan" size={20} />
          </div>
          <div className="app-page-header-info">
            <span className="app-page-step-label">Langkah 3 · Proses passport</span>
            <h1 className="app-page-title">{friendlyStage.title}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {displayTotal > 0 && <span className="status-chip info">{completedCount}/{displayTotal} selesai</span>}
          {isScanning && (
            <button className="secondary-button !text-red-700" type="button" onClick={handleStopScan}>
              <AppIcon name="stop" size={17} />
              Hentikan
            </button>
          )}
        </div>
      </header>

      <div className="scan-workspace">
        <section className={`scan-hero ${isScanning ? 'is-running' : isFinished ? 'is-finished' : 'is-idle'}`} aria-live="polite">
          <div className="scan-hero__content">
            <div className="scan-hero__eyebrow">
              <span className="scan-hero__pulse" aria-hidden="true" />
              {isFinished ? 'Semua dokumen selesai' : isScanning ? 'Scan sedang berjalan' : 'Scan tidak berjalan'}
            </div>

            <div className="scan-hero__headline">
              <div>
                <span>Dokumen saat ini</span>
                <h2>{progressFileName || 'Menyiapkan dokumen pertama'}</h2>
                <p>{friendlyStage.description}</p>
              </div>
              <div className="scan-hero__percent" aria-hidden="true">
                <div><strong>{progressPercent}</strong><span>%</span></div>
                <small>{completedCount} dari {displayTotal} selesai</small>
              </div>
            </div>

            <div
              className="scan-progress-track"
              role="progressbar"
              aria-label={`${completedCount} dari ${displayTotal} passport selesai diproses`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <div className="scan-progress-track__fill" style={{ width: `${Math.min(100, progressPercent)}%` }}>
                {isScanning && <span className="scan-progress-track__glow" />}
              </div>
            </div>

            <div className="scan-hero__timing">
              <div>
                <AppIcon name="schedule" size={17} />
                <span>Waktu berjalan<strong>{isScanning || elapsedSeconds > 0 ? formatTime(elapsedSeconds) : '--:--'}</strong></span>
              </div>
              <div>
                <AppIcon name="hourglass" size={17} />
                <span>Estimasi tersisa<strong>{estRemainingText}</strong></span>
              </div>
            </div>
          </div>

          <div className="scan-hero__visual" aria-hidden="true">
            <div className="scan-hero__orbit">
              <span />
              <AppIcon name={isFinished ? 'check_circle' : 'scan'} size={30} />
            </div>
            <strong>{completedCount}</strong>
            <small>passport selesai</small>
          </div>
        </section>

        <div className="scan-detail-grid">
          <div className="scan-metrics" aria-label="Ringkasan scan">
            <div className="scan-metric">
              <span className="scan-metric__icon"><AppIcon name="file" size={17} /></span>
              <span><small>Total passport</small><strong>{displayTotal}</strong></span>
            </div>
            <div className="scan-metric">
              <span className="scan-metric__icon is-valid"><AppIcon name="check_circle" size={17} /></span>
              <span><small>Sudah selesai</small><strong>{completedCount}</strong></span>
            </div>
            <div className="scan-metric">
              <span className="scan-metric__icon is-remaining"><AppIcon name="hourglass" size={17} /></span>
              <span><small>Masih tersisa</small><strong>{remainingCount}</strong></span>
            </div>
          </div>

          <section className={`scan-process-card ${isScanning ? 'is-running' : isFinished ? 'is-finished' : 'is-stopped'}`}>
            <div className="scan-process-card__visual" aria-hidden="true">
              <div className="scan-document-stack">
                <span className="scan-document-stack__back" />
                <div className="scan-document-sheet">
                  <div className="scan-document-sheet__brand">
                    <AppIcon name="scan" size={17} />
                    <span>EntryMate</span>
                  </div>
                  <div className="scan-document-sheet__body">
                    <div className="scan-document-sheet__photo"><AppIcon name="user" size={32} /></div>
                    <div className="scan-document-sheet__lines"><span /><span /><span /><span /></div>
                  </div>
                  {isScanning && <span className="scan-document-sheet__sweep" />}
                </div>
                <div className="scan-document-stack__badge">
                  {isFinished ? <AppIcon name="check_circle" size={16} /> : <span />}
                  {displayTotal > 0 ? `Dokumen ${currentDocumentNumber} dari ${displayTotal}` : 'Menyiapkan daftar'}
                </div>
              </div>
            </div>

            <div className="scan-process-card__content">
              <span className="scan-process-card__eyebrow">Yang sedang dilakukan</span>
              <h2>{friendlyStage.title}</h2>
              <p>{friendlyStage.description}</p>

              <ol className="scan-journey" aria-label="Tahapan pemrosesan dokumen saat ini">
                {journeySteps.map((step, index) => {
                  const isComplete = isFinished || currentStageCode === 'complete' || index < friendlyStage.step;
                  const isActive = !isComplete && index === friendlyStage.step;
                  return (
                    <li key={step.title} className={isComplete ? 'is-complete' : isActive ? 'is-active' : ''}>
                      <span className="scan-journey__marker">
                        {isComplete ? <AppIcon name="check" size={15} /> : index + 1}
                      </span>
                      <span><strong>{step.title}</strong><small>{step.description}</small></span>
                    </li>
                  );
                })}
              </ol>

              <div className="scan-user-note">
                <AppIcon name="info" size={18} />
                <span>
                  <strong>Tidak perlu melakukan apa pun.</strong>
                  Halaman Review akan terbuka otomatis setelah semua passport selesai.
                </span>
              </div>
            </div>
          </section>

          <div className="scan-footer-state">
            <div>
              <span className={`scan-footer-state__dot ${isScanning ? 'is-running' : isFinished ? 'is-finished' : ''}`} aria-hidden="true" />
              <span>
                {isFinished
                  ? 'Semua passport selesai. Membuka halaman Review…'
                  : isScanning
                    ? 'Scan berjalan otomatis. Jangan tutup aplikasi sampai proses selesai.'
                    : 'Proses berhenti. Kembali ke Prepare jika ingin mencoba lagi.'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
