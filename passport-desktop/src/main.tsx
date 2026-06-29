import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { useStore } from './store';
import { MessageType } from '../../shared-protocol/MessageType';
console.log('Shared Protocol MessageType loaded in React:', MessageType.HELLO);
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
import 'material-symbols/outlined.css';
import './styles/global.css';
// Inisialisasi state dari localStorage sebelum React mount
useStore.getState().initializeStore();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
