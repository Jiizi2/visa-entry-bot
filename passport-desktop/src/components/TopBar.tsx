import React from 'react';

interface TopBarProps {
  pageTitle: string;
  pageSubtitle: string;
}

export default function TopBar({ pageTitle, pageSubtitle }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-copy">
        <p id="topbar-eyebrow" className="topbar-eyebrow">{pageSubtitle}</p>
        <h2 id="topbar-title" className="topbar-title">{pageTitle}</h2>
      </div>
      <div className="topbar-actions">
        <span id="topbar-status" className="status-chip neutral">Menunggu</span>
      </div>
    </header>
  );
}
