import { Box, IconButton, Typography, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Single-file React (+ Tailwind + Lucide icons) → runnable HTML page (compiled in the browser by Babel)
function reactDoc(code) {
  let src = code;
  let name = /export\s+default\s+function\s+(\w+)/.exec(src)?.[1] || /export\s+default\s+(\w+)\s*;?/.exec(src)?.[1];
  src = src
    .replace(/^\s*import\s+[^;]*?from\s+['"]lucide-react['"];?/gm, (m) => `const ${m.match(/\{[^}]*\}/)?.[0] || '{}'} = window.LucideReact || ICONS;`)
    .replace(/^\s*import\s+React\s*,?\s*(\{[^}]*\})?\s*from\s+['"]react['"];?/gm, (_, named) => (named ? `const ${named} = React;` : ''))
    .replace(/^\s*import\s+(\{[^}]*\})\s+from\s+['"]react['"];?/gm, 'const $1 = React;')
    .replace(/^\s*import\s+[^;]*;?$/gm, '') // other imports (css, etc.) are dropped
    .replace(/export\s+default\s+function\s+/, 'function ')
    .replace(/^\s*export\s+default\s+\w+\s*;?\s*$/m, '')
    .replace(/^\s*export\s+/gm, '');
  if (!name) name = /function\s+([A-Z]\w*)/.exec(src)?.[1] || /const\s+([A-Z]\w*)\s*=/.exec(src)?.[1] || 'App';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.tailwindcss.com/3.4.5"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/lucide-react@0.263.1/dist/umd/lucide-react.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.24.7/babel.min.js"></script>
<style>body{margin:0;font-family:system-ui,sans-serif}#err{color:#b91c1c;font:13px monospace;white-space:pre-wrap;padding:16px}</style>
</head><body><div id="root"></div><div id="err"></div>
<script>
  // Fallback icon set if Lucide can't load: any icon name renders a small circle
  window.ICONS = new Proxy({}, { get: () => (p) => React.createElement('svg', { width: p?.size || 20, height: p?.size || 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, className: p?.className }, React.createElement('circle', { cx: 12, cy: 12, r: 9 })) });
  window.onerror = (m) => { document.getElementById('err').textContent = 'Preview error: ' + m; };
</script>
<script type="text/babel" data-presets="react,typescript" data-filename="App.tsx">
${src}
ReactDOM.createRoot(document.getElementById('root')).render(<${name} />);
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
