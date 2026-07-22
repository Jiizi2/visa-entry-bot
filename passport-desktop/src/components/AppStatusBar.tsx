import { useStore } from '../store';

const pageLabels = {
  import: 'Import',
  prepare: 'Prepare',
  scan: 'Scan',
  validation: 'Review',
  entry: 'Export',
} as const;

export default function AppStatusBar() {
  const currentPage = useStore((state) => state.currentPage);
  const selectedDir = useStore((state) => state.selectedDir);
  const statusHeadline = useStore((state) => state.statusHeadline);
  const isScanning = useStore((state) => state.isScanning);
  const isPreparingImages = useStore((state) => state.isPreparingImages);
  const isEntryRunning = useStore((state) => state.isEntryRunning);
  const progressCurrent = useStore((state) => state.progressCurrent);
  const progressTotal = useStore((state) => state.progressTotal);
  const manifest = useStore((state) => state.manifest);

  const isWorking = isScanning || isPreparingImages || isEntryRunning;
  const memberCount = Array.isArray(manifest?.members) ? manifest.members.length : 0;
  const detail = currentPage === 'scan' && progressTotal > 0
    ? `${Math.floor(progressCurrent)}/${progressTotal} file`
    : memberCount > 0
      ? `${memberCount} passport`
      : 'Siap';

  return (
    <footer className="app-statusbar" aria-label="Status aplikasi" role="status">
      <div className="app-statusbar__group app-statusbar__path" title={selectedDir || 'Belum ada folder dipilih'}>
        <span className={`app-statusbar__dot ${isWorking ? 'is-working' : selectedDir ? '' : 'is-idle'}`} aria-hidden="true" />
        <span className="app-statusbar__path">{selectedDir || 'Belum ada folder dipilih'}</span>
      </div>
      <div className="app-statusbar__group">
        <span>{statusHeadline || (isWorking ? 'Sedang bekerja' : 'EntryMate siap')}</span>
      </div>
      <div className="app-statusbar__group">
        <strong>{pageLabels[currentPage]}</strong>
        <span aria-hidden="true">·</span>
        <span>{detail}</span>
      </div>
    </footer>
  );
}
