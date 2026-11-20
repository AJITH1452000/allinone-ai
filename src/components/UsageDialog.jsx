import { useEffect, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Dialog, IconButton, InputAdornment, Link, LinearProgress, Tab, Tabs, TextField, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const usd = (n) => (n === 0 ? '$0.00' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

function Stat({ label, value, sub }) {
  return (
    <Box sx={{ flex: '1 1 140px', p: 1.75, border: 1, borderColor: 'divider', borderRadius: '14px', bgcolor: 'background.paper' }}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', fontWeight: 500 }}>{label}</Typography>
      <Typography sx={{ fontSize: 24, fontWeight: 650, letterSpacing: '-0.02em', mt: 0.25, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      {sub && <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{sub}</Typography>}
    </Box>
  );
}

function DailyBars({ daily }) {
  const max = Math.max(1, ...daily.map((d) => d.tokens));
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: 120, px: 0.5 }}>
        {daily.map((d) => (
          <Tooltip key={d.date} title={`${d.date} · ${fmt(d.tokens)} tokens · ${d.requests} requests · ${usd(d.cost)}`}>
            <Box sx={{ flex: 1, minWidth: 3, height: `${Math.max(2, (d.tokens / max) * 100)}%`, borderRadius: '3px 3px 1px 1px',
              bgcolor: d.tokens ? 'primary.main' : 'divider', opacity: d.tokens ? 0.85 : 1, '&:hover': { opacity: 1 } }} />
          </Tooltip>
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'text.secondary', mt: 0.5, px: 0.5 }}>
        <span>{daily[0]?.date}</span><span>Today</span>
      </Box>
    </Box>
  );
}

export default function UsageDialog({ open, onClose }) {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState(null);
  const [bal, setBal] = useState(null);
  const [budget, setBudget] = useState('');
  const [rates, setRates] = useState({});
  const [saved, setSaved] = useState('');
  const full = useMediaQuery('(max-width:700px)');

  const load = () => {
    setData(null); setBal(null);
    fetch('/api/usage?days=30').then((r) => r.json()).then((d) => {
      setData(d); setBudget(d.billing.budget || ''); setRates(d.billing.rates || {});
    }).catch(() => setData({ error: true }));
    fetch('/api/balances').then((r) => r.json()).then(setBal).catch(() => setBal([]));
  };
  useEffect(() => { if (open) load(); }, [open]);

  const saveBilling = async () => {
    await fetch('/api/billing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ budget, rates }) });
    setSaved('Saved'); setTimeout(() => setSaved(''), 1500); load();
  };

  const m = data?.month;
  const b = data?.billing?.budget || 0;
  const paidProviders = (bal || []).filter((x) => x.paid && x.id !== 'openrouter');

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" fullScreen={full}
      PaperProps={{ sx: { borderRadius: full ? 0 : '20px', height: full ? '100%' : 'min(760px, 90vh)', bgcolor: 'background.default' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2.5, pt: 2, pb: 0.5 }}>
        <Typography sx={{ fontSize: 19, fontWeight: 650, flex: 1 }}>Usage & billing</Typography>
        <Tooltip title="Refresh"><IconButton size="small" onClick={load}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2, minHeight: 40, '& .MuiTab-root': { minHeight: 40, fontWeight: 600 } }}>
        <Tab label="Usage" /><Tab label="Credits & balances" /><Tab label="Budget & prices" />
      </Tabs>

      <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5, pt: 2 }}>
        {!data ? <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress size={28} /></Box>
          : data.error ? <Typography color="error">Server not running.</Typography>
          : tab === 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <Stat label="Spent this month" value={usd(m.cost)} sub={b ? `Budget ${usd(b)}` : 'No budget set'} />
                <Stat label="Tokens this month" value={fmt(m.inTok + m.outTok)} sub={`${fmt(m.inTok)} in · ${fmt(m.outTok)} out`} />
                <Stat label="Requests this month" value={m.requests} sub={`${data.today.requests} today`} />
                <Stat label="Free tokens (30 days)" value={fmt(data.freeTokens)} sub="Local & free-tier models" />
              </Box>
              {b > 0 && (
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, mb: 0.5 }}>
                    <span>Monthly budget</span><span>{usd(m.cost)} / {usd(b)}</span>
                  </Box>
                  <LinearProgress variant="determinate" value={Math.min(100, (m.cost / b) * 100)} color={m.cost / b > 0.9 ? 'error' : 'primary'}
                    sx={{ height: 8, borderRadius: 4 }} />
                </Box>
              )}
              <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: '14px', bgcolor: 'background.paper' }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 1.5 }}>Tokens per day · last 30 days</Typography>
                <DailyBars daily={data.daily} />
              </Box>
              <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '14px', bgcolor: 'background.paper', overflow: 'hidden' }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, p: 2, pb: 1 }}>By model · last 30 days</Typography>
                <Box sx={{ overflowX: 'auto' }}>
                  <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 13,
                    '& th': { textAlign: 'left', fontWeight: 500, color: 'text.secondary', fontSize: 12, px: 2, py: 1, borderBottom: 1, borderColor: 'divider' },
                    '& td': { px: 2, py: 1.1, borderBottom: 1, borderColor: 'divider', fontVariantNumeric: 'tabular-nums' },
                    '& tr:last-of-type td': { borderBottom: 0 }, '& .r': { textAlign: 'right' } }}>
                    <thead><tr><th>Model</th><th className="r">Requests</th><th className="r">Input</th><th className="r">Output</th><th className="r">Cost</th></tr></thead>
                    <tbody>
                      {data.byModel.map((r) => (
                        <tr key={`${r.provider}:${r.model}`}>
                          <td>
                            <Box sx={{ fontWeight: 500 }}>{r.label?.replace(/:latest$/, '')}</Box>
                            <Box sx={{ fontSize: 11.5, color: 'text.secondary' }}>{r.providerName}</Box>
                          </td>
                          <td className="r">{r.requests}</td>
                          <td className="r">{fmt(r.inTok)}</td>
                          <td className="r">{fmt(r.outTok)}</td>
                          <td className="r">
                            {r.free ? <Chip label="FREE" size="small" sx={{ height: 20, fontSize: 10.5, fontWeight: 700, bgcolor: 'rgba(16,185,129,.14)', color: '#059669' }} />
                              : r.unknown === r.requests ? <Tooltip title="Set this provider's price in Budget & prices"><span>—</span></Tooltip> : usd(r.cost)}
                          </td>
                        </tr>
                      ))}
                      {!data.byModel.length && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'gray' }}>No usage yet — start chatting.</td></tr>}
                    </tbody>
                  </Box>
                </Box>
              </Box>
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                Token counts come from the provider when it reports them, otherwise they are estimated (≈4 characters per token). Costs are estimates — your provider's bill is final.
              </Typography>
              <Box><Button size="small" color="error" onClick={async () => { if (confirm('Clear all usage history?')) { await fetch('/api/usage', { method: 'DELETE' }); load(); } }}>Clear usage history</Button></Box>
            </Box>
          ) : tab === 1 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: '14px', bgcolor: 'background.paper' }}>
                <Typography sx={{ fontWeight: 600, fontSize: 14 }}>Your own models & local (Ollama)</Typography>
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Unlimited · free forever · runs on your PC. No credits needed.</Typography>
              </Box>
              <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: '14px', bgcolor: 'background.paper' }}>
                <Typography sx={{ fontWeight: 600, fontSize: 14 }}>Pollinations</Typography>
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Free · no key · shared rate limits.</Typography>
              </Box>
              {!bal ? <CircularProgress size={22} sx={{ mx: 'auto', my: 2 }} /> : bal.map((x) => (
                <Box key={x.id} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: '14px', bgcolor: 'background.paper', display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{x.name}</Typography>
                    {x.balance && <Typography sx={{ fontSize: 18, fontWeight: 650, my: 0.25 }}>{x.balance}</Typography>}
                    {x.note && <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{x.note}</Typography>}
                  </Box>
                  {x.page && <Button size="small" variant="outlined" color="inherit" endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />} href={x.page} target="_blank"
                    sx={{ borderColor: 'divider', flexShrink: 0 }}>{x.paid ? 'Add credits' : 'Dashboard'}</Button>}
                </Box>
              ))}
              {bal && !bal.length && (
                <Typography sx={{ fontSize: 13, color: 'text.secondary', textAlign: 'center', py: 2 }}>
                  No API providers connected. Add keys in the model picker → Connect providers.
                </Typography>
              )}
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 560 }}>
              <Box>
                <Typography sx={{ fontWeight: 600, fontSize: 14, mb: 0.5 }}>Monthly budget</Typography>
                <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1.25 }}>
                  When paid models reach this amount in a month, they are blocked until next month. Free and local models always work. 0 = no limit.
                </Typography>
                <TextField size="small" type="number" value={budget} onChange={(e) => setBudget(e.target.value)} sx={{ width: 180 }}
                  InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }} />
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 600, fontSize: 14, mb: 0.5 }}>Prices (USD per 1M tokens)</Typography>
                <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1.25 }}>
                  OpenRouter prices are loaded automatically. For other paid providers, copy the price of the model you use from their pricing page.
                </Typography>
                {paidProviders.map((p) => (
                  <Box key={p.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography sx={{ flex: 1, fontSize: 13.5 }}>{p.name}</Typography>
                    {['in', 'out'].map((k) => (
                      <TextField key={k} size="small" type="number" label={k === 'in' ? 'Input' : 'Output'} sx={{ width: 110 }}
                        value={rates[p.id]?.[k] ?? ''} onChange={(e) => setRates({ ...rates, [p.id]: { ...rates[p.id], [k]: e.target.value } })}
                        InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }} />
                    ))}
                  </Box>
                ))}
                {!paidProviders.length && <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>No paid providers connected (Claude, OpenAI, DeepSeek). Everything you use now is free.</Typography>}
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Button variant="contained" disableElevation onClick={saveBilling}>Save</Button>
                <Typography sx={{ fontSize: 13, color: 'success.main' }}>{saved}</Typography>
              </Box>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                Want to charge your own users for this app? That needs accounts + a payment gateway (e.g. Razorpay/Stripe) — ask and it can be added on top of this usage tracking.
              </Typography>
            </Box>
          )}
      </Box>
    </Dialog>
  );
}
