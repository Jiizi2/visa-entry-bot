import { useEffect, useState } from 'react';
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
  const statusDetail = useStore((state) => state.statusDetail);
  const isScanning = useStore((state) => state.isScanning);
  const isPreparingImages = useStore((state) => state.isPreparingImages);
  const isEntryRunning = useStore((state) => state.isEntryRunning);
  const isChoosingFolder = useStore((state) => state.isChoosingFolder);
  const isStartingScan = useStore((state) => state.isStartingScan);
  const isStoppingScan = useStore((state) => state.isStoppingScan);
  const progressCurrent = useStore((state) => state.progressCurrent);
  const progressTotal = useStore((state) => state.progressTotal);
  const manifest = useStore((state) => state.manifest);
  const [isVisible, setIsVisible] = useState(false);

  const isWorking = isScanning || isPreparingImages || isEntryRunning || isChoosingFolder || isStartingScan || isStoppingScan;
  const memberCount = Array.isArray(manifest?.members) ? manifest.members.length : 0;
  const detail = currentPage === 'scan' && progressTotal > 0
    ? `${Math.floor(progressCurrent)}/${progressTotal} file`
    : memberCount > 0
      ? `${memberCount} passport`
      : 'Siap';
  const folderName = selectedDir.split(/[\\/]/).pop() || '';

  useEffect(() => {
    if (!statusHeadline && !isWorking) {
      setIsVisible(false);
      return;
    }

    setIsVisible(true);
    if (isWorking) return;

    const timer = window.setTimeout(() => setIsVisible(false), 4200);
    return () => window.clearTimeout(timer);
  }, [statusHeadline, isWorking]);

  if (!isVisible) return null;

  return (
    <footer
      className={`app-statusbar ${isWorking ? 'is-working' : ''}`}
      aria-label="Status aplikasi"
      aria-live="polite"
      role="status"
      title={statusDetail || selectedDir || undefined}
    >
      <span className={`app-statusbar__dot ${isWorking ? 'is-working' : ''}`} aria-hidden="true" />
      <div className="app-statusbar__copy">
        <strong>{statusHeadline || 'Sedang bekerja'}</strong>
        <span>{folderName || `${pageLabels[currentPage]} · ${detail}`}</span>
      </div>
      {isWorking && currentPage === 'scan' && progressTotal > 0 && (
        <span className="app-statusbar__metric">{Math.floor(progressCurrent)}/{progressTotal}</span>
      )}
    </footer>
  );
}
