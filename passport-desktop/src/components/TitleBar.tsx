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
      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center w-full h-[var(--window-titlebar-height)] min-h-[var(--window-titlebar-height)] pl-[14px] bg-white/98 border-b border-slate-400/20 text-slate-900 sticky top-0 z-[80] cursor-default select-none"
      onMouseDown={handleStartDragging}
      onDoubleClick={handleDoubleClick}
    >
      <div className="inline-flex items-center min-w-0 h-full">
        <div className="inline-flex items-baseline min-w-0 gap-[7px] whitespace-nowrap">
          <strong className="text-slate-900 text-[13.4px] font-[760]">EntryMate</strong>
          <span className="text-slate-500 text-[11.5px] font-[650]">By Ghaniya</span>
        </div>
      </div>
      <div className="inline-flex items-center h-full px-3">
        <span className="inline-flex items-center min-h-[24px] px-[9px] rounded bg-blue-600/10 text-blue-800 text-[11.5px] font-[650]">Desktop</span>
      </div>
      <div className="inline-flex items-stretch h-full" aria-label="Kontrol jendela">
        <button 
          className="group relative inline-flex items-center justify-center w-[46px] h-full p-0 rounded-none text-slate-600 bg-transparent cursor-pointer transition-colors duration-150 hover:bg-slate-500/10 hover:text-slate-900" 
          onClick={handleMinimize} type="button" aria-label="Minimize" title="Minimize"
        >
          <span className="relative block w-[14px] h-[14px] before:content-[''] before:absolute before:left-[2px] before:right-[2px] before:bottom-[3px] before:h-[1.5px] before:rounded-full before:bg-current" aria-hidden="true"></span>
        </button>
        <button 
          className="group relative inline-flex items-center justify-center w-[46px] h-full p-0 rounded-none text-slate-600 bg-transparent cursor-pointer transition-colors duration-150 hover:bg-slate-500/10 hover:text-slate-900" 
          onClick={handleToggleMaximize} type="button" aria-label={isRestorable ? "Restore" : "Maximize"} title={isRestorable ? "Restore" : "Maximize"}
        >
          <span className={`relative block w-[14px] h-[14px] before:content-[''] before:absolute before:border-[1.6px] before:border-current before:rounded-sm ${isRestorable ? "before:inset-[4px_1px_1px_4px] after:content-[''] after:absolute after:inset-[1px_4px_4px_1px] after:border-[1.6px] after:border-current after:rounded-sm after:bg-white/70" : "before:inset-[2px]"}`} aria-hidden="true"></span>
        </button>
        <button 
          className="group relative inline-flex items-center justify-center w-[46px] h-full p-0 rounded-none text-slate-600 bg-transparent cursor-pointer transition-colors duration-150 hover:bg-red-600 hover:text-white" 
          onClick={handleClose} type="button" aria-label="Close" title="Close"
        >
          <span className="relative block w-[14px] h-[14px] before:content-[''] before:absolute before:left-[2px] before:top-[6px] before:w-[10px] before:h-[1.5px] before:rounded-full before:bg-current before:rotate-45 after:content-[''] after:absolute after:left-[2px] after:top-[6px] after:w-[10px] after:h-[1.5px] after:rounded-full after:bg-current after:-rotate-45" aria-hidden="true"></span>
        </button>
      </div>
    </header>
  );
}
