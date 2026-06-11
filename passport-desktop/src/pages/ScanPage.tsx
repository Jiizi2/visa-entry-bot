import React, { useEffect, useState } from 'react';
import { useAppContext } from '../AppContext';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import './scan-page.css';

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

export default function ScanPage() {
  const { state, updateState } = useAppContext();
  const [logs, setLogs] = useState<string[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    let interval: number | undefined;
    if (state.isScanning) {
      interval = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [state.isScanning]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupListener = async () => {
      unlisten = await listen('scan-event', (event) => {
        const payload: any = event.payload;
        setLogs((prev) => {
          const message = payload.message || JSON.stringify(payload);
          return [...prev, message];
        });
        
        switch (payload.event) {
          case 'scan_started':
            setElapsedSeconds(0);
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
            updateState({
              isScanning: true,
              progressCurrent: Number(payload.current ?? 0) + Number(payload.fileProgress ?? 0),
              progressTotal: Number(payload.total ?? state.progressTotal ?? 0),
              progressFileName: payload.fileName ?? '',
              progressStageLabel: payload.message ?? 'Sedang bekerja',
            });
            break;
          case 'scan_progress':
            updateState({
              isScanning: true,
              progressCurrent: Number(payload.current ?? 0),
              progressTotal: Number(payload.total ?? state.progressTotal ?? 0),
              progressFileName: payload.fileName ?? '',
              progressStageLabel: 'Memproses ' + (payload.fileName ?? ''),
            });
            break;
          case 'scan_complete': {
            const manifestPath = payload.manifestPath ?? '';
            updateState({
              isScanning: false,
              manifestPath,
              resultDir: payload.groupDir ?? '',
              resultSourceDir: state.selectedDir,
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
            updateState({ isScanning: false, progressStageLabel: payload.message ?? 'Proses gagal atau dihentikan' });
            break;
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [state.progressTotal, state.selectedDir, updateState]);

  const handleStopScan = async () => {
    try {
      await invoke('stop_scan');
    } catch (e) {
      console.error(e);
    }
  };

  const progressPercent = state.progressTotal > 0 ? Math.round((state.progressCurrent / state.progressTotal) * 100) : 0;
  const isFinished = !state.isScanning && state.progressCurrent >= state.progressTotal && state.progressTotal > 0;

  let estRemainingText = '--:--';
  if (isFinished) {
    estRemainingText = '00:00';
  } else if (state.isScanning && state.progressCurrent > 0 && state.progressTotal > 0) {
    const timePerItem = elapsedSeconds / state.progressCurrent;
    const remainingItems = state.progressTotal - state.progressCurrent;
    estRemainingText = formatTime(remainingItems * timePerItem);
  }

  return (
    <section id="page-scan">
      <header className="scan-header-modern">
        <div className="scan-header-title-area">
          <div className="scan-header-icon">
            <span className="material-symbols-outlined">document_scanner</span>
          </div>
          <div>
            <span className="step-eyebrow">LANGKAH 3: RINGKASAN PROSES</span>
            <h1 className="scan-title">{state.progressStageLabel || 'Memulai Data OCR'}</h1>
          </div>
        </div>
        <div className="scan-window-controls">
          <span className="scan-badge">Desktop</span>
        </div>
      </header>

      <div className="scan-content-canvas">
        {/* Primary Status Card */}
        <div className="scan-status-card">
          <div className="scan-card-bg"></div>
          <div className="scan-card-content">
            <div className="scan-card-left">
              <div className="scan-info-row">
                <div className="scan-info-text">
                  <span className="scan-eyebrow">Processing Passports</span>
                  <span className="scan-filename">{state.progressFileName || 'Menunggu file...'}</span>
                </div>
                <div className="scan-info-stats">
                  <span className="scan-percent">{progressPercent}%</span>
                  <span className="scan-count">{state.progressCurrent || 0}/{state.progressTotal || 0} files</span>
                </div>
              </div>

              <div className="scan-progress-bar-wrap">
                <div className="scan-progress-bar-fill" style={{ width: `${Math.min(100, progressPercent)}%` }}>
                  {state.isScanning && <div className="scan-progress-pulse"></div>}
                </div>
              </div>

              <div className="scan-time-grid">
                <div className="scan-time-col">
                  <span className="scan-time-label">Time Elapsed</span>
                  <span className="scan-time-val">{state.isScanning || elapsedSeconds > 0 ? formatTime(elapsedSeconds) : '--:--'}</span>
                </div>
                <div className="scan-time-col">
                  <span className="scan-time-label">Est. Remaining</span>
                  <span className="scan-time-val">{estRemainingText}</span>
                </div>
              </div>

              <div className="scan-engine-status">
                {state.isScanning ? (
                  <span className="scan-ping-dot"><span className="ping-anim"></span><span className="ping-core"></span></span>
                ) : (
                  <span className="material-symbols-outlined" style={{ color: 'green', fontSize: '14px', marginRight: '8px' }}>check_circle</span>
                )}
                <span className="scan-engine-text">
                  {state.isScanning ? `OCR Engine Active (${state.ocrMode} Mode)` : 'OCR Engine Stopped'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer / Action Area */}
        <div className="scan-footer-area">
          <div className="scan-stats-grid">
            <div className="scan-stat-box">
              <span className="scan-stat-label">Total Files</span>
              <span className="scan-stat-val">{state.totalFiles || 0}</span>
            </div>
            <div className="scan-stat-box">
              <span className="scan-stat-label">Completed</span>
              <span className="scan-stat-val text-primary">{state.validCount || 0}</span>
            </div>
            <div className="scan-stat-box">
              <span className="scan-stat-label">Errors Found</span>
              <span className="scan-stat-val text-error">{state.errorCount || 0}</span>
            </div>
          </div>

          <div className="scan-logs-panel">
            <div className="scan-logs-header">
              <span className="material-symbols-outlined">terminal</span>
              <span>System Logs</span>
            </div>
            <div className="scan-logs-body">
              {logs.length === 0 ? <div>Menunggu log...</div> : [...logs].reverse().map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>

          <div className="scan-action-bar">
            <div className="scan-action-status">
              {state.isScanning && <span className="scan-ping-dot"><span className="ping-anim"></span><span className="ping-core"></span></span>}
              <span>{isFinished ? 'Scan telah selesai.' : state.isScanning ? 'OCR is running continuously.' : 'Scan dihentikan.'}</span>
            </div>
            {state.isScanning && (
              <button className="scan-btn-stop" type="button" onClick={handleStopScan}>
                <span className="material-symbols-outlined">stop_circle</span>
                Stop Scan
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
