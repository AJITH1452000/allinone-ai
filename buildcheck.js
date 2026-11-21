// Project verification — the "build it and check it" step Claude does before handing over a project.
//  1. real Vite production build (catches syntax errors, missing files, wrong imports/exports, JSX in .js …)
//  2. render <App /> with React on the server (catches crashes like "Cannot read properties of undefined")
// Generated projects are written to data/builds/<id>/, so they use Evolvix's own installed packages (no npm install).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BUILDS = path.join(ROOT, 'data', 'builds');

// Browser-only things a component may touch while rendering — not real bugs when rendered on the server
const BROWSER_ONLY = /\b(window|document|localStorage|sessionStorage|navigator|IntersectionObserver|ResizeObserver|matchMedia) is not defined/i;

const clean = (s = '') => String(s).replaceAll('\\', '/')
  .replace(/(file:\/\/\/?)?([A-Za-z]:)?\/[^\n()]*?\/data\/builds\/[0-9a-f]{8}\//g, '') // …/data/builds/ab12cd34/src/x.jsx → src/x.jsx
  .replace(/\u001b\[[0-9;]*m/g, '')
  .split('\n').filter((l) => l.trim() && !/node_modules|node:internal|at async|at ModuleJob/.test(l)).slice(0, 8).join('\n')
  .slice(0, 900);

// MUI icons are ESM folders Node can't import directly. For the RENDER check only, every icon import
// (`import MenuIcon from '@mui/icons-material/Menu'`, `import { GitHub, Email as Mail } from '@mui/icons-material'`)
// is rewritten to a tiny stub component. (The real Vite build above still checks the real icon imports.)
const STUB = '\0evx-icon-stub';
const iconStub = () => ({
  name: 'evx-icon-stub',
  enforce: 'pre',
  resolveId(id) { return id === STUB ? STUB : null; },
  load(id) { return id === STUB ? "import { createElement } from 'react';\nexport default (p) => createElement('svg', { width: 24, height: 24 });" : null; },
  transform(code, id) {
    if (!/\/src\/.*\.(jsx?|tsx?)$/.test(id.replaceAll('\\', '/')) || !code.includes('@mui/icons-material')) return null;
    let out = code
      .replace(/import\s+(\w+)\s+from\s+['"]@mui\/icons-material\/[\w-]+['"];?/g, (_, n) => `const ${n} = __evxIcon;`)
      .replace(/import\s*\{([^}]*)\}\s*from\s+['"]@mui\/icons-material['"];?/g, (_, list) => list.split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => `const ${s.split(/\s+as\s+/).pop()} = __evxIcon;`).join(' '));
    return { code: `import __evxIcon from '${STUB}';\n${out}`, map: null };
  },
});

// Render crashes come from eval'd modules: the stack names the component ("at Hero (eval …:26:139)") but not the file.
// Find the file that defines that component, then the line that reads the failing property ("reading 'buttons'").
function locate(e, files) {
  const m = /at (\w+) \(eval at instantiateModule[^)]*\), <anonymous>:(\d+)/.exec(e.stack || '');
  if (!m) return '';
  const [, comp, lineStr] = m;
  const f = files.find((x) => /\.(jsx|tsx|js)$/.test(x.path) && x.path.split('/').pop().replace(/\.\w+$/, '') === comp)
    || files.find((x) => new RegExp(`(function\\s+${comp}\\b|const\\s+${comp}\\s*=)`).test(x.content));
  if (!f) return `\n   in component <${comp}>`;
  const lines = f.content.split('\n');
  let n = Number(lineStr);
  const prop = /reading '([\w$]+)'/.exec(e.message || '');
  if (prop) {
    const hits = lines.map((l, i) => (l.includes(`.${prop[1]}`) ? i + 1 : 0)).filter(Boolean);
    if (hits.length) n = hits.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
  }
  const code = (lines[n - 1] || '').trim();
  return `\n   in ${f.path} line ${n} (component <${comp}>)${code ? `:   ${code.slice(0, 160)}` : ''}`;
}

export function writeProject(files) {
  const dir = path.join(BUILDS, crypto.randomUUID().slice(0, 8));
  for (const f of files) {
    if (!f.path || /(^|\/)\.\.(\/|$)/.test(f.path) || path.isAbsolute(f.path)) continue; // stay inside the build folder
    const p = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.content);
  }
  return dir;
}

/** Returns a list of readable error messages (empty = the project builds AND renders). */
export async function checkProject(files, { timeoutMs = 60_000 } = {}) {
  const { build, createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const dir = writeProject(files);
  const errors = [];
  const withTimeout = (p, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took too long`)), timeoutMs))]);
  try {
    // 1. Real production build (our own config — the model's vite.config.js is ignored on purpose)
    // Build from index.html AND the entry file, so a broken index.html can't hide the app's code from the check
    const entry = ['src/main.jsx', 'src/main.tsx', 'src/main.js', 'src/index.jsx', 'src/index.js'].find((p) => files.some((f) => f.path === p));
    const input = { ...(files.some((f) => f.path === 'index.html') && { html: path.join(dir, 'index.html') }), ...(entry && { entry: path.join(dir, entry) }) };
    try {
      await withTimeout(build({
        root: dir, configFile: false, logLevel: 'silent', plugins: [react()],
        build: { outDir: path.join(dir, 'dist'), write: false, minify: false, reportCompressedSize: false, rollupOptions: { input } },
      }), 'The build');
    } catch (e) {
      const file = e.id || e.loc?.file;
      errors.push(`Build error: ${clean(e.message)}${file && !clean(e.message).includes(clean(file)) ? `\n   in ${clean(file)}${e.loc?.line ? ` line ${e.loc.line}` : ''}` : ''}`);
    }
    // 2. Render the app once (only if it built)
    const app = ['src/App.jsx', 'src/App.tsx', 'src/App.js'].find((p) => files.some((f) => f.path === p));
    if (!errors.length && app) {
      const server = await createServer({
        root: dir, configFile: false, logLevel: 'silent', plugins: [iconStub(), react()], appType: 'custom',
        server: { middlewareMode: true, hmr: false, watch: null },
        ssr: { noExternal: [/^@mui\/icons-material/] },
      });
      try {
        // The render runs INSIDE Vite's module graph (one shared copy of React for the app, MUI and the renderer)
        fs.writeFileSync(path.join(dir, '__evx_render.jsx'),
          `import { createElement } from 'react';\nimport { renderToString } from 'react-dom/server';\nimport * as M from '/${app}';\n`
          + 'export default () => (typeof M.default === \'function\' ? renderToString(createElement(M.default)) : \'NO_DEFAULT\');\n');
        const mod = await withTimeout(server.ssrLoadModule('/__evx_render.jsx'), 'Loading the app');
        const original = console.error;
        let reactError = '';
        console.error = (...a) => { const s = a.map(String).join(' '); if (/Warning: (Each child|validateDOMNesting|Received|React does not recognize)/.test(s)) return; if (!reactError && /Error|is not defined|Cannot read/.test(s)) reactError = s; };
        // Fake browser objects during the render, so code that reads localStorage/window keeps going and REAL bugs
        // behind those lines are found (a missing variable must not hide behind "localStorage is not defined")
        const store = new Map();
        const fakeStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: () => null, length: 0 };
        const fakes = {
          localStorage: fakeStorage, sessionStorage: fakeStorage,
          matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
          IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
          ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
          scrollTo: () => {}, alert: () => {}, confirm: () => true,
        };
        const saved = {};
        for (const [k, v] of Object.entries(fakes)) { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); }
        let html;
        try { html = mod.default(); } finally {
          console.error = original;
          for (const k of Object.keys(fakes)) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
        }
        if (html === 'NO_DEFAULT') errors.push(`Run error: ${app} has no default export (add: export default App).`);
        if (reactError && !BROWSER_ONLY.test(reactError)) errors.push(`Run error: ${clean(reactError)}`);
      } catch (e) {
        if (!BROWSER_ONLY.test(e.message)) {
          if (e.stack) server.ssrFixStacktrace(e);
          const file = e.id || e.loc?.file || e.file;
          const where = (e.stack || '').split('\n').find((l) => /[\\/]src[\\/][^:]+\.(jsx?|tsx?):\d+/.test(l) && !/__evx_render/.test(l));
          errors.push(`Run error: ${clean(e.message)}${file ? `\n   in ${clean(file)}` : where ? `\n   ${clean(where.trim())}` : locate(e, files)}`);
        }
      } finally {
        await server.close();
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return [...new Set(errors)];
}
