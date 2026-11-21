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
import { DATA_DIR } from './paths.js';
const LINKS_FILE = path.join(DATA_DIR, 'links.json');
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
// "Do something for me" requests — including common typos ("buld", "bulid", "creat", "mak", "genrate", "wirte")
const TASK = /^\s*(please\s+|pls\s+|plz\s+|can you\s+|could you\s+|i want( you)? to\s+|i need( you)? to\s+|help me( to)?\s+|let'?s\s+)?(write|wirte|wrte|create|creat|crate|build|buld|bulid|biuld|buil|make|mak|mke|generate|genrate|generte|code|implement|refactor|fix|debug|convert|translate|rewrite|rephrase|paraphrase|summari[sz]e|draft|compose|design|desgin|develop|devlop|format|correct|improve|optimi[sz]e|explain (this|the following|my) code|solve|plan|prepare|list)\b/i;
// Things people ask the AI to BUILD — never a news search, even without a verb ("portfolio website for me")
const BUILD_THING = /\b(website|web ?site|web ?page|webpage|landing page|portfolio|resume|cv|app|application|dashboard|component|ui|ux|frontend|front-end|backend|back-end|api|form|login page|signup page|todo|calculator|game|script|program|bot|chatbot|template|layout|navbar|footer|sql query|database schema|project|system|software|tool|portal|platform|tracker|crud|management|admin panel|e-?commerce|store|shop|blog|clone|module|feature|page)\b/i;
const BUILD_VERB = /\b(build|buld|bulid|biuld|create|creat|make|mak|develop|devlop|design|desgin|code|write|generate|genrate|need|want)\b/i;
const CREATIVE = /\b(poem|story|kavithai|kadhai|கவிதை|கதை|lyrics|song lyrics|essay|joke|caption|slogan|quote for)\b/i;
const MATH = /^[\d\s+\-*/().^%=x×÷]+$/;
// Programming / concept questions the model already knows ("explain closures in JavaScript")…
const CODING = /\b(javascript|typescript|js|ts|python|java|c\+\+|c#|golang|rust|php|kotlin|swift|react|vue|angular|node(\.js)?|express|next\.?js|css|html|sql|mongodb|git|docker|closures?|functions?|arrays?|objects?|class(es)?|loops?|recursion|promises?|async|await|hooks?|props|state|api|algorithms?|data structures?|oop|inheritance|variables?|syntax|regex|big ?o)\b/i;
// …unless they ask for something new or time-sensitive
const FRESH = /\b(latest|newest|new in|released?|release date|version|update[sd]?|news|today|current(ly)?|this (week|month|year)|deprecated|20[2-3]\d)\b/i;
// Small talk & questions about the assistant itself — answer like a person, never search the news for these
const SMALLTALK = /^\s*(how (are|r) (you|u)|how('s| is) (it going|your day|life)|how do you do|what'?s up|wassup|sup|who are you|what are you|what is your name|what'?s your name|your name|what can you do|what do you do|are you (there|ok|real|human|a bot|an ai)|can you help( me)?|help|nice( to meet you)?|good( job)?|great|cool|awesome|wow|lol|haha|hmm+|yes|no|yeah|nope|sure|i('m| am) (fine|good|ok|okay|bored|tired|happy|sad)|i love you|miss you|good night|see you|eppadi irukeenga|epdi iruka|nalla irukeengala|sapteengala|எப்படி இருக்கீங்க|நலமா|சாப்பிட்டீங்களா)(?=$|[\s!.?,])[\s!.?,஀-௿a-z]*$/i;
// Tanglish small talk (Tamil written in English letters): "nee epdi irukka", "neenga eppadi irukeenga", "enna panra", "saptiya"…
const TANGLISH_TALK = /^\s*((hi|hello|hey|vanakkam|machi|machan|bro|da|di|anna|akka)\s+)*((nee|ni|neenga|nenga|neega|ningal|neengal)\s+)?(((epdi|eppadi|epadi|yepdi|eppidi)\s+(irukka|iruka|irukeenga|irukinga|irukenga|iruke|irukkinga|irukkeenga|irukeengala|irukinga|irukkenga|irukkiya|irukiya|iruki|irukkinga))|(nalla\s+(irukiya|irukkiya|irukeengala|irukingala|irukeenga|irukken|iruken))|(enna\s+(panra|pannura|panringa|pandra|panreenga|pannringa|vishayam|news|aachu))|(sapt(iya|eengala|ingala|achu|tiya|teengala)|saapteengala|saptacha)|(naan\s+nalla\s+(irukken|iruken))|(seri|sari|okay da|ok da|super|nandri|thanks da|romba nandri))(\s+(da|di|bro|machi|machan|pa|ma|anna|akka|ji|sir))?[\s!.?,]*$/i;
// "you / your" questions are about the assistant, not the world ("what is your favourite colour?") — incl. Tanglish nee/neenga/unga
const ABOUT_BOT = /\b(you|your|yourself|u|nee|ni|neenga|nenga|unga|un|ungalukku|unakku)\b/i;
const NAMED = /(^|\s)[A-Z][\w.'-]+|[A-Z]{2,}|[஀-௿]{2,}|\d{3,}/; // a name, acronym, Tamil word or number
export function needsSearch(q = '') {
  const s = q.trim();
  if (s.length < 2 || GREETING.test(s) || MATH.test(s) || SMALLTALK.test(s) || TANGLISH_TALK.test(s)) return false;
  if (s.includes('```') || s.length > 1500) return false; // pasted code / long documents
  // Asking for code / an example / syntax is never a web-search job ("give code", "example venum", "code kudu")
  if (/\b(code|codes|coding|snippet|syntax|example|examples|program|sample|implementation|implement|package|packages|library|libraries|npm|pip|module|plugin|dependency|sdk)\b/i.test(s)
    && !/\b(search|google|look ?up|latest|news|release[sd]?|version)\b/i.test(s)) return false;
  if (TASK.test(s) || CREATIVE.test(s)) return false;
  // Building / editing a page, site or app is never a web-search job — even when a SECTION is called "latest news" —
  // unless the user explicitly asks to search. (Search results inside a build answer turn into fake links and sections.)
  const askedToSearch = /\b(search|google|look ?up|browse|find online|from the internet)\b/i.test(s);
  if (BUILD_THING.test(s) && !askedToSearch && !/^\s*(what|which|who|when|is|are|does|did)\b/i.test(s)
    && (BUILD_VERB.test(s) || CODING.test(s) || /\b(page|section|sections|with|add|pannu|venum)\b/i.test(s))) return false;
  if (CODING.test(s) && !FRESH.test(s)) return false;
  // Short chit-chat directed at the assistant ("how was your day", "do you like music") → no search
  if (ABOUT_BOT.test(s) && !FRESH.test(s) && !NAMED.test(s.replace(/^\w/, '')) && s.split(/\s+/).length <= 8) return false;
  return true;
}

// "Build me a website / portfolio / app / page…" (typos OK) — the app then asks for complete code with a live preview
const WEB_THING = /\b(website|web ?site|web ?page|webpage|landing page|portfolio|resume|cv|dashboard|component|ui|form|login page|signup page|todo|calculator|game|navbar|footer|template|layout|app|application|project|system|software|tool|portal|platform|tracker|crud|management|admin panel|e-?commerce|store|shop|blog|clone|page)\b/i;
export const isBuildRequest = (q = '') => BUILD_VERB.test(q) && WEB_THING.test(q) && !/\b(python|java\b|c\+\+|c#|golang|rust|php|sql|android|ios|flutter|kotlin|swift)\b/i.test(q);

// "A full React + Vite project" (several files + ZIP) instead of one component:
// any mention of Vite (incl. typos like "reactvite"), or a build request that asks for a full / complete / multi-file project
const VITE = /vite/i;
const FULL = /\b(project|full|complete|whole|multi[- ]?(page|file)s?|files|folder|structure|zip|download|production|deploy\w*|real (website|app)|system|management|portal|platform|crud|admin panel|e-?commerce|dashboard|clone)\b/i;
export const isProjectRequest = (q = '') => !/\b(what is|explain|difference|vs\.?|versus|why)\b/i.test(q)
  && ((VITE.test(q) && (BUILD_VERB.test(q) || q.trim().split(/\s+/).length <= 6)) || (isBuildRequest(q) && FULL.test(q)));

// ---------- relevance (keeps cards & related topics on-topic) ----------
const STOP = new Set('the and for with what who whom whose when where which why how are was were this that from into about explain tell give show simple example examples please you your his her their its in on of to is a an me my doing going'.split(' '));
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
    + `&prop=extracts|info|pageimages|description|pageprops&ppprop=wikibase_item&inprop=url&exintro=1&explaintext=1&exchars=1500&exlimit=5&piprop=thumbnail&pithumbsize=480&origin=*`;
  const j = await wmJson(url);
  return Object.values(j.query?.pages || {}).sort((a, b) => a.index - b.index)
    .map((p) => ({
      kind: 'wiki', title: `${p.title} — Wikipedia`, name: p.title, url: p.fullurl, text: p.extract || '', lang,
      description: p.description || '', image: p.thumbnail?.source?.replace(/\?utm_.*$/, '') || null, qid: p.pageprops?.wikibase_item || null,
    }));
}

// ---------- deeper data for the main topic ----------
const WUA = { 'User-Agent': 'Evolvix/1.0 (local app)' };
// Wikimedia limits bursts of requests: cache results for a day and retry once when told "too many requests"
const DAY_CACHE = new Map();
async function wmJson(url) {
  const hit = DAY_CACHE.get(url);
  if (hit && Date.now() - hit.at < 864e5) return hit.data;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { signal: timeout(6000), headers: WUA });
    const text = await r.text();
    if (r.status === 429 || /too many requests/i.test(text.slice(0, 200))) { await new Promise((ok) => setTimeout(ok, 1200)); continue; }
    const data = JSON.parse(text);
    DAY_CACHE.set(url, { at: Date.now(), data });
    if (DAY_CACHE.size > 500) DAY_CACHE.delete(DAY_CACHE.keys().next().value);
    return data;
  }
  throw new Error('Wikimedia rate limit');
}

// Exact facts from Wikidata (the database behind Wikipedia) — shown word-for-word, no AI in between
const FACT_PROPS = [
  ['P1449', 'Also known as'], ['P569', 'Born'], ['P570', 'Died'], ['P19', 'Birthplace'], ['P27', 'Citizenship'],
  ['P39', 'Positions held'], ['P102', 'Political party'], ['P106', 'Occupation'], ['P108', 'Employer'], ['P69', 'Education'],
  ['P26', 'Spouse'], ['P22', 'Father'], ['P25', 'Mother'], ['P166', 'Awards'],
  ['P571', 'Founded'], ['P112', 'Founded by'], ['P159', 'Headquarters'], ['P488', 'Chairperson'], ['P169', 'CEO'],
  ['P17', 'Country'], ['P36', 'Capital'], ['P6', 'Head of government'], ['P1082', 'Population'],
  ['P577', 'Released'], ['P57', 'Director'], ['P161', 'Cast'], ['P86', 'Music by'], ['P2047', 'Duration'],
  ['P348', 'Latest version'], ['P178', 'Developer'], ['P856', 'Website'],
];
const fmtTime = (t) => {
  const m = /^\+?(-?\d+)-(\d\d)-(\d\d)/.exec(t || ''); if (!m) return '';
  if (m[2] === '00') return m[1];
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, m[3] === '00' ? 1 : +m[3]));
  return d.toLocaleDateString('en-IN', { ...(m[3] !== '00' && { day: 'numeric' }), month: 'long', year: 'numeric', timeZone: 'UTC' });
};
async function wikidataFacts(qid, lang = 'en') {
  const get = wmJson;
  const ent = Object.values((await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&ids=${qid}&props=claims`)).entities || {})[0];
  const claims = ent?.claims || {};
  const rows = [];
  const need = new Set();
  for (const [p, label] of FACT_PROPS) {
    let list = (claims[p] || []).filter((c) => c.rank !== 'deprecated' && c.mainsnak?.datavalue);
    if (list.some((c) => c.rank === 'preferred') && !['P39', 'P166', 'P106', 'P161', 'P69'].includes(p)) list = list.filter((c) => c.rank === 'preferred');
    if (!list.length) continue;
    let vals = list.map((c) => {
      const v = c.mainsnak.datavalue.value;
      const start = c.qualifiers?.P580?.[0]?.datavalue?.value?.time, end = c.qualifiers?.P582?.[0]?.datavalue?.value?.time;
      return { v, start, end };
    });
    if (['P39', 'P6', 'P488', 'P169', 'P102'].includes(p)) vals.sort((a, b) => String(b.start || '').localeCompare(String(a.start || ''))); // newest first
    vals = vals.slice(0, p === 'P161' || p === 'P166' ? 4 : p === 'P6' || p === 'P488' || p === 'P169' ? 1 : 5);
    vals.forEach(({ v }) => v?.id && need.add(v.id)); // only look up names we will actually show
    rows.push([label, vals, p]);
  }
  // Names (labels) of linked items, fetched in batches of 50
  const labels = {};
  const ids = [...need];
  for (let i = 0; i < ids.length; i += 50) {
    // "mul" = Wikidata's default name for all languages (many newer entries only have that); sitelinks = Wikipedia page title
    const L = (await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&ids=${ids.slice(i, i + 50).join('|')}&props=labels|sitelinks&sitefilter=${lang}wiki|enwiki&languages=${[...new Set([lang, 'en', 'mul'])].join('|')}`)).entities || {};
    for (const [id, e] of Object.entries(L)) {
      labels[id] = e.labels?.[lang]?.value || e.labels?.en?.value || e.labels?.mul?.value
        || e.sitelinks?.[`${lang}wiki`]?.title || e.sitelinks?.enwiki?.title || '';
    }
  }
  const show = ({ v, start, end }) => {
    let s = v?.id ? labels[v.id] : v?.time ? fmtTime(v.time) : v?.amount ? Number(v.amount).toLocaleString('en-IN') : v?.text || (typeof v === 'string' ? v : '');
    if (start || end) s += ` (${start ? fmtTime(start).replace(/^\d+ /, '') : '?'} – ${end ? fmtTime(end).replace(/^\d+ /, '') : 'present'})`;
    return s;
  };
  // de-duplicate (same position twice) and drop unresolved ids
  // drop anything whose name couldn't be looked up (raw "Q123" codes or an empty name before the dates)
  return rows.map(([label, vals]) => [label, [...new Set(vals.map(show).filter((x) => x && !/^Q\d+\b/.test(x) && !/^\s*\(/.test(x)))].join('; ')])
    .filter(([, v]) => v).map(([label, value]) => ({ label, value }));
}

// The most relevant parts of the full article (career, politics, recent years…), not just the intro
async function articleDetails(page, q) {
  const u = `https://${page.lang || 'en'}.wikipedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(page.name)}&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1`;
  const j = await wmJson(u);
  const full = Object.values(j.query?.pages || {})[0]?.extract || '';
  const SKIP_SEC = /^(filmography|discography|bibliography|references|notes|citations|external links|see also|further reading|sources|gallery|works|awards and nominations)$/i;
  const sections = full.split(/\n(?==+ )/).map((block) => {
    const m = /^(=+) (.+?) =+\n/.exec(block);
    return { title: m ? m[2] : 'Introduction', body: (m ? block.slice(m[0].length) : block).trim() };
  }).filter((s) => s.body && !SKIP_SEC.test(s.title) && s.title !== 'Introduction');
  const keys = stems(q);
  const year = new Date().getFullYear();
  const scored = sections.map((s, i) => {
    let score = keys.filter((k) => stems(`${s.title} ${s.body.slice(0, 600)}`).includes(k)).length;
    if (/present|current|recent|political|career|personal|biography|history|overview|life/i.test(s.title)) score += 2;
    if (new RegExp(`${year}|${year - 1}`).test(s.title)) score += 3; // newest period first
    return { ...s, score, i };
  }).sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.i - b.i);
  let out = '';
  for (const s of scored) {
    const para = s.body.split('\n').filter((p) => p.length > 60).slice(0, 2).join(' ');
    out += `\n${s.title}: ${para.slice(0, 700)}`;
  }
  return out.trim().slice(0, 1800);
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
  // Deeper, exact data for the main topic (in parallel, ~0.5–1 s): Wikidata facts + relevant article sections
  if (main) {
    const [facts, details] = await Promise.all([
      main.qid ? wikidataFacts(main.qid, main.lang).catch(() => []) : [],
      articleDetails(main, q).catch(() => ''),
    ]);
    main.facts = facts;
    main.details = details;
  }
  // Related = other pages that mention the question or the main topic's name (e.g. "Kalam")
  const mainKeys = main ? stems(main.name.replace(/\(.*?\)/g, '')) : [];
  const related = onTopic.slice(1).filter((w) => mentions(`${w.name} ${w.description} ${w.text}`, [...qKeys, ...mainKeys]));

  // Order: best encyclopedia match → newest news → web results → one more encyclopedia page
  // News must mention what was asked (drops random headlines for vague queries)
  const onTopicNews = qKeys.length ? news.filter((n) => mentions(n.title, qKeys)) : [];
  const onTopicWeb = qKeys.length ? web.r.filter((w) => mentions(`${w.title} ${w.text}`, qKeys)) : [];
  let results = [...(main ? [main] : []), ...onTopicNews.slice(0, 4), ...onTopicWeb.slice(0, 4), ...related.slice(0, 1)];
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
  let out = `${r.title.replace(/ — Wikipedia$/, '')} (${isWiki ? 'Wikipedia' : new URL(r.url).hostname.replace(/^www\./, '')}): ${t}`;
  // Main topic: exact database facts + the relevant article sections (career, politics, recent years…)
  if (r.facts?.length) out += `\nKey facts (Wikidata): ${r.facts.map((f) => `${f.label}: ${f.value}`).join(' | ')}`;
  if (r.details) out += `\nMore from the article:\n${r.details}`;
  return out;
}

/**
 * Wraps the user's question with the search results BEFORE it, in clear tags (small models then answer the question
 * instead of echoing instructions). The detailed rules live in the model's system prompt.
 */
export function withResults({ results }, question) {
  const today = new Date().toISOString().slice(0, 10);
  if (!results?.length) {
    return `<search_results date="${today}">\nNo results found.\n</search_results>\n`
      + `(If this is a factual question, reply: "I could not find verified, accurate information on that specific topic.")\n\n${question}`;
  }
  return `<search_results date="${today}">\n`
    + results.map((r, i) => `[${i + 1}] ${compact(r, i)}\nURL: ${shortUrl(r.url)}`).join('\n')
    + `\n</search_results>\nGive a complete, well-structured answer from the facts above: overview, key facts with exact dates and numbers, and the latest news (newest first). Cite as [Site](URL).\n\n${question}`;
}
