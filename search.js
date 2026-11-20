// Web search for accurate, up-to-date answers. The app searches, then gives the model numbered sources to cite.
// Sources (in parallel): Tavily or Brave (free API keys) or DuckDuckGo (free, may rate-limit) + Wikipedia + Google News (free, always).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const CACHE = new Map(); // query → { at, results }
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const timeout = (ms) => AbortSignal.timeout(ms);

// ---------- short links ----------
// News links are ~300 chars of encoded text = wasted tokens. Long URLs get a short app link (/api/r/<id>)
// that redirects to the real page. Saved in data/links.json so links in old chats keep working.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const LINKS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'links.json');
let LINKS = {};
try { LINKS = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8')); } catch {}
const BY_URL = new Map(Object.entries(LINKS).map(([k, v]) => [v, k]));
let saveTimer = null;
export function shortUrl(url) {
  if (url.length <= 90) return url;
  if (BY_URL.has(url)) return `/api/r/${BY_URL.get(url)}`;
  const id = Math.random().toString(36).slice(2, 7);
  LINKS[id] = url; BY_URL.set(url, id);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.mkdirSync(path.dirname(LINKS_FILE), { recursive: true }); fs.writeFileSync(LINKS_FILE, JSON.stringify(LINKS)); } catch {} }, 500);
  return `/api/r/${id}`;
}
export const resolveShort = (id) => LINKS[id] || null;

// ---------- when to search automatically ----------
// Rule: search for ANY factual question — people, names, places, news, prices, tech, laws, events…
// Skip only messages that clearly don't need facts from the web.
const GREETING = /^\s*(hi+|hello+|hey+|hai|vanakkam|வணக்கம்|thanks?|thank you|nandri|நன்றி|ok(ay)?|bye|good (morning|afternoon|evening|night))[\s!.?]*$/i;
const TASK = /^\s*(please\s+)?(write|create|build|make|generate|code|implement|refactor|fix|debug|convert|translate|rewrite|rephrase|paraphrase|summari[sz]e|draft|compose|design|format|correct|improve|optimi[sz]e|explain (this|the following|my) code|solve)\b/i;
const CREATIVE = /\b(poem|story|kavithai|kadhai|கவிதை|கதை|lyrics|song lyrics|essay|joke|caption|slogan|quote for)\b/i;
const MATH = /^[\d\s+\-*/().^%=x×÷]+$/;
// Programming / concept questions the model already knows ("explain closures in JavaScript")…
const CODING = /\b(javascript|typescript|js|ts|python|java|c\+\+|c#|golang|rust|php|kotlin|swift|react|vue|angular|node(\.js)?|express|next\.?js|css|html|sql|mongodb|git|docker|closures?|functions?|arrays?|objects?|class(es)?|loops?|recursion|promises?|async|await|hooks?|props|state|api|algorithms?|data structures?|oop|inheritance|variables?|syntax|regex|big ?o)\b/i;
// …unless they ask for something new or time-sensitive
const FRESH = /\b(latest|newest|new in|released?|release date|version|update[sd]?|news|today|current(ly)?|this (week|month|year)|deprecated|20[2-3]\d)\b/i;
export function needsSearch(q = '') {
  const s = q.trim();
  if (s.length < 2 || GREETING.test(s) || MATH.test(s)) return false;
  if (s.includes('```') || s.length > 1500) return false; // pasted code / long documents
  if (TASK.test(s) || CREATIVE.test(s)) return false;
  if (CODING.test(s) && !FRESH.test(s)) return false;
  return true;
}

// ---------- relevance (keeps cards & related topics on-topic) ----------
const STOP = new Set('the and for with what who whom whose when where which why how are was were this that from into about explain tell give show simple example examples please you your his her their its in on of to is a an me my'.split(' '));
const stems = (s = '') => [...new Set((s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 5)))];
const mentions = (text, keys) => { const t = stems(text); return keys.some((k) => t.includes(k)); };

// ---------- providers ----------
async function tavily(q, key) {
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST', signal: timeout(8000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ api_key: key, query: q, max_results: 5, search_depth: 'basic' }),
  });
  if (!r.ok) throw new Error(`Tavily ${r.status}`);
  return ((await r.json()).results || []).map((x) => ({ title: x.title, url: x.url, text: x.content || '' }));
}

async function brave(q, key) {
  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?count=5&q=${encodeURIComponent(q)}`, {
    signal: timeout(8000), headers: { Accept: 'application/json', 'X-Subscription-Token': key },
  });
  if (!r.ok) throw new Error(`Brave ${r.status}`);
  return ((await r.json()).web?.results || []).map((x) => ({ title: x.title, url: x.url, text: strip(x.description || '') }));
}

async function duckduckgo(q) {
  const r = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, { signal: timeout(6000), headers: { 'User-Agent': UA } });
  const html = await r.text();
  if (/anomaly|challenge-form/i.test(html)) throw new Error('DuckDuckGo rate limit');
  const out = [];
  const re = /href="([^"]+)"[^>]*class='result-link'>([\s\S]*?)<\/a>[\s\S]*?class='result-snippet'>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 5) {
    let url = m[1].replace(/&amp;/g, '&');
    const u = /uddg=([^&]+)/.exec(url); if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (/duckduckgo\.com\/y\.js|ad_provider/.test(url)) continue; // skip ads
    out.push({ title: strip(m[2]), url, text: strip(m[3]) });
  }
  return out;
}

async function wikipedia(q) {
  const lang = /[\u0B80-\u0BFF]/.test(q) ? 'ta' : 'en';
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=5&gsrsearch=${encodeURIComponent(q)}`
    + `&prop=extracts|info|pageimages|description&inprop=url&exintro=1&explaintext=1&exchars=1500&exlimit=5&piprop=thumbnail&pithumbsize=480&origin=*`;
  const j = await (await fetch(url, { signal: timeout(6000), headers: { 'User-Agent': 'AllInOneAI/1.0 (local app)' } })).json();
  return Object.values(j.query?.pages || {}).sort((a, b) => a.index - b.index)
    .map((p) => ({
      kind: 'wiki', title: `${p.title} — Wikipedia`, name: p.title, url: p.fullurl, text: p.extract || '',
      description: p.description || '', image: p.thumbnail?.source?.replace(/\?utm_.*$/, '') || null,
    }));
}

// Google News RSS — free, no key, newest articles with dates (India edition; Tamil edition for Tamil queries)
async function googleNews(q) {
  const ta = /[஀-௿]/.test(q);
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${ta ? 'ta' : 'en-IN'}&gl=IN&ceid=IN:${ta ? 'ta' : 'en'}`;
  const xml = await (await fetch(url, { signal: timeout(6000), headers: { 'User-Agent': UA } })).text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const get = (tag) => (new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(it)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '');
    const date = new Date(get('pubDate'));
    const source = strip(get('source'));
    return { title: strip(get('title')), url: strip(get('link')), date, source };
  }).filter((x) => x.title && x.url && !isNaN(x.date));
  items.sort((a, b) => b.date - a.date); // newest first
  return items.slice(0, 6).map((x) => ({
    kind: 'news', title: `${x.title}`, url: x.url, date: x.date.toISOString(), source: x.source,
    text: `News, published ${x.date.toISOString().slice(0, 10)}${x.source ? ` by ${x.source}` : ''}: ${x.title}`,
  }));
}

// Read the top pages for more detail than a snippet (best effort, fast timeout)
async function readPage(url, q) {
  try {
    const r = await fetch(url, { signal: timeout(3500), headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!r.ok || !/text\/html/.test(r.headers.get('content-type') || '')) return '';
    const text = strip((await r.text()).slice(0, 400_000));
    // keep the sentences that share the most words with the question
    const words = new Set(q.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 40 && s.length < 600);
    return sentences.map((s, i) => ({ s, i, n: (s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => words.has(w)).length }))
      .sort((a, b) => b.n - a.n).slice(0, 8).sort((a, b) => a.i - b.i).map((x) => x.s).join(' ').slice(0, 1500);
  } catch { return ''; }
}

/** Search the web. keys = { tavily, brave }. Returns { results: [{title,url,text}], engine } */
export async function webSearch(query, keys = {}) {
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 300);
  const hit = CACHE.get(q.toLowerCase());
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;

  const engines = [
    keys.tavily && ['Tavily', () => tavily(q, keys.tavily)],
    keys.brave && ['Brave', () => brave(q, keys.brave)],
    ['DuckDuckGo', () => duckduckgo(q)],
  ].filter(Boolean);

  // Run everything in parallel (fast): web engine + Wikipedia (facts) + Google News (latest, dated)
  const webP = (async () => {
    for (const [name, fn] of engines) {
      try { const r = await fn(); if (r.length) return { r, name }; } catch { /* try next */ }
    }
    return { r: [], name: '' };
  })();
  const [web, wiki, news] = await Promise.all([webP, wikipedia(q).catch(() => []), googleNews(q).catch(() => [])]);

  // Keep only encyclopedia pages that are actually about the question
  const qKeys = stems(q);
  const onTopic = wiki.filter((w) => mentions(`${w.name} ${w.description}`, qKeys) || mentions(w.text.slice(0, 400), qKeys));
  const main = onTopic[0];
  // Related = other pages that mention the question or the main topic's name (e.g. "Kalam")
  const mainKeys = main ? stems(main.name.replace(/\(.*?\)/g, '')) : [];
  const related = onTopic.slice(1).filter((w) => mentions(`${w.name} ${w.description} ${w.text}`, [...qKeys, ...mainKeys]));

  // Order: best encyclopedia match → newest news → web results → one more encyclopedia page
  let results = [...(main ? [main] : []), ...news.slice(0, 4), ...web.r.slice(0, 4), ...related.slice(0, 1)];
  const seen = new Set();
  results = results.filter((r) => r.url && !seen.has(r.url) && seen.add(r.url));
  const engine = [web.name, wiki.length && 'Wikipedia', news.length && 'Google News'].filter(Boolean).join(' + ');

  // Enrich up to 2 normal web results with page text (Tavily already returns page content; news/wiki are fine)
  if (web.name && web.name !== 'Tavily') {
    await Promise.all(web.r.slice(0, 2).map(async (r) => {
      const more = await readPage(r.url, q);
      if (more) r.text = `${r.text} ${more}`.slice(0, 1500);
    }));
  }
  // related = more encyclopedia matches, shown as cards in the app (not sent to the model — saves tokens)
  const value = { results: results.slice(0, 8).map((r) => ({ ...r, text: (r.text || '').slice(0, 1500) })), related: related.slice(0, 4), engine };
  CACHE.set(q.toLowerCase(), { at: Date.now(), value });
  if (CACHE.size > 200) CACHE.delete(CACHE.keys().next().value);
  return value;
}

/** Text block added to the user's message so the model can answer with real citations. */
// Keep the block small: on a CPU every extra token slows the first word. ~2,600 chars ≈ 650 tokens.
const BUDGET = { wikiFirst: 800, wiki: 280, news: 0, web: 450 };
function compact(r, i) {
  const isWiki = r.url.includes('wikipedia.org');
  const isNews = r.kind === 'news';
  if (isNews) return r.text.replace(/^News, published /, 'News ').slice(0, 220); // date + source + headline
  const max = isWiki ? (i === 0 ? BUDGET.wikiFirst : BUDGET.wiki) : BUDGET.web;
  const t = r.text.length > max ? `${r.text.slice(0, max).replace(/\s+\S*$/, '')}…` : r.text;
  return `${r.title.replace(/ — Wikipedia$/, '')} (${isWiki ? 'Wikipedia' : new URL(r.url).hostname.replace(/^www\./, '')}): ${t}`;
}

/**
 * Wraps the user's question with the search results BEFORE it, in clear tags (small models then answer the question
 * instead of echoing instructions). The detailed rules live in the model's system prompt.
 */
export function withResults({ results }, question) {
  const today = new Date().toISOString().slice(0, 10);
  if (!results?.length) {
    return `<search_results date="${today}">\nNo results found.\n</search_results>\n`
      + `(If this is a factual question, reply: "No verified real-time information found for this query.")\n\n${question}`;
  }
  return `<search_results date="${today}">\n`
    + results.map((r, i) => `[${i + 1}] ${compact(r, i)}\nURL: ${shortUrl(r.url)}`).join('\n')
    + `\n</search_results>\nGive a complete, well-structured answer from the facts above: overview, key facts with exact dates and numbers, and the latest news (newest first). Cite as [Site](URL).\n\n${question}`;
}
