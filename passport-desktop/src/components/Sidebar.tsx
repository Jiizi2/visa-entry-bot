import { useState } from 'react';
import UpdateDialog from './UpdateDialog';
import AppIcon from './ui/AppIcon';
import { version } from '../../package.json';

type Page = 'import' | 'prepare' | 'scan' | 'validation' | 'entry';

interface SidebarProps {
  currentPage: Page;
  onChangePage: (page: Page) => void;
}

const navigationItems = [
  { id: 'import', label: 'Import', icon: 'folder' },
  { id: 'prepare', label: 'Prepare', icon: 'image' },
  { id: 'scan', label: 'Scan', icon: 'scan' },
  { id: 'validation', label: 'Review', icon: 'review' },
  { id: 'entry', label: 'Entry', icon: 'send' },
] as const;

export default function Sidebar({ currentPage, onChangePage }: SidebarProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);

  return (
    <aside className={`workflow-rail ${isMinimized ? 'is-collapsed' : ''}`} aria-label="Navigasi EntryMate">
      <nav id="workflow-navigation" className="workflow-rail__nav" aria-label="Halaman aplikasi">
        {navigationItems.map((item) => {
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              className={`workflow-nav-item ${isActive ? 'is-active' : ''}`}
              type="button"
              onClick={() => onChangePage(item.id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
            >
              <AppIcon name={item.icon} />
              <span className="workflow-nav-item__label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="workflow-rail__utility">
        <button
          className="workflow-rail__collapse"
          type="button"
          onClick={() => setIsMinimized((value) => !value)}
          aria-label={isMinimized ? 'Perbesar sidebar' : 'Perkecil sidebar'}
          aria-expanded={!isMinimized}
          aria-controls="workflow-navigation"
          title={isMinimized ? 'Perbesar sidebar' : 'Perkecil sidebar'}
        >
          <AppIcon name={isMinimized ? 'panel_open' : 'panel_close'} size={18} />
          <span>{isMinimized ? 'Perbesar sidebar' : 'Perkecil sidebar'}</span>
        </button>
        <button
          type="button"
          onClick={() => setIsUpdateDialogOpen(true)}
          title="Cek pembaruan aplikasi"
          aria-label="Cek pembaruan aplikasi"
        >
          <AppIcon name="refresh" size={18} />
          <span>Cek pembaruan</span>
        </button>
        <small>EntryMate v{version}</small>
      </div>

      <UpdateDialog isOpen={isUpdateDialogOpen} onClose={() => setIsUpdateDialogOpen(false)} />
    </aside>
  );
}
