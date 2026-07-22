import { useState, useEffect, Suspense, lazy, useRef, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from './store';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import PageTransition from './components/PageTransition';
import ImportPage from './pages/ImportPage';
import AppStatusBar from './components/AppStatusBar';
import CompletionOverlay, { CompletionMoment } from './components/CompletionOverlay';

const PreparePage = lazy(() => import('./pages/PreparePage'));
const ScanPage = lazy(() => import('./pages/ScanPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));
const EntryPage = lazy(() => import('./pages/EntryPage'));

type Page = 'import' | 'prepare' | 'scan' | 'validation' | 'entry';

const completionMoments = {
  welcome: {
    image: '/welcome.jpeg',
    title: 'Selamat datang di EntryMate',
    description: 'Siapkan folder passport untuk memulai workflow.',
    alt: 'Poster sambutan EntryMate untuk memulai pemindaian passport.',
  },
  scan: {
    image: '/scan_complete.jpeg',
    title: 'Scan selesai',
    description: 'Data passport siap diperiksa di tahap Review.',
    alt: 'Poster EntryMate yang menandakan pemindaian passport selesai.',
  },
  review: {
    image: '/review_complete.jpeg',
    title: 'Review selesai',
    description: 'Seluruh passport telah ditinjau dan siap diekspor.',
    alt: 'Poster EntryMate yang menandakan review seluruh passport selesai.',
  },
  export: {
    image: '/export_complete.jpeg',
    title: 'Export selesai',
    description: 'Data EntryMate berhasil diproses untuk tahap akhir.',
    alt: 'Poster EntryMate yang menandakan export data selesai.',
  },
} satisfies Record<string, CompletionMoment>;

function CompletionMoments() {
  const currentPage = useStore(state => state.currentPage);
  const isScanning = useStore(state => state.isScanning);
  const isEntryRunning = useStore(state => state.isEntryRunning);
  
  const [currentMoment, setCurrentMoment] = useState<CompletionMoment | null>(completionMoments.welcome);
  
  const prevPage = useRef(currentPage);
  const prevIsScanning = useRef(isScanning);
  const prevIsEntryRunning = useRef(isEntryRunning);

  useEffect(() => {
    // From Scan to Validation = Scan Complete
    if (prevPage.current === 'scan' && currentPage === 'validation') {
       setCurrentMoment(completionMoments.scan);
    }
    // From Validation to Entry = Review Complete
    if (prevPage.current === 'validation' && currentPage === 'entry') {
       setCurrentMoment(completionMoments.review);
    }
    prevPage.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    // If entry was running and now finished
    if (prevIsEntryRunning.current && !isEntryRunning && currentPage === 'entry') {
      setCurrentMoment(completionMoments.export);
    }
    prevIsEntryRunning.current = isEntryRunning;
  }, [isEntryRunning, currentPage]);

  const closeMoment = useCallback(() => setCurrentMoment(null), []);

  if (!currentMoment) return null;
  return <CompletionOverlay moment={currentMoment} onClose={closeMoment} />;
}

export default function App() {
  const currentPage = useStore((state) => state.currentPage);
  const updateState = useStore((state) => state.updateState);

  useEffect(() => {
    getCurrentWindow().show().catch((e) => {
      console.warn('Gagal menampilkan window:', e);
    });

    // Tauri Watchdog Heartbeat
    // Memastikan backend tahu bahwa React UI masih hidup dan tidak hang
    let isMounted = true;
    const sendHeartbeat = async () => {
      if (!isMounted) return;
      try {
        await invoke('renderer_heartbeat');
      } catch (e) {
        // Abaikan error jika terjadi pada invoke heartbeat
      }
      setTimeout(sendHeartbeat, 10000);
    };
    sendHeartbeat();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <>
      <TitleBar />
      <div className="app-frame">
        <Sidebar currentPage={currentPage} onChangePage={(p: Page) => updateState({ currentPage: p })} />
        <div className="app-content-frame">
          <main className="app-workspace">
            <Suspense fallback={<div className="flex flex-1 items-center justify-center text-slate-500 font-sans">Memuat halaman...</div>}>
              <PageTransition pageKey={currentPage}>
                {currentPage === 'import' && <ImportPage key="import" />}
                {currentPage === 'prepare' && <PreparePage key="prepare" />}
                {currentPage === 'scan' && <ScanPage key="scan" />}
                {currentPage === 'validation' && <ReviewPage key="validation" />}
                {currentPage === 'entry' && <EntryPage key="entry" />}
              </PageTransition>
            </Suspense>
          </main>
          <AppStatusBar />
        </div>
      </div>
      <CompletionMoments />
    </>
  );
}
