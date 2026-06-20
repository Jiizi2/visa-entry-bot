import { useState, useEffect, Suspense, lazy, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useStore } from './store';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import PageTransition from './components/PageTransition';
import ImportPage from './pages/ImportPage';

const PreparePage = lazy(() => import('./pages/PreparePage'));
const ScanPage = lazy(() => import('./pages/ScanPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));
const EntryPage = lazy(() => import('./pages/EntryPage'));

type Page = 'import' | 'prepare' | 'scan' | 'validation' | 'entry';

function FunModalsOverlay() {
  const currentPage = useStore(state => state.currentPage);
  const isScanning = useStore(state => state.isScanning);
  const isEntryRunning = useStore(state => state.isEntryRunning);
  
  const [currentImage, setCurrentImage] = useState<string | null>('/welcome.jpeg');
  
  const prevPage = useRef(currentPage);
  const prevIsScanning = useRef(isScanning);
  const prevIsEntryRunning = useRef(isEntryRunning);

  useEffect(() => {
    // From Scan to Validation = Scan Complete
    if (prevPage.current === 'scan' && currentPage === 'validation') {
       setCurrentImage('/scan_complete.jpeg');
    }
    // From Validation to Entry = Review Complete
    if (prevPage.current === 'validation' && currentPage === 'entry') {
       setCurrentImage('/review_complete.jpeg');
    }
    prevPage.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    // If entry was running and now finished
    if (prevIsEntryRunning.current && !isEntryRunning && currentPage === 'entry') {
      setCurrentImage('/export_complete.jpeg');
    }
    prevIsEntryRunning.current = isEntryRunning;
  }, [isEntryRunning, currentPage]);

  if (!currentImage) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: 600, width: '90%' }}>
        <img src={currentImage} style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 10, objectFit: 'contain' }} alt="Fun Modal" />
        <button 
          onClick={() => setCurrentImage(null)}
          style={{ marginTop: 24, padding: '14px 40px', background: '#0055d4', color: 'white', fontWeight: 'bold', borderRadius: 30, border: 'none', cursor: 'pointer', fontSize: 16, transition: 'transform 0.2s' }}
        >
          OK Lanjut
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const currentPage = useStore((state) => state.currentPage);
  const updateState = useStore((state) => state.updateState);

  useEffect(() => {
    try {
      getCurrentWindow().show();
    } catch (e) {
      console.warn('Bukan context Tauri', e);
    }

    // Tauri Watchdog Heartbeat
    // Memastikan backend tahu bahwa React UI masih hidup dan tidak hang
    let isMounted = true;
    import('@tauri-apps/api/core').then(({ invoke }) => {
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
    }).catch(console.warn);

    return () => {
      isMounted = false;
    };
  }, []);

  const pageInfo = {
    import: { title: 'Pilih Dokumen', subtitle: 'Halaman 1' },
    prepare: { title: 'Siapkan Foto', subtitle: 'Halaman 2' },
    scan: { title: 'Scan Berjalan', subtitle: 'Halaman 3' },
    validation: { title: 'Review Data', subtitle: 'Halaman 4' },
    entry: { title: 'Export JSON', subtitle: 'Halaman 5' },
  };

  return (
    <>
      <TitleBar />
      <div className="flex overflow-hidden" style={{ height: 'calc(100vh - var(--window-titlebar-height))' }}>
        <Sidebar currentPage={currentPage} onChangePage={(p: Page) => updateState({ currentPage: p })} />
        <main className="flex flex-col flex-1 overflow-y-auto min-w-0 items-stretch">
          
          <Suspense fallback={<div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', fontFamily: '"Hanken Grotesk", sans-serif', color: '#434655' }}>Memuat halaman...</div>}>
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
      <FunModalsOverlay />
    </>
  );
}
