import { useState, useEffect, Suspense, lazy } from 'react';
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
    </>
  );
}
