// Helpers for Project mode (multi-file React + Vite answers).

/** <file path="src/App.jsx">…</file> blocks in an answer → [{ path, content, done }] (done = closing tag seen). */
export function parseFiles(text = '') {
  const files = [];
  String(text).replace(/<file\s+path=["']([^"']+)["']\s*>\n?([\s\S]*?)(<\/file>|$)/gi, (_, p, body, close) => {
    files.push({ path: p.trim().replace(/^\.?\//, ''), content: body.replace(/^\s*```[\w-]*\n/, '').replace(/\n?```\s*$/, '').replace(/\s+$/, '') + '\n', done: !!close });
    return '';
  });
  return files;
}

/** Files from earlier answers + newer answers (same path → newest wins). Keeps the original file order. */
export function mergeFiles(...lists) {
  const map = new Map();
  for (const list of lists) for (const f of list || []) map.set(f.path, f);
  return [...map.values()];
}

/**
 * Fixes the most common slip of small models automatically: using an MUI icon (<MenuIcon />) without importing it.
 * Adds `import MenuIcon from '@mui/icons-material/Menu';` — works in the live preview AND after npm install.
 */
// MUI components small models often use without importing
const MUI = new Set(('Accordion AccordionDetails AccordionSummary Alert AppBar Avatar Badge Box Breadcrumbs Button ButtonGroup Card CardActionArea '
  + 'CardActions CardContent CardHeader CardMedia Checkbox Chip CircularProgress Collapse Container CssBaseline Dialog DialogActions '
  + 'DialogContent DialogTitle Divider Drawer Fab Fade FormControl FormControlLabel Grid Grow IconButton InputAdornment InputLabel '
  + 'LinearProgress Link List ListItem ListItemButton ListItemIcon ListItemText Menu MenuItem Pagination Paper Rating Select Skeleton '
  + 'Slide Slider Snackbar Stack Step StepLabel Stepper Switch Tab Table TableBody TableCell TableContainer TableHead TableRow Tabs '
  + 'TextField ToggleButton ToggleButtonGroup Toolbar Tooltip Typography Zoom').split(' '));
// Already available in this file? (import X / import { X } / import React, { X } / import * as X / const|function|class X / destructuring)
const isDeclared = (name, code) => new RegExp(`(\\bimport\\s+${name}\\b|\\bimport\\s+(?:[\\w$]+\\s*,\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}|\\bimport\\s+\\*\\s+as\\s+${name}\\b|\\b(const|let|var|function|class)\\s+${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=)`).test(code);

// Relative import path from one project file to another, without extension: src/App.jsx → src/components/Navbar.jsx = ./components/Navbar
function relPath(from, to) {
  const a = from.split('/').slice(0, -1), b = to.replace(/\.(jsx?|tsx?)$/, '').split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const up = a.length - i;
  return (up ? '../'.repeat(up) : './') + b.slice(i).join('/');
}

const hasJsx = (code) => /<([A-Z]\w*|div|span|section|main|p|h[1-6]|ul|li|a|img|button|form|input|nav|header|footer|>)[\s/>]/.test(code) && /return\s*\(?\s*<|=>\s*\(?\s*</.test(code);
const exportsOf = (code) => ({
  hasDefault: /export\s+default\b/.test(code),
  named: new Set([...code.matchAll(/export\s+(?:const|let|var|function|class)\s+(\w+)/g)].map((m) => m[1])
    .concat([...code.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)))),
});
const resolveLocal = (from, spec, byPath) => {
  const base = from.split('/').slice(0, -1);
  for (const seg of spec.split('/')) { if (seg === '..') base.pop(); else if (seg !== '.') base.push(seg); }
  const p = base.join('/');
  return [p, `${p}.jsx`, `${p}.js`, `${p}.tsx`, `${p}.ts`, `${p}/index.jsx`, `${p}/index.js`].find((x) => byPath.has(x));
};

/**
 * Whole-project fixes for mistakes that make Vite show a BLANK page (all seen in real generated projects):
 *  - index.html without <script type="module" src="/src/main.jsx">  → nothing loads
 *  - index.html linking CSS files that were never generated
 *  - JSX inside a .js file (Vite refuses it)                         → renamed to .jsx
 *  - `import { data } from './data'` when data.js only has `export default` (and the reverse)
 *  - using React.StrictMode / React.useState without importing React
 */
function repairStructure(input) {
  let files = input.map((f) => ({ ...f }));
  const notes = [];
  // JSX in .js → .jsx (imports without extension keep working; imports that name ".js" are updated)
  for (const f of files) {
    if (/^src\/.*\.js$/.test(f.path) && hasJsx(f.content)) {
      const old = f.path; f.path = old.replace(/\.js$/, '.jsx'); f.renamedFrom = old; notes.push(`${old} → .jsx`);
      const oldName = old.split('/').pop(), newName = f.path.split('/').pop();
      for (const g of files) g.content = g.content.replaceAll(`/${oldName}'`, `/${newName}'`).replaceAll(`/${oldName}"`, `/${newName}"`);
    }
  }
  const byPath = new Map(files.map((f) => [f.path, f]));
  // Default vs named import mismatches between project files
  for (const f of files) {
    if (!/\.(jsx?|tsx?)$/.test(f.path)) continue;
    f.content = f.content.replace(/import\s+(\{\s*([\w\s,]+?)\s*\}|(\w+))\s+from\s+(['"])(\.{1,2}\/[^'"]+)\4;?/g, (whole, _all, namedList, def, q, spec) => {
      const target = byPath.get(resolveLocal(f.path, spec, byPath));
      if (!target) return whole;
      const ex = exportsOf(target.content);
      if (namedList) {
        const names = namedList.split(',').map((s) => s.trim()).filter(Boolean);
        if (names.length === 1 && !ex.named.has(names[0]) && ex.hasDefault) { notes.push(`${f.path}: { ${names[0]} } → default import`); return `import ${names[0]} from ${q}${spec}${q};`; }
      } else if (def && !ex.hasDefault && ex.named.has(def)) { notes.push(`${f.path}: ${def} → { ${def} }`); return `import { ${def} } from ${q}${spec}${q};`; }
      return whole;
    });
    // React.X used without importing React
    if (/\bReact\./.test(f.content) && !/import\s+React\b|import\s+\*\s+as\s+React\b/.test(f.content)) {
      f.content = `import React from 'react';\n${f.content}`; notes.push(`${f.path}: + import React`);
    }
  }
  // index.html must load the entry file; drop links to stylesheets that don't exist
  const entry = ['src/main.jsx', 'src/main.tsx', 'src/main.js', 'src/index.jsx', 'src/index.js'].find((p) => byPath.has(p));
  const html = files.find((f) => f.path === 'index.html');
  if (html) {
    html.content = html.content.replace(/\s*<link[^>]+href=["']\/?(src\/[^"']+\.css)["'][^>]*>/gi, (m, p) => (byPath.has(p) ? m : (notes.push(`index.html: removed missing ${p}`), '')));
    if (entry && !/<script[^>]+type=["']module["'][^>]*src=/i.test(html.content)) {
      html.content = html.content.includes('</body>') ? html.content.replace('</body>', `  <script type="module" src="/${entry}"></script>\n</body>`) : `${html.content}\n<script type="module" src="/${entry}"></script>\n`;
      notes.push('index.html: + entry script');
    }
  } else if (entry) {
    files.unshift({ path: 'index.html', content: `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>App</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/${entry}"></script>\n</body>\n</html>\n`, done: true });
    notes.push('+ index.html');
  }
  return { files, notes };
}

export function repairProject(input) {
  const { files, notes } = repairStructure(input);
  // The project's own components by name: Navbar → src/components/Navbar.jsx (only files with a default export)
  const own = new Map(files.filter((f) => /\.(jsx|tsx)$/.test(f.path) && /export\s+default\b/.test(f.content))
    .map((f) => [f.path.split('/').pop().replace(/\.\w+$/, ''), f.path]));
  // Named exports of project files (e.g. data.js: export const initialFeedbacks = …) → which file exports each name
  const exported = new Map();
  for (const g of files) if (/\.(jsx?|tsx?)$/.test(g.path)) for (const n of exportsOf(g.content).named) if (!exported.has(n)) exported.set(n, g.path);
  const used = (name, code) => new RegExp(`(?<![\\w$.'"\`])${name}(?![\\w$])`).test(code.replace(/\/\/.*$/gm, ''));
  const out = files.map((f) => {
    if (!/\.(jsx|tsx|js)$/.test(f.path)) return f;
    const code = f.content;
    const tags = new Set([...code.matchAll(/<([A-Z]\w*)\b/g)].map((m) => m[1]));
    const icons = [...tags].filter((n) => /Icon$/.test(n) && !MUI.has(n) && !own.has(n) && !isDeclared(n, code));
    const comps = [...tags].filter((n) => MUI.has(n) && !own.has(n) && !isDeclared(n, code));
    const locals = [...tags].filter((n) => own.has(n) && own.get(n) !== f.path && !isDeclared(n, code));
    // React hooks used without importing them
    const hooks = ['useState', 'useEffect', 'useMemo', 'useRef', 'useCallback', 'useContext', 'useReducer', 'useLayoutEffect']
      .filter((h) => new RegExp(`(?<![\\w.])${h}\\s*\\(`).test(code) && !isDeclared(h, code));
    // Data/helpers another project file exports but this file forgot to import (e.g. initialFeedbacks from ./data)
    const data = [...exported.entries()].filter(([n, p]) => p !== f.path && !tags.has(n) && used(n, code) && !isDeclared(n, code));
    const dataBySource = new Map();
    for (const [n, p] of data) dataBySource.set(p, [...(dataBySource.get(p) || []), n]);
    const missing = [...icons, ...comps, ...locals, ...hooks, ...data.map(([n]) => n)];
    if (!missing.length) return f;
    const lines = [
      ...(hooks.length ? [`import { ${hooks.join(', ')} } from 'react';`] : []),
      ...icons.map((n) => `import ${n} from '@mui/icons-material/${n.replace(/Icon$/, '')}';`),
      ...(comps.length ? [`import { ${comps.join(', ')} } from '@mui/material';`] : []),
      ...locals.map((n) => `import ${n} from '${relPath(f.path, own.get(n))}';`),
      ...[...dataBySource.entries()].map(([p, names]) => `import { ${names.join(', ')} } from '${relPath(f.path, p)}';`),
    ].join('\n');
    // after the last import line, or at the top
    const idx = [...code.matchAll(/^import .*$/gm)].pop();
    const at = idx ? idx.index + idx[0].length : 0;
    return { ...f, content: `${code.slice(0, at)}${at ? '\n' : ''}${lines}${at ? '' : '\n'}${code.slice(at)}`, repaired: missing };
  });
  // Structural fixes are reported on the first file so the project card can count them
  if (notes.length && out.length) out[0] = { ...out[0], repaired: [...(out[0].repaired || []), ...notes] };
  return out;
}

/** Text to send back to the model when the preview shows errors. */
export const fixRequest = (errors) => `The live preview of the project shows these errors:\n\n${errors.trim()}\n\n`
  + 'Fix the ROOT CAUSE (do not just hide the error with "&&" or "?." checks). Look at the exact line given, and check that each '
  + 'component reads its props the way App passes them (e.g. App passes data={data.hero} → inside Hero use data.buttons, not data.hero.buttons). '
  + 'If a component "is not defined" and no file exists for it, create that file. Import everything you use. '
  + 'Reply with ONLY the files you changed or created, complete, in the same <file path="…">…</file> format (unchanged files are kept automatically).';
