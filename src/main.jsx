import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

// Installable app (Account menu → Get apps and extensions)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; });
