// Real package facts for "which package / library" questions: the official npm registry (free, no key) + weekly downloads.
// A small local model can't memorise the npm ecosystem — so instead of guessing names (or inventing scripts), it gets
// the real, current packages and explains them.
const STOP = /\b(give|me|need|want|whole|all|full|list|best|top|good|some|any|the|a|an|for|to|of|in|on|with|and|or|please|pls|npm|pip|pypi|composer|packagist|python|php|node|js|javascript|package|packages|pakage|packge|packges|library|libraries|libary|lib|libs|module|modules|plugin|plugins|which|what|is|are|use|using|recommend|suggest|show|tell|about|i|my|venum|kudu|sollu|pannu|enna|eppadi)\b/gi;

export const isPackageQuestion = (q = '') => /\b(npm|package|packages|pakage|packge|packges|library|libraries|libary|lib|libs|module|plugin)\b/i.test(q)
  && !/\bpip\b|\bpython\b|\bcomposer\b|\bgem\b|\bcargo\b|\bnuget\b|\bmaven\b/i.test(q);

/** Keywords to search for ("pdf view npm package give me" → "pdf view") */
export function packageQuery(q = '') {
  const words = q.replace(/[^\w\s.@/-]/g, ' ').replace(STOP, ' ').split(/\s+/).filter((w) => w.length > 1);
  return [...new Set(words.map((w) => w.toLowerCase()))].slice(0, 5).join(' ');
}

async function weeklyDownloads(names) {
  const out = {};
  const plain = names.filter((n) => !n.startsWith('@'));
  const scoped = names.filter((n) => n.startsWith('@'));
  const get = (u) => fetch(u, { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  // Bulk lookups in batches; if a batch fails (one odd name breaks the whole request), look those up one by one
  for (let i = 0; i < plain.length; i += 20) {
    const batch = plain.slice(i, i + 20);
    const j = batch.length > 1 ? await get(`https://api.npmjs.org/downloads/point/last-week/${batch.map(encodeURIComponent).join(',')}`) : null;
    if (j && !j.error) { for (const n of batch) out[n] = j[n]?.downloads || 0; continue; }
    await Promise.all(batch.map(async (n) => { const k = await get(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(n)}`); out[n] = k?.downloads || 0; }));
  }
  await Promise.all(scoped.slice(0, 12).map(async (n) => { const j = await get(`https://api.npmjs.org/downloads/point/last-week/${n.replace('/', '%2F')}`); out[n] = j?.downloads || 0; }));
  return out;
}

/** → [{ name, version, description, weekly, homepage }] sorted by real usage (weekly downloads) */
export async function searchPackages(query, { react = false, size = 25 } = {}) {
  if (!query) return [];
  // The main keyword alone finds the big packages; the full phrase finds specific ones; "react …" the React wrappers
  const key = query.split(/\s+/).find((w) => !/^(react|view|viewer|format|file|files|make|create|read|edit|convert|word)$/i.test(w)) || query.split(/\s+/)[0];
  const queries = [...new Set([key, query, react ? `react ${key}` : null].filter(Boolean))];
  const seen = new Map();
  for (const q of queries) {
    const r = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=${size}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    for (const o of j?.objects || []) {
      const p = o.package;
      if (!seen.has(p.name)) seen.set(p.name, { name: p.name, version: p.version, description: (p.description || '').slice(0, 160), homepage: p.links?.npm, weekly: o.downloads?.weekly });
    }
  }
  // Relevant only: the main keyword must be in the name or description ("pdf" for "pdf view")
  const main = query.split(/\s+/).find((w) => !/^(react|view|viewer|format|file|files|make|create|read|edit|convert)$/i.test(w)) || query.split(/\s+/)[0];
  const list = [...seen.values()].filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(main.toLowerCase()));
  // The search already returns weekly downloads; ask the downloads API only for any that are missing
  const missing = list.filter((p) => p.weekly == null).map((p) => p.name);
  const dl = missing.length ? await weeklyDownloads(missing) : {};
  for (const p of list) p.weekly = p.weekly ?? (dl[p.name] || 0);
  // At most 2 per scope (@react-pdf/renderer yes, its internal @react-pdf/fns, /font, /types… no)
  const perScope = {};
  return list.filter((p) => p.weekly >= 500 && !p.name.startsWith('@types/')).sort((a, b) => b.weekly - a.weekly)
    .filter((p) => !/\/(types|fns|font|fonts|primitives|svg|layout|textkit|stylesheet|image|png-js|standard-fonts|shared|utils?|core-[\w-]+)$/i.test(p.name))
    .filter((p) => { const s = p.name.startsWith('@') ? p.name.split('/')[0] : p.name; perScope[s] = (perScope[s] || 0) + 1; return perScope[s] <= 2; })
    .slice(0, 16);
}

export const fmtWeekly = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

// ---------- Python (PyPI) and PHP (Packagist) ----------
// Which registry a question is about: Python / pip / Django… → PyPI; PHP / composer / Laravel… → Packagist; else npm
// (npm also covers JavaScript, TypeScript, React, HTML/CSS tooling and Tailwind CSS plugins).
export function ecosystemOf(q = '') {
  if (/\b(python|pip|pypi|django|flask|fastapi|pandas|numpy|jupyter|pytorch|tensorflow|py)\b/i.test(q)) return 'pypi';
  if (/\b(php|composer|packagist|laravel|symfony|wordpress|codeigniter)\b/i.test(q)) return 'packagist';
  if (/\b(gem|ruby|rails|cargo|rust|crate|nuget|\.net|c#|maven|gradle|java|go module|golang)\b/i.test(q)) return 'other';
  return 'npm';
}
// Any language: "python pdf library", "php excel package", "tailwind plugin", "react chart library"
export const isLibraryQuestion = (q = '') => /\b(npm|pip|composer|package|packages|pakage|packge|packges|library|libraries|libary|lib|libs|module|modules|plugin|plugins|framework|frameworks)\b/i.test(q);

const getJson = (u) => fetch(u, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'evolvix-learn (package lookup)' } })
  .then((r) => (r.ok ? r.json() : null)).catch(() => null);

/** PHP: Packagist search (free, no key), ranked by total downloads */
export async function searchPackagist(query) {
  const key = query.split(/\s+/)[0];
  const seen = new Map();
  for (const q of [...new Set([key, query])]) {
    const j = await getJson(`https://packagist.org/search.json?q=${encodeURIComponent(q)}&per_page=25`);
    for (const r of j?.results || []) if (!seen.has(r.name)) seen.set(r.name, { name: r.name, description: (r.description || '').slice(0, 160), total: r.downloads || 0, stars: r.favers || 0 });
  }
  return [...seen.values()].filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(key.toLowerCase()) && p.total >= 10_000)
    .sort((a, b) => b.total - a.total).slice(0, 14);
}

/** Python: PyPI has no open search API, so candidate names (from the model) are VERIFIED one by one —
 *  only packages that really exist stay, with their real summary, version and weekly downloads (pypistats). */
export async function verifyPyPI(names = []) {
  const uniq = [...new Set(names.map((n) => String(n).trim().toLowerCase()).filter((n) => /^[a-z0-9][a-z0-9._-]{0,60}$/.test(n)))].slice(0, 20);
  const out = await Promise.all(uniq.map(async (n) => {
    const j = await getJson(`https://pypi.org/pypi/${encodeURIComponent(n)}/json`);
    if (!j?.info) return null;
    const s = await getJson(`https://pypistats.org/api/packages/${encodeURIComponent(n)}/recent`);
    return { name: j.info.name, version: j.info.version, description: (j.info.summary || '').slice(0, 160), weekly: s?.data?.last_week || 0 };
  }));
  return out.filter(Boolean).sort((a, b) => b.weekly - a.weekly);
}
