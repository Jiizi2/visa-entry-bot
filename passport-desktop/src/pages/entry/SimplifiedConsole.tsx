import React, { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

interface SimplifiedConsoleProps {
  members: any[];
  manifestPath: string;
}

export default function SimplifiedConsole({ members, manifestPath }: SimplifiedConsoleProps) {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [currentMember, setCurrentMember] = useState<string>('');
  const [currentStep, setCurrentStep] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [sessionCompleted, setSessionCompleted] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 50));
  };

  useEffect(() => {
    addLog("Konsol Otomatisasi diinisialisasi.");

    // Cek status koneksi awal dari Rust backend
    invoke<boolean>('is_automation_connected')
      .then((connected) => {
        setIsConnected(connected);
        if (connected) {
          addLog("Ekstensi Chrome terdeteksi aktif terhubung.");
        }
      })
      .catch((e) => addLog(`Gagal cek status koneksi awal: ${e}`));

    // Listen to connection events
    const unlistenConnected = listen<{ clientId: string }>('transport-connected', (event) => {
      setIsConnected(true);
      setErrorMsg('');
      addLog(`Klien terhubung (ID: ${event.payload.clientId.slice(0, 8)}...)`);
    });

    const unlistenDisconnected = listen<{ clientId: string }>('transport-disconnected', () => {
      setIsConnected(false);
      addLog("Klien terputus dari WebSocket.");
    });

    // Listen to automation progress events
    const unlistenCurrentMember = listen<{ memberId: string }>('automation-current-member', (event) => {
      setCurrentMember(event.payload.memberId);
      setSessionCompleted(false);
      addLog(`Mulai memproses mutamer: ${event.payload.memberId}`);
    });

    const unlistenCurrentStep = listen<{ step: string }>('automation-current-step', (event) => {
      setCurrentStep(event.payload.step);
      addLog(`Langkah pengerjaan: ${event.payload.step}`);
    });

    const unlistenProgress = listen<{ percent: number; message: string }>('automation-progress', (event) => {
      setProgressPercent(event.payload.percent);
      setProgressMsg(event.payload.message);
      addLog(`Progres: ${event.payload.percent}% - ${event.payload.message}`);
    });

    const unlistenMemberCompleted = listen<{ memberId: string }>('automation-member-completed', (event) => {
      addLog(`Mutamer selesai diproses: ${event.payload.memberId}`);
    });

    const unlistenSessionCompleted = listen<{ sessionId: string }>('automation-session-completed', () => {
      setSessionCompleted(true);
      setCurrentMember('');
      setCurrentStep('');
      setProgressPercent(100);
      setProgressMsg('Seluruh pengerjaan batch selesai!');
      addLog("✅ SELURUH BATCH NUSUK SELESAI!");
    });

    return () => {
      unlistenConnected.then(fn => fn());
      unlistenDisconnected.then(fn => fn());
      unlistenCurrentMember.then(fn => fn());
      unlistenCurrentStep.then(fn => fn());
      unlistenProgress.then(fn => fn());
      unlistenMemberCompleted.then(fn => fn());
      unlistenSessionCompleted.then(fn => fn());
    };
  }, []);

  const handleLoadBatch = async () => {
    try {
      setErrorMsg('');
      addLog("Mengirim instruksi LOAD_BATCH ke ekstensi...");
      await invoke('send_automation_load_batch', { members, manifestPath });
      addLog("Pesan LOAD_BATCH terkirim.");
    } catch (e: any) {
      setErrorMsg(String(e));
      addLog(`Gagal LOAD_BATCH: ${String(e)}`);
    }
  };

  const handleStartAutomation = async () => {
    try {
      setErrorMsg('');
      addLog("Mengirim instruksi START ke ekstensi...");
      await invoke('send_automation_start');
      addLog("Pesan START terkirim.");
    } catch (e: any) {
      setErrorMsg(String(e));
      addLog(`Gagal START otomatisasi: ${String(e)}`);
    }
  };

  return (
    <div className="bg-white text-slate-800 rounded-2xl border border-slate-200/80 shadow-[0_8px_30px_rgba(0,0,0,0.04)] overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-200/80 bg-slate-50/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3.5 h-3.5 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)] animate-pulse' : 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.4)]'}`} />
          <div>
            <h2 className="text-[16px] font-bold tracking-tight text-slate-800 m-0 flex items-center gap-2">
              Console Otomatisasi
              <span className="text-[11px] font-semibold text-slate-500 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200/60">WebSocket server</span>
            </h2>
            <p className="text-[12px] text-slate-500 m-0 mt-0.5">
              {isConnected ? 'Ekstensi Chrome terhubung & siap' : 'Menunggu ekstensi Chrome terhubung di port 9001-9005...'}
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <button 
            onClick={handleLoadBatch}
            disabled={!isConnected}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 rounded-lg text-[13px] font-semibold cursor-pointer transition-all hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[16px]">file_upload</span>
            Load Batch
          </button>
          <button 
            onClick={handleStartAutomation}
            disabled={!isConnected}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white border-none rounded-lg text-[13px] font-semibold cursor-pointer transition-all shadow-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[16px]">play_arrow</span>
            Start
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-px bg-slate-200/50">
        {/* Status Panel */}
        <div className="p-6 lg:col-span-7 bg-white flex flex-col justify-between gap-6">
          <div className="space-y-4">
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Mutamer Aktif</span>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center justify-between min-h-[58px]">
                {currentMember ? (
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-blue-600">person</span>
                    <span className="text-[14px] font-semibold text-slate-800">{currentMember}</span>
                  </div>
                ) : (
                  <span className="text-[13px] text-slate-400 italic">Tidak ada pengerjaan aktif</span>
                )}
              </div>
            </div>

            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Langkah Pengerjaan</span>
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center justify-between min-h-[58px]">
                {currentStep ? (
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-amber-500">hourglass_empty</span>
                    <span className="text-[13px] font-medium text-slate-700">{currentStep}</span>
                  </div>
                ) : (
                  <span className="text-[13px] text-slate-400 italic">Idle</span>
                )}
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[13px] font-semibold text-slate-600">{progressMsg || 'Menunggu pengerjaan...'}</span>
              <span className="text-[13px] font-bold text-blue-600">{progressPercent}%</span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/80 flex">
              <div 
                className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-[13px] font-medium flex items-start gap-2.5">
              <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Real-time Logs Terminal */}
        <div className="p-6 lg:col-span-5 bg-slate-50/40 flex flex-col min-h-[250px]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Log Aktifitas</span>
            <button 
              onClick={() => setLogs([])}
              className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 bg-none border-none cursor-pointer transition-colors"
            >
              Clear Logs
            </button>
          </div>
          <div className="flex-1 p-4 bg-slate-900 border border-slate-800 rounded-xl font-mono text-[11px] leading-relaxed text-slate-200 overflow-y-auto max-h-[240px] flex flex-col-reverse gap-1.5 shadow-inner">
            {logs.length > 0 ? (
              logs.map((log, index) => (
                <div key={index} className="whitespace-pre-wrap break-all hover:text-white transition-colors">
                  {log}
                </div>
              ))
            ) : (
              <div className="text-slate-500 italic">Belum ada aktifitas...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
