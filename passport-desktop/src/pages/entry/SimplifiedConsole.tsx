import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import AppIcon from '../../components/ui/AppIcon';
import { memberDisplayName } from '../../utils/members';

interface SimplifiedConsoleProps {
  members: any[];
  manifestPath: string;
  batchReady: boolean;
  readinessTitle: string;
  readinessDescription: string;
  readinessActionLabel: string;
  readinessActionIcon: string;
  onResolveReadiness: () => void;
  onOpenNusuk: () => void;
}

export default function SimplifiedConsole({
  members,
  manifestPath,
  batchReady,
  readinessTitle,
  readinessDescription,
  readinessActionLabel,
  readinessActionIcon,
  onResolveReadiness,
  onOpenNusuk,
}: SimplifiedConsoleProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [currentMember, setCurrentMember] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    invoke<boolean>('is_automation_connected')
      .then(setIsConnected)
      .catch(() => setErrorMessage('Status extension belum dapat diperiksa. Coba buka Nusuk dan aktifkan extension EntryMate.'));

    const unlistenConnected = listen<{ clientId: string }>('transport-connected', () => {
      setIsConnected(true);
      setErrorMessage('');
    });

    const unlistenDisconnected = listen<{ clientId: string }>('transport-disconnected', () => {
      setIsConnected(false);
      setIsWorking(false);
    });

    const unlistenCurrentMember = listen<{ memberId: string }>('automation-current-member', (event) => {
      setCurrentMember(event.payload.memberId);
      setSessionCompleted(false);
      setIsWorking(true);
    });

    const unlistenCurrentStep = listen<{ step: string }>('automation-current-step', () => {
      setIsWorking(true);
    });

    const unlistenProgress = listen<{ percent: number; message: string }>('automation-progress', (event) => {
      setProgressPercent(event.payload.percent);
      setProgressMessage('Pengisian sedang berjalan. Pantau perubahan pada halaman Nusuk.');
      setIsWorking(event.payload.percent < 100);
    });

    const unlistenMemberCompleted = listen<{ memberId: string }>('automation-member-completed', () => {
      setCurrentMember('');
    });

    const unlistenSessionCompleted = listen<{ sessionId: string }>('automation-session-completed', () => {
      setSessionCompleted(true);
      setIsWorking(false);
      setCurrentMember('');
      setProgressPercent(100);
      setProgressMessage('Semua data dalam batch berhasil diproses.');
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
      setErrorMessage('');
      setProgressMessage('Mengirim batch ke extension EntryMate...');
      await invoke('send_automation_load_batch', { members, manifestPath });
      setProgressMessage('Batch sudah dikirim. Anda dapat memulai pengisian.');
    } catch {
      setErrorMessage('Batch belum dapat dikirim. Pastikan extension tetap terhubung, lalu coba lagi.');
    }
  };

  const handleStartAutomation = async () => {
    try {
      setErrorMessage('');
      setSessionCompleted(false);
      setIsWorking(true);
      setProgressMessage('Memulai pengisian data di Nusuk...');
      await invoke('send_automation_start');
    } catch {
      setIsWorking(false);
      setErrorMessage('Pengisian belum dapat dimulai. Periksa halaman Nusuk dan koneksi extension, lalu coba lagi.');
    }
  };

  const activeMember = members.find(member => String(member.id || '') === currentMember);
  const activeMemberName = activeMember ? memberDisplayName(activeMember) : '';
  const processTitle = !batchReady
    ? readinessTitle
    : sessionCompleted
    ? 'Semua data selesai diproses'
    : isWorking
      ? activeMemberName ? `Mengisi data ${activeMemberName}` : 'Pengisian sedang berjalan'
      : isConnected
        ? 'Siap memulai pengisian'
        : 'Hubungkan extension untuk melanjutkan';
  const processDescription = !batchReady
    ? readinessDescription
    : sessionCompleted
    ? 'Periksa hasil pengisian di Nusuk sebelum menyelesaikan pekerjaan.'
    : progressMessage || (isConnected
      ? `${members.length} passport siap dikirim ke halaman Nusuk.`
      : 'Buka Nusuk di Chrome, lalu aktifkan extension EntryMate.');

  return (
    <section className="entry-automation-card" aria-label="Proses pengisian melalui extension">
      <div className="entry-automation-card__body">
        <div className={`entry-process-card ${sessionCompleted ? 'is-complete' : ''} ${!batchReady ? 'is-blocked' : ''}`} aria-live="polite">
          {batchReady && (
            <div className="entry-process-card__topline">
              <span className={`entry-process-connection ${isConnected ? 'is-connected' : ''}`}>
                <span className="entry-connection-dot" />
                {isConnected ? 'Extension terhubung' : 'Extension belum terhubung'}
              </span>
              {(isWorking || sessionCompleted || progressPercent > 0) && <strong>{progressPercent}%</strong>}
            </div>
          )}
          <h3>{processTitle}</h3>
          <p>{processDescription}</p>
          {batchReady && (
            <div className="entry-process-progress" role="progressbar" aria-label="Progress pengisian Nusuk" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
              <span style={{ width: `${progressPercent}%` }} />
            </div>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="entry-inline-alert" role="alert">
          <AppIcon name="alert" size={17} />
          <span>{errorMessage}</span>
        </div>
      )}

      <footer className="entry-automation-actions">
        {!batchReady ? (
          <button type="button" className="secondary-button" onClick={onResolveReadiness}>
            <AppIcon name={readinessActionIcon} size={16} />
            {readinessActionLabel}
          </button>
        ) : (
          <>
            <button type="button" className="secondary-button" onClick={onOpenNusuk}>
              <AppIcon name="external_link" size={16} />
              Buka Nusuk
            </button>
            <button type="button" className="secondary-button" onClick={handleLoadBatch} disabled={!isConnected}>
              <AppIcon name="upload" size={16} />
              Kirim batch
            </button>
            <button type="button" className="primary-action" onClick={handleStartAutomation} disabled={!isConnected || isWorking}>
              <AppIcon name="play" size={16} />
              {isWorking ? 'Sedang berjalan...' : 'Mulai pengisian'}
            </button>
          </>
        )}
      </footer>
    </section>
  );
}
