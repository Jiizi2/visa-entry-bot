import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import logoUrl from '../assets/brand/entrymate-icon.png';
import AppIcon from './ui/AppIcon';

export default function TitleBar() {
  const [isRestorable, setIsRestorable] = useState(false);

  const handleMinimize = () => invoke('window_minimize').catch(console.error);
  const handleClose = () => invoke('window_close').catch(console.error);

  const handleToggleMaximize = async () => {
    try {
      const isMaximized = await invoke<boolean>('window_toggle_maximize');
      setIsRestorable(isMaximized);
    } catch (error) {
      console.error(error);
      setIsRestorable(false);
    }
  };

  const handleStartDragging = (event: React.MouseEvent) => {
    if (event.button !== 0 || event.detail > 1) return;
    if ((event.target as HTMLElement).closest('button')) return;
    invoke('window_start_dragging').catch(console.error);
  };

  const handleDoubleClick = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('button')) return;
    handleToggleMaximize();
  };

  return (
    <header
      id="window-titlebar"
      className="window-titlebar"
      onMouseDown={handleStartDragging}
      onDoubleClick={handleDoubleClick}
    >
      <div className="window-titlebar__brand">
        <img src={logoUrl} alt="" aria-hidden="true" />
        <strong>EntryMate</strong>
        <span>By Ghaniya</span>
      </div>
      <div className="window-titlebar__drag-region" aria-hidden="true" />
      <div className="window-titlebar__controls" aria-label="Kontrol jendela">
        <button type="button" onClick={handleMinimize} aria-label="Minimize" title="Minimize">
          <AppIcon name="minus" size={15} />
        </button>
        <button
          type="button"
          onClick={handleToggleMaximize}
          aria-label={isRestorable ? 'Restore' : 'Maximize'}
          title={isRestorable ? 'Restore' : 'Maximize'}
        >
          <AppIcon name={isRestorable ? 'square' : 'maximize'} size={14} />
        </button>
        <button className="is-close" type="button" onClick={handleClose} aria-label="Close" title="Close">
          <AppIcon name="close" size={16} />
        </button>
      </div>
    </header>
  );
}
