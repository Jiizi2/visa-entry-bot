import React, { useState } from 'react';
import logoUrl from '../assets/brand/entrymate-icon.png';

type Page = 'import' | 'prepare' | 'scan' | 'validation' | 'entry';

interface SidebarProps {
  currentPage: Page;
  onChangePage: (page: Page) => void;
}

export default function Sidebar({ currentPage, onChangePage }: SidebarProps) {
  const [isMinimized, setIsMinimized] = useState(false);

  const steps = [
    { id: 'import', label: 'Folder', subtitle: 'Pilih folder kerja', icon: 'folder' },
    { id: 'prepare', label: 'Prepare', subtitle: 'Rapikan foto', icon: 'crop' },
    { id: 'scan', label: 'Scan', subtitle: 'Menunggu scan', icon: 'document_scanner' },
    { id: 'validation', label: 'Review', subtitle: 'Semua data dicek', icon: 'fact_check' },
    { id: 'entry', label: 'Export', subtitle: 'Selesaikan review', icon: 'output' },
  ] as const;

  return (
    <aside 
      className={`flex flex-col z-50 overflow-hidden bg-white/95 backdrop-blur-md border border-slate-300/40 rounded-2xl my-4 ml-4 py-6 shadow-[0_8px_30px_rgba(0,0,0,0.04)] shrink-0 transition-all duration-300 h-[calc(100vh-var(--window-titlebar-height)-32px)] ${isMinimized ? 'w-[88px] min-w-[88px]' : 'w-[280px] min-w-[280px]'}`} 
      aria-label="Navigasi utama"
    >
      {/* Brand */}
      <div 
        className={`flex items-center gap-3 mb-10 cursor-pointer ${isMinimized ? 'justify-center px-0' : 'px-6'}`} 
        onClick={() => setIsMinimized(!isMinimized)}
        title={isMinimized ? "Perbesar Sidebar" : "Perkecil Sidebar"}
      >
        <img 
          className="w-9 h-9 rounded-lg shrink-0 transition-transform duration-300 hover:scale-105" 
          src={logoUrl} 
          alt="EntryMate Logo" 
          aria-hidden="true" 
        />
        {!isMinimized && (
          <div className="flex flex-col leading-none text-slate-900 overflow-hidden">
            <strong className="text-[20px] font-bold tracking-tight">EntryMate</strong>
            <span className="text-[10px] font-normal text-slate-600 mt-1">By Ghaniya</span>
          </div>
        )}
      </div>

      {/* Navigation Links */}
      <nav className={`flex flex-col gap-6 grow ${isMinimized ? 'items-center px-0' : 'px-6'}`} aria-label="Progress tahapan">
        {steps.map((step) => {
          const isActive = currentPage === step.id;
          return (
            <button
              key={step.id}
              className={`group relative flex items-center w-full bg-transparent border-none p-0 text-left cursor-pointer ${isMinimized ? 'justify-center' : 'gap-4'}`}
              onClick={() => onChangePage(step.id as Page)}
              type="button"
              title={isMinimized ? step.label : ''}
            >
              <div className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-8 bg-[#004ac6] rounded-r-md transition-opacity duration-200 ${isActive ? 'opacity-100' : 'opacity-0'} ${isMinimized ? 'left-0' : '-left-6'}`} aria-hidden="true"></div>
              
              <div className={`flex items-center justify-center w-10 h-10 rounded-full shrink-0 transition-all duration-200 ${isActive ? 'bg-gradient-to-r from-[#004ac6] to-[#0053db] text-white font-bold shadow-md' : 'bg-slate-200/80 text-slate-600 group-hover:bg-slate-300/80'}`} aria-hidden="true">
                <span className="material-symbols-outlined text-[24px]">{step.icon}</span>
              </div>
              
              {!isMinimized && (
                <div className={`flex flex-col transition-all duration-200 ${isActive ? 'opacity-100 text-[#004ac6]' : 'opacity-60 group-hover:opacity-100 group-hover:text-[#004ac6]'}`}>
                  <strong className={`text-base leading-tight ${isActive ? 'font-bold' : 'font-medium'}`}>{step.label}</strong>
                  <span className={`text-[11px] font-normal ${isActive ? 'text-[#004ac6]/80' : ''}`}>{step.subtitle}</span>
                </div>
              )}
            </button>
          );
        })}
      </nav>

    </aside>
  );
}
