// Usage tracking & billing: logs every chat's tokens, estimates cost, and enforces an optional monthly budget.
// Data lives on this PC in data/usage.jsonl (one line per request) and data/billing.json (budget + your price rates).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR } from './paths.js';

const DIR = DATA_DIR;
fs.mkdirSync(DIR, { recursive: true });
const LOG = path.join(DIR, 'usage.jsonl');
const BILL = path.join(DIR, 'billing.json');

// Live per-token prices (USD) reported by providers that publish them (OpenRouter). key = "provider:model"
export const livePrices = new Map();

export const loadBilling = () => {
  try { return { budget: 0, rates: {}, ...JSON.parse(fs.readFileSync(BILL, 'utf8')) }; } catch { return { budget: 0, rates: {} }; }
};
export const saveBilling = (b) => {
  const cur = loadBilling();
  const next = {
    budget: Math.max(0, Number(b.budget ?? cur.budget) || 0),
    rates: Object.fromEntries(Object.entries(b.rates ?? cur.rates).map(([k, v]) => [k, { in: Math.max(0, Number(v?.in) || 0), out: Math.max(0, Number(v?.out) || 0) }])),
  };
  fs.writeFileSync(BILL, JSON.stringify(next, null, 2));
  return next;
};

/** Cost in USD for one request. free=true → 0. Unknown price → null. */
export function costOf({ provider, model, inTok, outTok, free }) {
  if (free) return 0;
  const live = livePrices.get(`${provider}:${model}`);
  if (live) return inTok * live.in + outTok * live.out;
  const r = loadBilling().rates[provider]; // user-entered USD per 1M tokens
  if (r && (r.in || r.out)) return (inTok * r.in + outTok * r.out) / 1e6;
  return null;
}

export function record(entry) {
  const row = { t: Date.now(), ...entry, cost: costOf(entry) };
  fs.appendFile(LOG, JSON.stringify(row) + '\n', () => {});
  return row;
}

const readRows = (sinceMs) => {
  try {
    return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && r.t >= sinceMs);
  } catch { return []; }
};

const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
export const monthSpend = () => readRows(monthStart()).reduce((s, r) => s + (r.cost || 0), 0);

/** Is a paid request allowed under the monthly budget? */
export function budgetCheck(free) {
  const { budget } = loadBilling();
  if (free || !budget) return null;
  const spent = monthSpend();
  return spent >= budget ? `Monthly budget reached ($${spent.toFixed(2)} of $${budget.toFixed(2)}). Use a free model or raise the budget in Usage & billing.` : null;
}

export function summary(days = 30) {
  const since = Date.now() - days * 864e5;
  const rows = readRows(Math.min(since, monthStart()));
  const inRange = rows.filter((r) => r.t >= since);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sum = (rs) => rs.reduce((a, r) => ({
    requests: a.requests + 1, inTok: a.inTok + (r.inTok || 0), outTok: a.outTok + (r.outTok || 0),
    cost: a.cost + (r.cost || 0), unknownCost: a.unknownCost + (r.cost == null ? 1 : 0),
  }), { requests: 0, inTok: 0, outTok: 0, cost: 0, unknownCost: 0 });

  const byModel = {};
  for (const r of inRange) {
    const k = `${r.provider}:${r.model}`;
    byModel[k] ??= { provider: r.provider, providerName: r.providerName, model: r.model, label: r.label, free: r.free, requests: 0, inTok: 0, outTok: 0, cost: 0, unknown: 0 };
    const m = byModel[k];
    m.requests++; m.inTok += r.inTok || 0; m.outTok += r.outTok || 0; m.cost += r.cost || 0; if (r.cost == null) m.unknown++;
  }
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d0 = new Date(today.getTime() - i * 864e5);
    const d1 = d0.getTime() + 864e5;
    const s = sum(inRange.filter((r) => r.t >= d0.getTime() && r.t < d1));
    daily.push({ date: d0.toISOString().slice(0, 10), tokens: s.inTok + s.outTok, cost: s.cost, requests: s.requests });
  }
  const free = inRange.filter((r) => r.free);
  return {
    days,
    total: sum(inRange),
    today: sum(inRange.filter((r) => r.t >= today.getTime())),
    month: sum(rows.filter((r) => r.t >= monthStart())),
    freeTokens: free.reduce((n, r) => n + (r.inTok || 0) + (r.outTok || 0), 0),
    byModel: Object.values(byModel).sort((a, b) => b.cost - a.cost || (b.inTok + b.outTok) - (a.inTok + a.outTok)),
    daily,
    billing: loadBilling(),
  };
}

export function clear() { try { fs.unlinkSync(LOG); } catch {} }
