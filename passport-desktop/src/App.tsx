import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import ImportPage from './pages/ImportPage';
import PreparePage from './pages/PreparePage';
import ScanPage from './pages/ScanPage';
import ReviewPage from './pages/ReviewPage';
import EntryPage from './pages/EntryPage';
import { useAppContext } from './AppContext';

type Page = 'import' | 'prepare' | 'scan' | 'validation' | 'entry';

export default function App() {
  const { state, updateState } = useAppContext();
  const currentPage = state.currentPage;

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
      <div className="app-shell" style={{ display: 'flex', height: 'calc(100vh - var(--window-titlebar-height))', overflow: 'hidden' }}>
        <Sidebar currentPage={currentPage} onChangePage={(p: Page) => updateState({ currentPage: p })} />
        <main className="app-main" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div className="mobile-nav" aria-label="Navigasi ringkas"></div>
          
          {currentPage === 'import' && <ImportPage />}
          {currentPage === 'prepare' && <PreparePage />}
          {currentPage === 'scan' && <ScanPage />}
          {currentPage === 'validation' && <ReviewPage />}
          {currentPage === 'entry' && <EntryPage />}
        </main>
      </div>
    </>
  );
}
