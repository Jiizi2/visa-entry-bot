import { useState } from 'react';
import logoUrl from '../assets/brand/entrymate-icon.png';
import UpdateDialog from './UpdateDialog';
import AppIcon from './ui/AppIcon';

type Page = 'import' | 'prepare' | 'scan' | 'validation' | 'entry';

interface SidebarProps {
  currentPage: Page;
  onChangePage: (page: Page) => void;
}

const steps = [
  { id: 'import', label: 'Import', subtitle: 'Pilih folder kerja', icon: 'folder_open' },
  { id: 'prepare', label: 'Prepare', subtitle: 'Rapikan foto', icon: 'crop' },
  { id: 'scan', label: 'Scan', subtitle: 'Proses otomatis', icon: 'scan' },
  { id: 'validation', label: 'Review', subtitle: 'Periksa data', icon: 'review' },
  { id: 'entry', label: 'Export', subtitle: 'Kirim hasil', icon: 'export' },
] as const;

export default function Sidebar({ currentPage, onChangePage }: SidebarProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const activeIndex = steps.findIndex((step) => step.id === currentPage);

  return (
    <aside className={`workflow-rail ${isMinimized ? 'is-collapsed' : ''}`} aria-label="Workflow EntryMate">
      <div className="workflow-rail__brand">
        <img src={logoUrl} alt="" aria-hidden="true" />
        {!isMinimized && (
          <div>
            <strong>EntryMate</strong>
            <span>Desktop workstation</span>
          </div>
        )}
        <button
          className="workflow-rail__collapse"
          type="button"
          onClick={() => setIsMinimized((value) => !value)}
          aria-label={isMinimized ? 'Perbesar workflow rail' : 'Perkecil workflow rail'}
          aria-expanded={!isMinimized}
          title={isMinimized ? 'Perbesar navigasi' : 'Perkecil navigasi'}
        >
          <AppIcon name={isMinimized ? 'panel_open' : 'panel_close'} size={17} />
        </button>
      </div>

      <nav className="workflow-rail__nav" aria-label="Tahapan proses">
        {steps.map((step, index) => {
          const isActive = currentPage === step.id;
          const isCompleted = index < activeIndex;
          return (
            <button
              key={step.id}
              className={`workflow-step ${isActive ? 'is-active' : ''} ${isCompleted ? 'is-completed' : ''}`}
              type="button"
              onClick={() => onChangePage(step.id)}
              aria-current={isActive ? 'step' : undefined}
              title={`${index + 1}. ${step.label} — ${step.subtitle}`}
            >
              <span className="workflow-step__index" aria-hidden="true">
                {isCompleted ? <AppIcon name="check" size={13} strokeWidth={2.2} /> : index + 1}
              </span>
              <span className="workflow-step__icon" aria-hidden="true">
                <AppIcon name={step.icon} size={18} />
              </span>
              {!isMinimized && (
                <span className="workflow-step__copy">
                  <strong>{step.label}</strong>
                  <small>{step.subtitle}</small>
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="workflow-rail__utility">
        <button
          type="button"
          onClick={() => setIsUpdateDialogOpen(true)}
          title="Cek pembaruan aplikasi"
        >
          <AppIcon name="refresh" size={17} />
          {!isMinimized && <span>Cek pembaruan</span>}
        </button>
        {!isMinimized && <small>EntryMate v1.0.21</small>}
      </div>

      <UpdateDialog isOpen={isUpdateDialogOpen} onClose={() => setIsUpdateDialogOpen(false)} />
    </aside>
  );
}
