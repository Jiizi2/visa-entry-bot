import React, { useState } from 'react';
import './sidebar-modern.css';
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
    <aside className={`sidebar-modern ${isMinimized ? 'is-minimized' : ''}`} aria-label="Navigasi utama">
      {/* Brand */}
      <div 
        className="sidebar-brand-container" 
        onClick={() => setIsMinimized(!isMinimized)}
        title={isMinimized ? "Perbesar Sidebar" : "Perkecil Sidebar"}
      >
        <img 
          className="sidebar-logo-box" 
          src={logoUrl} 
          alt="EntryMate Logo" 
          aria-hidden="true" 
          style={{ padding: 0, background: 'transparent' }} 
        />
        {!isMinimized && (
          <div className="sidebar-brand-text">
            <strong>EntryMate</strong>
            <span>By Ghaniya</span>
          </div>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="sidebar-nav-container" aria-label="Progress tahapan">
        {steps.map((step, index) => {
          const isActive = currentPage === step.id;
          return (
            <button
              key={step.id}
              className={`sidebar-nav-item ${isActive ? 'is-active' : ''}`}
              onClick={() => onChangePage(step.id as Page)}
              type="button"
              title={isMinimized ? step.label : ''}
            >
              <div className="sidebar-nav-indicator" aria-hidden="true"></div>
              <div className="sidebar-nav-number" aria-hidden="true">
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{step.icon}</span>
              </div>
              {!isMinimized && (
                <div className="sidebar-nav-text">
                  <strong>{step.label}</strong>
                  <span>{step.subtitle}</span>
                </div>
              )}
            </button>
          );
        })}
      </nav>

    </aside>
  );
}
