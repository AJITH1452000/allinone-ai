import { Box, IconButton, Typography, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

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
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${usesMui ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">' : '<script src="https://cdn.tailwindcss.com/3.4.5"></script>'}
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.development.js" crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.development.js" crossorigin="anonymous"></script>
${usesMui ? '<script src="https://unpkg.com/@mui/material@5.16.7/umd/material-ui.production.min.js"></script>' : ''}
${usesCharts ? '<script src="https://unpkg.com/prop-types@15.8.1/prop-types.min.js"></script>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/recharts/2.12.7/Recharts.js"></script>' : ''}
<script src="https://cdn.jsdelivr.net/npm/lucide-react@0.263.1/dist/umd/lucide-react.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.24.7/babel.min.js"></script>
<style>body{margin:0;font-family:system-ui,sans-serif}#err{color:#b91c1c;font:13px monospace;white-space:pre-wrap;padding:16px}</style>
</head><body><div id="root"></div><div id="err"></div>
<script>
  const showErr = (msg) => { const el = document.getElementById('err'); el.textContent = (el.textContent ? el.textContent + '\\n' : '') + msg; };
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
<script type="text/babel" data-presets="react,typescript" data-filename="App.tsx">
${src}
ReactDOM.createRoot(document.getElementById('root')).render(<Boundary><${name} /></Boundary>);
</script></body></html>`;
}

const mermaidDoc = (code) => `<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
<style>body{margin:0;padding:24px;display:flex;justify-content:center;font-family:system-ui}</style></head>
<body><pre class="mermaid">${esc(code)}</pre><script>mermaid.initialize({ startOnLoad: true, theme: 'default' });</script></body></html>`;

export function buildDoc({ code, lang }) {
  if (['react', 'jsx', 'tsx'].includes(lang)) return reactDoc(code);
  if (lang === 'mermaid') return mermaidDoc(code);
  if (lang === 'svg' || lang === 'xml') return `<html><body style="margin:0;display:grid;place-items:center;min-height:100vh">${code}</body></html>`;
  return code;
}

export default function PreviewPanel({ preview, onClose }) {
  if (!preview) return null;
  const doc = buildDoc(preview);
  const openTab = () => {
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
      <Box component="iframe" key={preview.code.length + preview.lang} title="preview" srcDoc={doc}
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        sx={{ flex: 1, border: 0, bgcolor: '#fff' }} />
    </Box>
  );
}
