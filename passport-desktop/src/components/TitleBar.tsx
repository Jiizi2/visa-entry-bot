import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export default function TitleBar() {
  const [isRestorable, setIsRestorable] = useState(false);

  const handleMinimize = () => invoke('window_minimize').catch(console.error);
  const handleClose = () => invoke('window_close').catch(console.error);
  
  const handleToggleMaximize = async () => {
    try {
      const isMaximized = await invoke<boolean>('window_toggle_maximize');
      setIsRestorable(isMaximized);
    } catch (e) {
      console.error(e);
      setIsRestorable(false);
    }
  };

  const handleStartDragging = (e: React.MouseEvent) => {
    if (e.button !== 0 || e.detail > 1) return;
    if ((e.target as HTMLElement).closest('button')) return;
    invoke('window_start_dragging').catch(console.error);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    handleToggleMaximize();
  };

  return (
    <header
      id="window-titlebar"
      className="window-titlebar"
      onMouseDown={handleStartDragging}
      onDoubleClick={handleDoubleClick}
    >
      <div className="window-titlebar-brand">
        <div className="window-titlebar-copy">
          <strong>EntryMate</strong>
          <span>By Ghaniya</span>
        </div>
      </div>
      <div className="window-titlebar-meta">
        <span className="window-titlebar-pill">Desktop</span>
      </div>
      <div className="window-controls" aria-label="Kontrol jendela">
        <button className="window-control-button minimize" onClick={handleMinimize} type="button" aria-label="Minimize" title="Minimize">
          <span aria-hidden="true"></span>
        </button>
        <button className={`window-control-button maximize ${isRestorable ? 'is-restorable' : ''}`} onClick={handleToggleMaximize} type="button" aria-label={isRestorable ? "Restore" : "Maximize"} title={isRestorable ? "Restore" : "Maximize"}>
          <span aria-hidden="true"></span>
        </button>
        <button className="window-control-button close" onClick={handleClose} type="button" aria-label="Close" title="Close">
          <span aria-hidden="true"></span>
        </button>
      </div>
    </header>
  );
}
