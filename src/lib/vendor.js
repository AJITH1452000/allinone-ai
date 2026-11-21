// Everything the live preview loads from a CDN, with its local copy in public/vendor/ (downloaded once: npm run vendor).
// In office mode the preview uses ONLY the local copies → nothing is fetched from the internet.
export const VENDOR = {
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.development.js': 'react-18.3.1.development.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.development.js': 'react-dom-18.3.1.development.js',
  'https://unpkg.com/@mui/material@5.16.7/umd/material-ui.production.min.js': 'material-ui-5.16.7.production.min.js',
  'https://unpkg.com/prop-types@15.8.1/prop-types.min.js': 'prop-types-15.8.1.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/recharts/2.12.7/Recharts.js': 'recharts-2.12.7.js',
  'https://cdn.jsdelivr.net/npm/lucide-react@0.263.1/dist/umd/lucide-react.min.js': 'lucide-react-0.263.1.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.24.7/babel.min.js': 'babel-standalone-7.24.7.min.js',
  'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js': 'mermaid-10.9.1.min.js',
  'https://cdn.tailwindcss.com/3.4.5': 'tailwind-play-3.4.5.js',
};

/** Office mode: point every CDN URL at /vendor and drop web-font links (the preview falls back to system fonts) */
export function localizeDoc(html) {
  let out = html;
  for (const [url, file] of Object.entries(VENDOR)) out = out.split(url).join(`${window.location.origin}/vendor/${file}`);
  return out.replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/g, '');
}
