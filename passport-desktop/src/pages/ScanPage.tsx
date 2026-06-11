import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

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
  const state = useStore();
  const updateState = useStore(s => s.updateState);
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
    <section id="page-scan" className="flex flex-col h-full p-4 pb-6 px-8 bg-slate-50 font-['Inter',sans-serif] overflow-y-auto">
      <header className="flex justify-between items-center mx-auto mb-6 w-full max-w-[1024px] box-border bg-white/95 backdrop-blur-md rounded-2xl border border-slate-300/40 shadow-[0_8px_30px_rgba(0,0,0,0.04)] py-5 px-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-700 to-blue-500 rounded-xl flex items-center justify-center text-white shadow-[0_4px_12px_rgba(0,74,198,0.2)]">
            <span className="material-symbols-outlined text-[24px]">document_scanner</span>
          </div>
          <div>
            <span className="block text-[11px] font-bold text-blue-700 tracking-[0.1em] mb-1 uppercase">LANGKAH 3: RINGKASAN PROSES</span>
            <h1 className="font-['Inter',sans-serif] text-[24px] font-bold text-slate-900 m-0 tracking-[-0.01em]">{state.progressStageLabel || 'Memulai Data OCR'}</h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="px-3 py-1 bg-slate-200/50 text-slate-700 rounded text-[12px] font-semibold border border-slate-300/30">Desktop</span>
        </div>
      </header>

      <div className="flex-1 flex flex-col gap-6 w-full max-w-[1024px] mx-auto">
        {/* Primary Status Card */}
        <div className="bg-white rounded-xl border border-slate-300/40 p-6 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-blue-700/5 to-transparent pointer-events-none"></div>
          <div className="relative z-10 flex gap-8 w-full">
            <div className="flex-1 flex flex-col gap-6">
              <div className="flex justify-between items-end">
                <div className="flex flex-col">
                  <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-[0.05em] mb-1">Processing Passports</span>
                  <span className="font-['Inter',sans-serif] text-[20px] font-semibold text-slate-900">{state.progressFileName || 'Menunggu file...'}</span>
                </div>
                <div className="text-right">
                  <span className="font-['Inter',sans-serif] text-[20px] font-semibold text-blue-700">{progressPercent}%</span>
                  <span className="text-[12px] font-medium text-slate-500 ml-2">{state.progressCurrent || 0}/{state.progressTotal || 0} files</span>
                </div>
              </div>

              <div className="relative w-full h-3 bg-slate-200/80 rounded-full overflow-hidden">
                <div className="absolute top-0 left-0 h-full bg-blue-700 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, progressPercent)}%` }}>
                  {state.isScanning && <div className="absolute inset-0 bg-[linear-gradient(to_right,transparent,rgba(255,255,255,0.4),transparent)] animate-[pulse-slide_2s_infinite_linear]"></div>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Time Elapsed</span>
                  <span className="text-[14px] font-medium text-slate-900 mt-1">{state.isScanning || elapsedSeconds > 0 ? formatTime(elapsedSeconds) : '--:--'}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Est. Remaining</span>
                  <span className="text-[14px] font-medium text-slate-900 mt-1">{estRemainingText}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-1">
                {state.isScanning ? (
                  <span className="relative flex w-2 h-2"><span className="absolute w-full h-full rounded-full bg-blue-700 opacity-75 animate-ping"></span><span className="relative w-2 h-2 rounded-full bg-blue-700"></span></span>
                ) : (
                  <span className="material-symbols-outlined" style={{ color: 'green', fontSize: '20px', marginRight: '8px' }}>check_circle</span>
                )}
                <span className="text-[12px] font-medium text-blue-700/80">
                  {state.isScanning ? `OCR Engine Active (${state.ocrMode} Mode)` : 'OCR Engine Stopped'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer / Action Area */}
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-4 mb-2">
            <div className="bg-white rounded-lg border border-slate-300/30 p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Total Files</span>
              <span className="font-['Inter',sans-serif] text-[20px] font-bold text-slate-900">{state.totalFiles || 0}</span>
            </div>
            <div className="bg-white rounded-lg border border-slate-300/30 p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Completed</span>
              <span className="font-['Inter',sans-serif] text-[20px] font-bold text-blue-700">{state.validCount || 0}</span>
            </div>
            <div className="bg-white rounded-lg border border-slate-300/30 p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Errors Found</span>
              <span className="font-['Inter',sans-serif] text-[20px] font-bold text-red-700">{state.errorCount || 0}</span>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-300/30 shadow-[0_4px_12px_rgba(0,0,0,0.03)] overflow-hidden">
            <div className="flex items-center gap-2 p-4 border-b border-slate-300/30">
              <span className="material-symbols-outlined text-[20px] text-slate-500">terminal</span>
              <span className="text-[14px] font-semibold text-slate-900">System Logs</span>
            </div>
            <div className="bg-slate-50 p-4 h-32 overflow-y-auto font-mono text-[12px] text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
              {logs.length === 0 ? <div>Menunggu log...</div> : [...logs].reverse().map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>

          <div className="flex justify-between items-center bg-white rounded-lg border border-slate-300/30 p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-3 text-[16px] text-slate-700">
              {state.isScanning && <span className="relative flex w-2 h-2"><span className="absolute w-full h-full rounded-full bg-blue-700 opacity-75 animate-ping"></span><span className="relative w-2 h-2 rounded-full bg-blue-700"></span></span>}
              <span>{isFinished ? 'Scan telah selesai.' : state.isScanning ? 'OCR is running continuously.' : 'Scan dihentikan.'}</span>
            </div>
            {state.isScanning && (
              <button className="px-6 py-2 rounded-lg text-[14px] font-semibold text-red-700 bg-red-600/10 border border-red-600/30 flex items-center gap-2 cursor-pointer transition-colors duration-200 hover:bg-red-600/20" type="button" onClick={handleStopScan}>
                <span className="material-symbols-outlined text-[20px]">stop_circle</span>
                Stop Scan
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
