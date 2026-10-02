import Button from '../../components/ui/Button';
﻿import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import AppIcon from '../../components/ui/AppIcon';
import { memberDisplayName } from '../../utils/members';

interface SimplifiedConsoleProps {
  members: any[]; manifestPath: string; batchReady: boolean;
  readinessTitle: string; readinessDescription: string;
  readinessActionLabel: string; readinessActionIcon: string;
  onResolveReadiness: () => void; validateBatch: () => string;
}
interface Session {
  sessionId: string; manifestPath: string; status: string;
  currentMemberId?: string; manifestMembers: any[];
  completedMemberIds: string[]; failures: { memberId: string }[];
}
interface TabChoice { clientId: string; tabId?: number; title: string; url?: string; browserLabel: string }
interface HandoffResult { status: string; pageStatus?: string; session?: Session; tabs?: TabChoice[] }
const pageGuidance: Record<string, string> = {
  login_required: 'Data sudah diterima. Login di tab Nusuk yang dibuka, lalu pilih “Mulai pengisian” di EntryMate.',
  navigate_required: 'Data sudah diterima. Pada Masar Nusuk, pilih “Mulai pengisian” di panel atau widget EntryMate. Mu’tamer List akan dibuka otomatis pada tab yang sama.',
  loading: 'Data sudah diterima. Setelah halaman Nusuk siap, pilih “Mulai pengisian” di panel atau widget EntryMate.',
  ready: 'Data sudah diterima. Periksa batch di panel atau widget EntryMate pada tab Nusuk, lalu pilih “Mulai pengisian”.',
};
function batchSignature(value: any): string {
  if (Array.isArray(value)) return `[${value.map(batchSignature).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${batchSignature(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export default function SimplifiedConsole(props: SimplifiedConsoleProps) {
  const { members, manifestPath, batchReady, readinessTitle, readinessDescription, readinessActionLabel, readinessActionIcon, onResolveReadiness, validateBatch } = props;
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [result, setResult] = useState<HandoffResult | null>(null);
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true, fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const status = await invoke<{ connected: boolean; session: Session | null }>('get_automation_status');
        if (mounted) { setConnected(status.connected); setSession(status.session); }
      } catch { /* Keep confirmed progress during brief interruptions. */ }
      finally { fetching = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { setResult(null); setChoice(''); setError(''); }, [manifestPath]);
  const handoff = async () => {
    if (busyRef.current) return;
    const validation = validateBatch();
    if (validation) { setError(validation); return; }
    const selected = result?.tabs?.find(tab => `${tab.clientId}:${tab.tabId ?? 'new'}` === choice);
    busyRef.current = true; setBusy(true); setError('');
    try {
      const response = await invoke<HandoffResult>('prepare_nusuk_handoff', {
        members, manifestPath, clientId: selected?.clientId ?? null, tabId: selected?.tabId ?? null,
      });
      setResult(response);
      if (response.status === 'choose_tab') setChoice('');
      if (response.session) setSession(response.session);
    } catch (failure) { setError(String(failure)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const relevantSession = session?.manifestPath === manifestPath && session.manifestMembers?.length === members.length
    && batchSignature(session.manifestMembers) === batchSignature(members) ? session : null;
  const accepted = relevantSession && ['BATCH_LOADED', 'RUNNING', 'PAUSED', 'COMPLETED'].includes(relevantSession.status);
  const running = relevantSession?.status === 'RUNNING';
  const paused = relevantSession?.status === 'PAUSED';
  const completed = relevantSession?.status === 'COMPLETED';
  const successCount = new Set(relevantSession?.completedMemberIds || []).size;
  const failedCount = new Set(relevantSession?.failures?.map(f => f.memberId) || []).size;
  const percent = members.length ? Math.min(100, Math.round((successCount + failedCount) / members.length * 100)) : 0;
  const member = members.find(m => String(m.id) === relevantSession?.currentMemberId);
  const choosing = result?.status === 'choose_tab';
  const setup = result?.status === 'extension_required' || result?.status === 'extension_update_required';
  const title = !batchReady ? readinessTitle : busy ? 'Menyiapkan tab dan mengirim data…'
    : choosing ? 'Pilih tab Nusuk yang ingin digunakan'
    : completed ? `${successCount} berhasil${failedCount ? `, ${failedCount} perlu diulang` : ' — pengisian selesai'}`
    : paused ? 'Pengisian dijeda di Nusuk'
    : running ? member ? `Mengisi data ${memberDisplayName(member)}` : 'Pengisian sedang berjalan'
    : accepted ? 'Data siap di Nusuk' : 'Lanjutkan pengisian di Nusuk';
  const description = !batchReady ? readinessDescription : busy ? 'Memakai tab yang sudah terbuka dan menunggu konfirmasi penerimaan dari extension.'
    : choosing ? 'Gunakan tab dan akun yang sudah Anda siapkan. Pilihan ini akan dipakai untuk pekerjaan ini.'
    : completed ? failedCount ? 'Buka hasil di extension dan pilih “Ulangi yang gagal”. Jamaah yang berhasil tetap tersimpan.' : 'Periksa hasil pengisian pada halaman Nusuk.'
    : paused ? 'Pilih “Lanjutkan” di panel atau widget EntryMate pada tab Nusuk.'
    : running ? 'Jeda dan lanjutkan dari panel atau widget EntryMate di Nusuk. Progress di sini mengikuti pekerjaan tersebut.'
    : result?.status === 'needs_refresh' ? 'Tab Nusuk sudah diaktifkan. Muat ulang tab sekali agar extension aktif, lalu pilih “Lanjut ke Nusuk” kembali.'
    : accepted ? pageGuidance[result?.pageStatus || 'ready']
    : `${members.length} jamaah siap dikirim otomatis. Tab Nusuk yang sudah terbuka akan dipakai; sesi login tetap dipertahankan.`;
  return (
    <section className="entry-automation-card" aria-label="Lanjutkan pekerjaan ke Nusuk" aria-busy={busy}>
      <div className="entry-automation-card__body">
        <div className={`entry-process-card ${completed ? 'is-complete' : ''} ${!batchReady ? 'is-blocked' : ''}`}>
          {batchReady && <div className="entry-process-card__topline">
            <span className={`entry-process-connection ${connected ? 'is-connected' : ''}`}><span className="entry-connection-dot" />{connected ? 'Extension terhubung' : accepted ? 'Menyambungkan kembali ke extension' : 'Extension belum terhubung'}</span>
            {accepted && <strong>{successCount + failedCount} / {members.length} diproses</strong>}
          </div>}
          <div role="status"><h3>{title}</h3><p>{description}</p></div>
          {accepted && <div className="entry-process-progress" role="progressbar" aria-label="Jamaah selesai diproses" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ transform: `scaleX(${percent / 100})` }} /></div>}
        </div>
      </div>
      {choosing && <fieldset className="entry-tab-choices" disabled={busy}>
        <legend>Tab atau browser tujuan</legend>
        {result.tabs?.map(tab => {
          const id = `${tab.clientId}:${tab.tabId ?? 'new'}`;
          return <label key={id}><input type="radio" name="nusuk-tab" value={id} checked={choice === id} onChange={() => setChoice(id)} /><span><strong>{tab.title}</strong><small>{tab.browserLabel}{tab.url ? ` · ${tab.url}` : ''}</small></span></label>;
        })}
      </fieldset>}
      {setup && <div className="entry-connection-help">
        <strong>{result.status === 'extension_update_required' ? 'Perbarui extension EntryMate' : 'Aktifkan extension pada browser yang Anda gunakan'}</strong>
        <ol><li>Buka browser yang sudah login ke Nusuk.</li><li>{result.status === 'extension_update_required' ? 'Pasang versi extension terbaru, lalu muat ulang tab Nusuk sekali.' : 'Buka menu Extensions dan pastikan EntryMate aktif pada profil browser tersebut.'}</li><li>Kembali ke aplikasi dan pilih “Lanjut ke Nusuk”.</li></ol>
        <Button variant="secondary" type="button" className="secondary-button" onClick={() => openUrl('https://masar.nusuk.sa/', 'chrome').catch(() => setError('Chrome belum dapat dibuka. Buka browser Anda dan aktifkan extension EntryMate.'))}>Buka Nusuk di Chrome</Button>
        <p>Gunakan tombol ini jika Nusuk belum terbuka di browser Anda.</p>
      </div>}
      {error && <div className="entry-inline-alert" role="alert"><AppIcon name="alert" size={18} /><span>{error}</span></div>}
      <footer className="entry-automation-actions">
        {!batchReady ? <Button variant="secondary" type="button" className="secondary-button" onClick={onResolveReadiness}><AppIcon name={readinessActionIcon} size={16} />{readinessActionLabel}</Button>
          : <>{choosing && <Button variant="secondary" type="button" className="secondary-button" disabled={busy} onClick={() => { setResult(null); setChoice(''); }}>Batal</Button>}
            <Button variant="primary" type="button" className="primary-action" onClick={handoff} disabled={busy || (choosing && !choice)}><AppIcon name="external_link" size={16} />{busy ? 'Menghubungkan…' : choosing ? 'Gunakan tab ini' : accepted ? 'Lihat Nusuk' : 'Lanjut ke Nusuk'}</Button></>}
      </footer>
    </section>
  );
}
