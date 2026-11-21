import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import App from './App';
import PasswordGate from './components/PasswordGate';
import OfficeGate from './components/OfficeGate';
// Self-hosted fonts (no Google Fonts request — nothing leaves the network)
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/noto-sans-tamil/400.css';
import '@fontsource/noto-sans-tamil/600.css';
import { makeTheme } from './theme';

const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
ReactDOM.createRoot(document.getElementById('root')).render(
  <ThemeProvider theme={makeTheme(dark ? 'dark' : 'light')}>
    <CssBaseline />
    {/* Office mode: accounts + approvals (OfficeGate). Otherwise the optional site password (PasswordGate). */}
    <OfficeGate app={<App />} fallback={<PasswordGate><App /></PasswordGate>} />
  </ThemeProvider>,
);

// Installable app (Account menu → Get apps and extensions)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; });
