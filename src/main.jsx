import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import App from './App';
import PasswordGate from './components/PasswordGate';
import { makeTheme } from './theme';

const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
ReactDOM.createRoot(document.getElementById('root')).render(
  <ThemeProvider theme={makeTheme(dark ? 'dark' : 'light')}>
    <CssBaseline />
    <PasswordGate><App /></PasswordGate>
  </ThemeProvider>,
);

// Installable app (Account menu → Get apps and extensions)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; });
