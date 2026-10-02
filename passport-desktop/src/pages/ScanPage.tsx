import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import React, { useEffect, useRef, useState } from 'react';
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
  const preparedSession = useStore(s => s.preparedSession);
  const queueRef = useRef<HTMLDivElement>(null);
  const activeQueueRowRef = useRef<HTMLTableRowElement>(null);
  const documentSheetRef = useRef<HTMLDivElement>(null);
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
    const sheet = documentSheetRef.current;
    if (!isScanning || !sheet || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(([entry]) => {
      sheet.classList.toggle('is-offscreen', !entry.isIntersecting);
    });
    observer.observe(sheet);
    return () => {
      observer.disconnect();
      sheet.classList.remove('is-offscreen');
    };
  }, [isScanning]);

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

  const queueItems: any[] = preparedSession?.items || [];
  const hasQueue = displayTotal > 0 && queueItems.length === displayTotal;
  const queuedCount = Math.max(0, remainingCount - (isScanning && remainingCount > 0 ? 1 : 0));
  const batchName = selectedDir.split(/[\\/]/).pop() || '';
  const stateText = isFinished ? 'Semua dokumen selesai' : isScanning ? 'Scan sedang berjalan' : friendlyStage.title;
  const hasScanError = currentStageCode === 'error';

  // Keep the active row visible inside its scroll region, without moving the application viewport.
  useEffect(() => {
    const queue = queueRef.current;
    const row = activeQueueRowRef.current;
    if (!queue || !row) return;
    const rowBox = row.getBoundingClientRect();
    const queueBox = queue.getBoundingClientRect();
    if (rowBox.bottom > queueBox.bottom || rowBox.top < queueBox.top + 32) {
      queue.scrollTop += rowBox.top - queueBox.top - queue.clientHeight / 2 + row.clientHeight / 2;
    }
  }, [progressFileName, completedCount, hasQueue]);

  return (
    <section id="page-scan" className="page-container scan-page">
      <div className="scan-workspace">
        <div className="scan-main">
          <PageHeader title="Scan passport" actions={isScanning ? (
            <Button variant="secondary" danger type="button" onClick={handleStopScan}>
              <AppIcon name="stop" size={16} />Hentikan
            </Button>
          ) : undefined} />
          <section className="scan-summary" aria-label="Progres batch">
            <div className={`scan-running-state ${hasScanError ? 'is-error' : isScanning ? '' : isFinished ? 'is-finished' : 'is-idle'}`} role="status">
              <span className="status-dot" aria-hidden="true" /><span>{stateText}</span>
            </div>
            <div className="scan-progress-value">
              <strong aria-hidden="true">{progressPercent}%</strong>
              <span>{completedCount} dari {displayTotal} passport selesai</span>
            </div>
            <div className="scan-progress-track" role="progressbar" aria-label="Progres scan passport"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, progressPercent)}
              aria-valuetext={`${completedCount} dari ${displayTotal} passport selesai diproses`}>
              <div className="scan-progress-track__fill" style={{ transform: `scaleX(${Math.max(0, Math.min(100, progressPercent)) / 100})` }} />
            </div>
            <dl className="scan-timing">
              <div><dt>Waktu berjalan</dt><dd>{isScanning || elapsedSeconds > 0 ? formatTime(elapsedSeconds) : '--:--'}</dd></div>
              <div><dt>Estimasi tersisa</dt><dd>{estRemainingText}</dd></div>
              <div><dt>Antrean</dt><dd>{queuedCount} dokumen</dd></div>
            </dl>
          </section>
          <section className="scan-queue" aria-labelledby="scan-queue-title">
            <header><h2 id="scan-queue-title">Antrean dokumen</h2>
              <span className="scan-queue-context" title={selectedDir}>{batchName ? `${batchName} · ` : ''}{displayTotal} dokumen</span>
            </header>
            {hasQueue ? (
              <div className="scan-queue-scroll" ref={queueRef}>
                <table className="scan-queue-table" aria-label="Status pemrosesan dokumen">
                  <thead><tr><th scope="col"><span className="sr-only">Nomor</span></th><th scope="col">Dokumen</th><th scope="col">Status</th></tr></thead>
                  <tbody>{queueItems.map((item, index) => {
                    const completed = index < completedCount;
                    const active = isScanning && index === completedCount;
                    const status = completed ? 'Selesai' : active ? 'Membaca' : isScanning ? 'Menunggu' : 'Belum selesai';
                    return (
                      <tr key={item.id ?? index} className={active ? 'is-active' : ''} ref={active ? activeQueueRowRef : undefined} aria-current={active ? 'step' : undefined}>
                        <td>{index + 1}</td>
                        <td><span className="scan-queue-file"><AppIcon name="file" size={18} /><span title={item.fileName}>{item.fileName || `Dokumen ${index + 1}`}</span></span></td>
                        <td><span className={`scan-queue-status ${completed ? 'is-complete' : active ? 'is-active' : ''}`}>
                          <AppIcon name={completed ? 'check_circle' : active ? 'scan' : 'hourglass'} size={16} />{status}
                        </span></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            ) : (
              <p className="scan-empty-note">{progressFileName
                ? `Sedang memproses ${progressFileName}. Daftar dokumen lengkap belum tersedia.`
                : 'Daftar dokumen akan muncul setelah foto disiapkan di halaman Prepare.'}</p>
            )}
          </section>
          <p className="scan-main-note"><AppIcon name="info" size={16} />
            {isFinished ? 'Semua passport selesai. Membuka halaman Review…'
              : isScanning ? 'Biarkan aplikasi tetap terbuka selama proses scan.'
              : 'Kembali ke Prepare untuk memeriksa dokumen dan mencoba lagi.'}
          </p>
        </div>
        <aside className="scan-detail" aria-label="Dokumen aktif">
          <header><h2>Dokumen aktif</h2>
            <span>{displayTotal > 0 ? `Dokumen ${currentDocumentNumber} dari ${displayTotal}` : 'Belum ada dokumen'}</span>
            <p className="scan-detail-filename">{progressFileName || 'Menyiapkan dokumen pertama'}</p>
          </header>
          <figure className="scan-document-illustration">
            <div className="scan-document-sheet" ref={documentSheetRef} aria-hidden="true">
              <div className="scan-document-sheet__body">
                <div className="scan-document-sheet__photo"><AppIcon name="user" size={32} /></div>
                <div className="scan-document-sheet__lines"><span /><span /><span /><span /></div>
              </div>
              {isScanning && <span className="scan-document-sheet__sweep" />}
            </div>
            <figcaption>Ilustrasi dokumen</figcaption>
          </figure>
          <div className="scan-detail-stage" aria-live="polite"><h3>{friendlyStage.title}</h3><p>{friendlyStage.description}</p></div>
          <ol className="scan-journey" aria-label="Tahapan dokumen aktif">
            {journeySteps.map((step, index) => {
              const isComplete = !hasScanError && (isFinished || currentStageCode === 'complete' || index < friendlyStage.step);
              const isActive = isScanning && !isComplete && index === friendlyStage.step;
              return (
                <li key={step.title} className={hasScanError && index === friendlyStage.step ? 'is-error' : isComplete ? 'is-complete' : isActive ? 'is-active' : ''} aria-current={isActive ? 'step' : undefined}>
                  <span className="scan-journey__marker" aria-hidden="true">{isComplete ? <AppIcon name="check" size={16} /> : index + 1}</span>
                  <span><strong>{step.title}</strong><small>{step.description}</small></span>
                </li>
              );
            })}
          </ol>
          <p className="scan-detail-note"><AppIcon name="info" size={16} />Review terbuka otomatis setelah semua dokumen selesai.</p>
        </aside>
      </div>
    </section>
  );
}
