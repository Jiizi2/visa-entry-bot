import React from 'react';
import ReactDOM from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App';
import { useStore } from './store';
import { MessageType } from '../../shared-protocol/MessageType';
import taskbarIconUrl from './assets/brand/entrymate-icon.png';
console.log('Shared Protocol MessageType loaded in React:', MessageType.HELLO);
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import './styles/global.css';

async function applyTaskbarIcon() {
  try {
    const response = await fetch(taskbarIconUrl);
    if (!response.ok) throw new Error(`Gagal memuat ikon (${response.status})`);
    await getCurrentWindow().setIcon(await response.arrayBuffer());
  } catch (error) {
    console.warn('Ikon taskbar EntryMate tidak dapat diterapkan:', error);
  }
}

void applyTaskbarIcon();

// Inisialisasi state dari localStorage sebelum React mount
useStore.getState().initializeStore();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
