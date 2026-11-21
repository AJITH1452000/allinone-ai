import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, IconButton, Typography, Tooltip, alpha } from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { localizeDoc } from '../lib/vendor';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// `{ A, B as C }` → `{ A, B: C }` (import syntax → object destructuring)
const destructure = (names) => names.replace(/\s+as\s+/g, ': ');

/**
 * Single-file React → runnable HTML page (compiled in the browser by Babel).
 * Supports the default stack: React hooks, MUI (@mui/material + styles), MUI icons, Recharts, plus Tailwind & Lucide.
 */
export function reactDoc(code) {
  let src = code;
  let name = /export\s+default\s+function\s+(\w+)/.exec(src)?.[1] || /export\s+default\s+(\w+)\s*;?/.exec(src)?.[1];
  const usesMui = /from\s+['"]@mui\/(material|system)/.test(src);
  const usesCharts = /from\s+['"]recharts['"]/.test(src);
  src = src
    // MUI components: import { Button, Box } from '@mui/material'  /  import Button from '@mui/material/Button'
    .replace(/^\s*import\s+(\{[^}]*\})\s+from\s+['"]@mui\/(material|system)(\/styles)?['"];?/gm, (_, n) => `const ${destructure(n)} = MaterialUI;`)
    .replace(/^\s*import\s+(\w+)\s*,\s*(\{[^}]*\})\s+from\s+['"]@mui\/material(\/styles)?['"];?/gm, (_, d, n) => `const ${destructure(n)} = MaterialUI;`)
    .replace(/^\s*import\s+(\w+)\s+from\s+['"]@mui\/material\/(\w+)['"];?/gm, (_, v, comp) => `const ${v} = MaterialUI.${comp};`)
    // MUI icons have no browser build → a simple placeholder icon with the same name
    .replace(/^\s*import\s+(\w+)\s+from\s+['"]@mui\/icons-material\/\w+['"];?/gm, (_, v) => `const ${v} = ICONS.${v};`)
    .replace(/^\s*import\s+(\{[^}]*\})\s+from\s+['"]@mui\/icons-material['"];?/gm, (_, n) => `const ${destructure(n)} = ICONS;`)
    // Recharts
    .replace(/^\s*import\s+(\{[^}]*\})\s+from\s+['"]recharts['"];?/gm, (_, n) => `const ${destructure(n)} = Recharts;`)
    // Lucide
    .replace(/^\s*import\s+[^;]*?from\s+['"]lucide-react['"];?/gm, (m) => `const ${destructure(m.match(/\{[^}]*\}/)?.[0] || '{}')} = window.LucideReact || ICONS;`)
    // React
    .replace(/^\s*import\s+React\s*,?\s*(\{[^}]*\})?\s*from\s+['"]react['"];?/gm, (_, named) => (named ? `const ${destructure(named)} = React;` : ''))
    .replace(/^\s*import\s+(\{[^}]*\})\s+from\s+['"]react['"];?/gm, (_, n) => `const ${destructure(n)} = React;`)
    .replace(/^\s*import\s+[^;]*;?$/gm, '') // other imports (css files, etc.) are dropped
    .replace(/export\s+default\s+function\s+/, 'function ')
    .replace(/^\s*export\s+default\s+\w+\s*;?\s*$/m, '')
    .replace(/^\s*export\s+/gm, '');
  if (!name) name = /function\s+([A-Z]\w*)/.exec(src)?.[1] || /const\s+([A-Z]\w*)\s*=/.exec(src)?.[1] || 'App';
  // crossorigin on every CDN script: without it the browser hides their errors as just "Script error."
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${usesMui ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">' : '<script src="https://cdn.tailwindcss.com/3.4.5" crossorigin="anonymous"></script>'}
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.development.js" crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.development.js" crossorigin="anonymous"></script>
${usesMui ? '<script src="https://unpkg.com/@mui/material@5.16.7/umd/material-ui.production.min.js" crossorigin="anonymous"></script>' : ''}
${usesCharts ? '<script src="https://unpkg.com/prop-types@15.8.1/prop-types.min.js" crossorigin="anonymous"></script>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/recharts/2.12.7/Recharts.js" crossorigin="anonymous"></script>' : ''}
<script src="https://cdn.jsdelivr.net/npm/lucide-react@0.263.1/dist/umd/lucide-react.min.js" crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.24.7/babel.min.js" crossorigin="anonymous"></script>
<style>body{margin:0;font-family:system-ui,sans-serif}#err{color:#b91c1c;font:13px monospace;white-space:pre-wrap;padding:16px}</style>
</head><body><div id="root"></div><div id="err"></div>
<script>
  const showErr = (msg) => { const el = document.getElementById('err'); el.textContent = (el.textContent ? el.textContent + '\\n' : '') + msg; try { parent.postMessage({ evxPreviewError: String(msg) }, '*'); } catch (e) {} };
  // Fallback icon set if Lucide / MUI icons can't load: any icon name renders a small circle
  window.ICONS = new Proxy({}, { get: () => (p) => React.createElement('svg', { width: p?.size || 20, height: p?.size || 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, className: p?.className, style: { verticalAlign: 'middle' } }, React.createElement('circle', { cx: 12, cy: 12, r: 9 })) });
  // Models sometimes invent components that don't exist (e.g. MUI "Text"). Instead of crashing the whole preview,
  // render them as a plain box and show a small warning.
  const missing = new Set();
  const safeLib = (lib, libName) => new Proxy(lib || {}, { get: (t, k) => {
    if (k in t) return t[k];
    if (typeof k === 'string' && /^[A-Z]/.test(k)) {
      missing.add(libName + '.' + k);
      setTimeout(() => showErr('Note: "' + k + '" does not exist in ' + libName + ' — shown as a plain box. Ask the model to fix it.'), 0);
      return (p) => React.createElement('div', { style: p?.style, className: p?.className }, p?.children);
    }
    return t[k];
  } });
  if (window.MaterialUI) window.MaterialUI = safeLib(window.MaterialUI, '@mui/material');
  if (window.Recharts) window.Recharts = safeLib(window.Recharts, 'recharts');
  window.onerror = (m, src, line, col, err) => { showErr('Preview error: ' + (err?.message || m)); };
  window.addEventListener('unhandledrejection', (e) => showErr('Preview error: ' + (e.reason?.message || e.reason)));
  // Catches render errors with the real message (CDN errors otherwise show only "Script error.")
  class Boundary extends React.Component {
    constructor(p) { super(p); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    render() { return this.state.error ? React.createElement('pre', { style: { color: '#b91c1c', padding: 16, whiteSpace: 'pre-wrap', font: '13px monospace' } }, 'Preview error: ' + this.state.error.message) : this.props.children; }
  }
  window.Boundary = Boundary;
</script>
<script id="app-src" type="text/plain">${src.replace(/<\/script/gi, '<\\/script')}
ReactDOM.createRoot(document.getElementById('root')).render(<Boundary><${name} /></Boundary>);</script>
<script>
  // Compile the AI's code ourselves so a mistake shows the real message and line instead of "Script error."
  (function () {
    if (!window.Babel) return showErr('Preview error: the code compiler (Babel) could not load — check your internet connection.');
    if (!window.React || !window.ReactDOM) return showErr('Preview error: React could not load — check your internet connection.');
    const code = document.getElementById('app-src').textContent;
    let out;
    try { out = Babel.transform(code, { presets: ['react', 'typescript'], filename: 'App.tsx' }).code; }
    catch (tsErr) {
      try { out = Babel.transform(code, { presets: ['react'], filename: 'App.jsx' }).code; } // plain JS that TS rejects
      catch (err) { return showErr('Preview error — the code has a mistake:\\n' + err.message + '\\n\\nAsk the model to fix it, or copy this message to it.'); }
    }
    try { (0, eval)(out); } catch (err) { showErr('Preview error: ' + err.message); }
  })();
</script></body></html>`;
}

/**
 * Multi-file React + Vite project → one runnable page. Every file is compiled in the browser, imports between files are
 * connected with a small require(), and npm packages map to browser builds (React, MUI, Recharts; MUI icons → placeholders).
 */
export function projectDoc(files) {
  const map = Object.fromEntries(files.filter((f) => /\.(jsx?|tsx?|css|json)$/i.test(f.path)).map((f) => [f.path.replace(/^\.?\//, ''), f.content]));
  const json = JSON.stringify(map).replace(/</g, '\\u003c');
  const usesCharts = files.some((f) => /from\s+['"]recharts['"]/.test(f.content));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap">
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.development.js" crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.development.js" crossorigin="anonymous"></script>
<script src="https://unpkg.com/@mui/material@5.16.7/umd/material-ui.production.min.js" crossorigin="anonymous"></script>
${usesCharts ? '<script src="https://unpkg.com/prop-types@15.8.1/prop-types.min.js" crossorigin="anonymous"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/recharts/2.12.7/Recharts.js" crossorigin="anonymous"></script>' : ''}
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.24.7/babel.min.js" crossorigin="anonymous"></script>
<style>body{margin:0;font-family:Roboto,system-ui,sans-serif}#err{color:#b91c1c;font:13px monospace;white-space:pre-wrap;padding:16px}#err:empty{display:none}</style>
</head><body><div id="root"></div><div id="err"></div>
<script>
const showErr = (m) => { const el = document.getElementById('err'); el.textContent += (el.textContent ? '\\n\\n' : '') + m; try { parent.postMessage({ evxPreviewError: String(m) }, '*'); } catch (e) {} };
const FILES = ${json};
// Where did it break? File + line + the code on that line (compiled with retainLines + sourceURL, so stack lines are real)
const where = (err) => {
  const m = /((?:src|components|pages)\\/[\\w\\/.-]+\\.(?:jsx?|tsx?)):(\\d+)/.exec((err && err.stack) || '');
  if (!m || !(m[1] in FILES)) return '';
  const lines = FILES[m[1]].split('\\n');
  let n = Number(m[2]);
  // "reading 'buttons'" → the nearest line that really reads .buttons (JSX line mapping can be a few lines off)
  const prop = /reading '([\\w$]+)'/.exec((err && err.message) || '');
  if (prop) {
    const hits = lines.map((l, i) => (l.includes('.' + prop[1]) ? i + 1 : 0)).filter(Boolean);
    if (hits.length) n = hits.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
  }
  const line = (lines[n - 1] || '').trim();
  return '\\n   in ' + m[1] + ' line ' + n + (line ? ':   ' + line.slice(0, 160) : '');
};
window.onerror = (m, s, l, c, e) => showErr('Preview error: ' + (e?.message || m) + where(e));
const icon = (p) => React.createElement('svg', { width: (p && p.fontSize === 'large') ? 32 : 22, height: (p && p.fontSize === 'large') ? 32 : 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, style: Object.assign({ verticalAlign: 'middle' }, p && p.style) }, React.createElement('circle', { cx: 12, cy: 12, r: 8 }));
const ICONS = new Proxy({}, { get: (t, k) => (k === '__esModule' ? true : icon) });
const MUI = new Proxy(window.MaterialUI || {}, { get: (t, k) => { if (k in t) return t[k]; if (k === '__esModule') return true;
  if (typeof k === 'string' && /^[A-Z]/.test(k)) { setTimeout(() => showErr('Note: "' + k + '" is not part of @mui/material — shown as a plain box.'), 0); return (p) => React.createElement('div', { style: p && p.style }, p && p.children); } return t[k]; } });
const withDefault = (o) => new Proxy(o, { get: (t, k) => (k === 'default' ? t : k === '__esModule' ? true : t[k]) });
const EXTERNAL = {
  'react': withDefault(React), 'react-dom': withDefault(ReactDOM), 'react-dom/client': withDefault(ReactDOM),
  '@mui/material': MUI, '@mui/material/styles': MUI, '@mui/system': MUI, '@mui/icons-material': ICONS,
  '@emotion/react': withDefault({}), '@emotion/styled': withDefault({}), 'recharts': window.Recharts ? withDefault(window.Recharts) : withDefault({}),
};
const norm = (p) => { const out = []; for (const s of p.split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); } return out.join('/'); };
const resolve = (spec, from) => {
  const base = spec.startsWith('/') ? spec.slice(1) : norm(from.split('/').slice(0, -1).concat(spec).join('/'));
  const tries = [base, base + '.jsx', base + '.js', base + '.tsx', base + '.ts', base + '/index.jsx', base + '/index.js', 'src/' + base];
  return tries.find((t) => t in FILES);
};
const cache = {};
function load(path) {
  if (cache[path]) return cache[path].exports;
  const mod = cache[path] = { exports: {} };
  const code = FILES[path];
  if (path.endsWith('.css')) { const s = document.createElement('style'); s.textContent = code; document.head.appendChild(s); return mod.exports; }
  if (path.endsWith('.json')) { mod.exports = JSON.parse(code); return mod.exports; }
  let out;
  const opts = (ts) => ({ filename: path, retainLines: true, presets: ts ? ['react', 'typescript'] : ['react'], plugins: ['transform-modules-commonjs'] });
  try { out = Babel.transform(code, opts(true)).code; }
  catch (e1) { try { out = Babel.transform(code, opts(false)).code; } catch (e) { throw new Error(path + ' has a mistake:\\n' + e.message); } }
  const req = (spec) => {
    if (EXTERNAL[spec]) return EXTERNAL[spec];
    if (spec.startsWith('@mui/material/')) { const n = spec.split('/')[2]; return n === 'styles' ? MUI : withDefault({ default: MUI[n] }); }
    if (spec.startsWith('@mui/icons-material/')) return { __esModule: true, default: icon };
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const target = resolve(spec, path);
      if (!target) { if (/\\.(css|scss|svg|png|jpe?g|gif|webp)$/i.test(spec)) return { __esModule: true, default: '' }; throw new Error(path + ' imports "' + spec + '" but that file was not generated.'); }
      return load(target);
    }
    if (/\\.(css|scss)$/.test(spec)) return {};
    showErr('Note: package "' + spec + '" is not available in the preview (it works after npm install).');
    return withDefault({});
  };
  new Function('require', 'module', 'exports', 'React', out + '\\n//# sourceURL=' + path)(req, mod, mod.exports, React);
  return mod.exports;
}
(function run() {
  if (!window.Babel || !window.React || !window.MaterialUI) return showErr('Preview error: a library could not load — check your internet connection.');
  try {
    const entry = ['src/main.jsx', 'src/main.tsx', 'src/main.js', 'src/index.jsx', 'src/index.js'].find((p) => p in FILES);
    if (entry) load(entry);
    else {
      const app = ['src/App.jsx', 'src/App.tsx', 'src/App.js', 'App.jsx'].find((p) => p in FILES);
      if (!app) return showErr('Preview error: no src/main.jsx or src/App.jsx in this project.');
      const App = load(app).default;
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
    }
  } catch (e) { showErr('Preview error: ' + e.message + where(e)); }
})();
</script></body></html>`;
}

const mermaidDoc = (code) => `<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
<style>body{margin:0;padding:24px;display:flex;justify-content:center;font-family:system-ui}</style></head>
<body><pre class="mermaid">${esc(code)}</pre><script>mermaid.initialize({ startOnLoad: true, theme: 'default' });</script></body></html>`;

export function buildDoc({ code, lang, files }) {
  if (lang === 'project') return projectDoc(files || []);
  if (['react', 'jsx', 'tsx'].includes(lang)) return reactDoc(code);
  if (lang === 'mermaid') return mermaidDoc(code);
  if (lang === 'svg' || lang === 'xml') return `<html><body style="margin:0;display:grid;place-items:center;min-height:100vh">${code}</body></html>`;
  return code;
}

export default function PreviewPanel({ preview, onClose, onFix }) {
  const frameRef = useRef(null);
  const [errors, setErrors] = useState([]);
  // Office mode: CDN files come from /vendor (local) and the preview runs in /preview-frame — a sandboxed page with its own
  // strict CSP and an opaque origin (no access to the app's cookies or API). The document is posted into it.
  const office = !!window.__EVX_OFFICE;
  const doc = useMemo(() => (preview ? (office ? localizeDoc(buildDoc(preview)) : buildDoc(preview)) : ''), [preview, office]);
  const docRef = useRef(doc);
  docRef.current = doc;
  useEffect(() => { setErrors([]); }, [doc]);
  // Errors reported by the preview (only from our own iframe), real ones only — notes about placeholders are not errors
  useEffect(() => {
    const onMsg = (e) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      if (e.data?.evxFrameReady) { frameRef.current.contentWindow.postMessage({ type: 'evx-doc', html: docRef.current }, '*'); return; }
      if (!e.data?.evxPreviewError) return;
      const m = e.data.evxPreviewError;
      if (/^Note:/.test(m)) return;
      setErrors((list) => (list.includes(m) ? list : [...list, m].slice(0, 8)));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  if (!preview) return null;
  const openTab = () => {
    // Office mode: a blob: page would run the generated code with the APP's origin (it could call the API) → not allowed
    if (office) return alert('In office mode the preview only runs inside its sandbox. Download the project (ZIP) to run it locally.');
    const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
    window.open(url, '_blank');
  };
  return (
    <Box sx={{ width: { xs: '100%', md: '45%' }, position: { xs: 'fixed', md: 'relative' }, inset: { xs: 0, md: 'auto' }, zIndex: 1300,
      borderLeft: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1, borderBottom: 1, borderColor: 'divider', gap: 1 }}>
        <Typography noWrap sx={{ flex: 1, fontWeight: 600, fontSize: 14.5 }}>{preview.title || 'Live preview'}</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{preview.lang}</Typography>
        <Tooltip title="Open in new tab"><IconButton size="small" onClick={openTab}><OpenInNewIcon fontSize="small" /></IconButton></Tooltip>
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Box>
      {errors.length > 0 && onFix && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, bgcolor: (t) => alpha(t.palette.error.main, 0.08), borderBottom: 1, borderColor: 'divider' }}>
          <Typography sx={{ flex: 1, fontSize: 13, color: 'error.main' }}>
            ⚠️ {errors.length} error{errors.length > 1 ? 's' : ''} in this {preview.lang === 'project' ? 'project' : 'code'}
          </Typography>
          <Button size="small" variant="contained" color="error" disableElevation startIcon={<AutoFixHighIcon />}
            onClick={() => onFix(errors.join('\n'), preview.lang === 'project')}>Fix with AI</Button>
        </Box>
      )}
      <Box component="iframe" ref={frameRef} key={doc.length + preview.lang} title="preview" {...(office ? { src: '/preview-frame' } : { srcDoc: doc })}
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        sx={{ flex: 1, border: 0, bgcolor: '#fff' }} />
    </Box>
  );
}
