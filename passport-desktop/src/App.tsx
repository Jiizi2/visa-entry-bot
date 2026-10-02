import { useState, useEffect, Suspense, lazy, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from './store';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import PageTransition from './components/PageTransition';
import ImportPage from './pages/ImportPage';
import CompletionOverlay, { CompletionMoment } from './components/CompletionOverlay';
import { workflowArtwork } from './assets/workflowArtwork';

const PreparePage = lazy(() => import('./pages/PreparePage'));
const ScanPage = lazy(() => import('./pages/ScanPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));
const EntryPage = lazy(() => import('./pages/EntryPage'));

type Page = 'import' | 'prepare' | 'scan' | 'validation' | 'entry';

const pageOpeningMoments = {
  import: {
    image: workflowArtwork.importPrepare.src,
    title: 'Import passport',
    description: 'Pilih folder passport untuk memulai batch.',
    alt: workflowArtwork.importPrepare.alt,
  },
  prepare: {
    image: workflowArtwork.prepare.src,
    title: 'Rapikan foto passport',
    description: 'Siapkan foto passport sebelum pemindaian.',
    alt: workflowArtwork.prepare.alt,
  },
  scan: {
    image: workflowArtwork.scan.src,
    title: 'Scan passport',
    description: 'Baca informasi passport untuk direview.',
    alt: workflowArtwork.scan.alt,
  },
  validation: {
    image: workflowArtwork.review.src,
    title: 'Review data',
    description: 'Periksa dan sesuaikan data passport.',
    alt: workflowArtwork.review.alt,
  },
  entry: {
    image: workflowArtwork.entry.src,
    title: 'Entry ke Nusuk',
    description: 'Kirim data passport yang sudah direview ke Nusuk.',
    alt: workflowArtwork.entry.alt,
  },
} satisfies Record<Page, CompletionMoment>;

function PageOpeningArtwork() {
  const currentPage = useStore(state => state.currentPage);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    setIsOpen(true);
  }, [currentPage]);

  const closeArtwork = useCallback(() => setIsOpen(false), []);

  if (!isOpen) return null;
  return <CompletionOverlay key={currentPage} moment={pageOpeningMoments[currentPage]} onClose={closeArtwork} />;
}

export default function App() {
  const currentPage = useStore((state) => state.currentPage);
  const updateState = useStore((state) => state.updateState);

  useEffect(() => {
    const syncMotionVisibility = () => {
      document.documentElement.classList.toggle('is-motion-paused', document.hidden);
    };

    syncMotionVisibility();
    document.addEventListener('visibilitychange', syncMotionVisibility);
    return () => {
      document.removeEventListener('visibilitychange', syncMotionVisibility);
      document.documentElement.classList.remove('is-motion-paused');
    };
  }, []);

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
        </div>
      </div>
      <PageOpeningArtwork />
    </>
  );
}
