// Instant code checks for answers (no model call, ~50 ms): runs after an answer finishes streaming.
// a) JS/JSX parses (esbuild)  b) every <Component> and useHook is imported or defined; MUI names and icon files exist
// c) no TODO / "..." / "// rest of" / lorem ipsum  d) .map() items have a key; no hooks inside if/for/while
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let esbuild = null;
let MUI = null;
const muiNames = async () => {
  if (MUI === null) { try { MUI = new Set(Object.keys(await import('@mui/material'))); } catch { MUI = false; } }
  return MUI;
};
const iconExists = (name) => fs.existsSync(path.join(root, 'node_modules', '@mui', 'icons-material', `${name}.js`));

/** Code blocks in an answer: ```lang fences, <artifact type="application/react">, and <file path="…"> blocks */
export function codeBlocks(text) {
  const out = [];
  for (const m of text.matchAll(/```([\w+-]*)[^\n]*\n([\s\S]*?)```/g)) out.push({ lang: m[1].toLowerCase(), code: m[2], where: m[1] || 'code' });
  for (const m of text.matchAll(/<artifact[^>]*type="application\/react"[^>]*>([\s\S]*?)<\/artifact>/g)) out.push({ lang: 'jsx', code: m[1], where: 'artifact' });
  for (const m of text.matchAll(/<file path="([^"]+\.(jsx?|tsx?))">([\s\S]*?)<\/file>/g)) out.push({ lang: m[2], code: m[3], where: m[1] });
  return out;
}

const JS_LANGS = new Set(['js', 'jsx', 'javascript', 'react', 'mjs', 'ts', 'tsx', 'typescript', 'node']);
const PLACEHOLDER = [
  [/\bTODO\b/, 'has a TODO left in it'],
  [/^\s*(\/\/\s*)?\.\.\.\s*$/m, 'has a "..." placeholder line'],
  [/\/\/\s*\.\.\.|\/\*\s*\.\.\.\s*\*\/|\{\s*\/\*\s*\.\.\.\s*\*\/\s*\}/, 'has a "..." placeholder comment'],
  [/\/\/\s*rest of|rest of (the|your) code/i, 'has a "rest of the code" placeholder'],
  [/lorem ipsum/i, 'has lorem ipsum placeholder text'],
];

function declared(code) {
  const names = new Set(['React', 'Fragment']);
  for (const m of code.matchAll(/import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g)) {
    for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().replace(/^\*\s*as\s+/, '').trim();
      if (n) names.add(n.replace(/^type\s+/, ''));
    }
  }
  for (const m of code.matchAll(/\b(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) for (const p of m[1].split(',')) names.add(p.split(':').pop().split('=')[0].trim());
  for (const m of code.matchAll(/\(\s*\{([^}]*)\}\s*\)/g)) for (const p of m[1].split(',')) names.add(p.split(':').pop().split('=')[0].trim()); // ({ icon: Icon }) props
  return names;
}

/** → list of exact problems (empty = passed). Local only: never call this on Vercel. */
export async function checkCode(text) {
  const errors = [];
  for (const { lang, code, where } of codeBlocks(text)) {
    if (!JS_LANGS.has(lang) && lang !== '') continue;
    if (lang === '' && !/\b(import|const|function|return|=>)\b/.test(code)) continue; // plain text / shell block
    const label = where === 'code' || JS_LANGS.has(where) ? `${lang || 'code'} block` : where;
    for (const [re, msg] of PLACEHOLDER) if (re.test(code)) errors.push(`${label}: ${msg}.`);
    // a) syntax
    try {
      esbuild ||= require('esbuild');
      await esbuild.transform(code, { loader: /^t/.test(lang) ? 'tsx' : 'jsx' });
    } catch (e) {
      if (e.errors?.length) { const x = e.errors[0]; errors.push(`${label}: syntax error${x.location ? ` on line ${x.location.line}` : ''}: ${x.text}`); continue; }
    }
    // b) names — only for complete files (with imports/exports); short snippets are examples
    if (/^\s*(import|export)\s/m.test(code)) {
      const have = declared(code);
      const missing = new Set();
      for (const m of code.matchAll(/<([A-Z][\w]*)(?:\.[\w.]+)?[\s/>]/g)) if (!have.has(m[1])) missing.add(m[1]);
      for (const m of code.matchAll(/(?<![\w.$])(use[A-Z]\w*)\s*\(/g)) if (!have.has(m[1])) missing.add(m[1]);
      if (missing.size) errors.push(`${label}: used but never imported or defined: ${[...missing].join(', ')}.`);
      const mui = await muiNames();
      if (mui) {
        for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@mui\/material['"]/g)) {
          const bad = m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter((n) => n && !mui.has(n));
          if (bad.length) errors.push(`${label}: @mui/material has no export named ${bad.join(', ')}.`);
        }
      }
      for (const m of code.matchAll(/import\s+(\w+)\s+from\s*['"]@mui\/icons-material\/(\w+)['"]/g)) if (!iconExists(m[2])) errors.push(`${label}: icon @mui/icons-material/${m[2]} does not exist.`);
      for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@mui\/icons-material['"]/g)) {
        const bad = m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter((n) => n && !iconExists(n));
        if (bad.length) errors.push(`${label}: these icons do not exist in @mui/icons-material: ${bad.join(', ')}.`);
      }
    }
    // d) keys in lists, hooks rules
    for (const m of code.matchAll(/\.map\(\s*(?:\([^)]*\)|\w+)\s*=>\s*\(?\s*<([\w.]+)([^>]*)>/g)) {
      if (!/\bkey=/.test(m[2])) { errors.push(`${label}: <${m[1]}> inside .map() has no key prop.`); break; }
    }
    if (/\b(if|for|while)\s*\([^)]*\)\s*\{[^{}]*\buse[A-Z]\w*\s*\(/.test(code)) errors.push(`${label}: a React hook is called inside an if/for/while (hooks must be at the top level of the component).`);
  }
  return [...new Set(errors)];
}

/** Load esbuild + the MUI export list in the background at server start, so the first check is instant */
export function warmCodeCheck() { try { esbuild ||= require('esbuild'); } catch {} muiNames().catch(() => {}); }
