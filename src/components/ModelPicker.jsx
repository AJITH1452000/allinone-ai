import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Button, ButtonBase, Chip, CircularProgress, Dialog, IconButton, InputBase, Link, Tab, Tabs,
  TextField, Tooltip, Typography, alpha, useMediaQuery,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import RefreshIcon from '@mui/icons-material/Refresh';
import BoltIcon from '@mui/icons-material/Bolt';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { fetchProviders, saveKey, addCustomProvider, deleteCustomProvider } from '../lib/api';
import MyModelDialog from './MyModelDialog';

function CustomApiForm({ onAdded }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', base: '', key: '', models: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const add = async () => {
    setBusy(true); setErr('');
    try { await addCustomProvider(f); setF({ name: '', base: '', key: '', models: '' }); setOpen(false); onAdded(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  if (!open) {
    return (
      <ButtonBase onClick={() => setOpen(true)} sx={{ p: 1.5, borderRadius: 3, border: 1, borderStyle: 'dashed', borderColor: 'divider', gap: 1, justifyContent: 'flex-start', color: 'text.secondary' }}>
        <AddIcon fontSize="small" />
        <Box sx={{ textAlign: 'left' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary' }}>Add custom API / your own model server</Typography>
          <Typography sx={{ fontSize: 12 }}>Any OpenAI-compatible URL — LM Studio, vLLM, Together, Fireworks, your fine-tuned model…</Typography>
        </Box>
      </ButtonBase>
    );
  }
  return (
    <Box sx={{ p: 1.5, border: 1, borderColor: 'primary.main', borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Typography sx={{ fontWeight: 600, fontSize: 14 }}>Add custom API</Typography>
      <TextField size="small" label="Name" placeholder="My LM Studio" value={f.name} onChange={set('name')} />
      <TextField size="small" label="Base URL" placeholder="http://localhost:1234/v1" value={f.base} onChange={set('base')}
        helperText="LM Studio: http://localhost:1234/v1 · vLLM: http://localhost:8000/v1 · Together: https://api.together.xyz/v1" />
      <TextField size="small" label="API key (optional)" type="password" value={f.key} onChange={set('key')} />
      <TextField size="small" label="Model names (optional)" placeholder="my-model, llama-3-8b-finetune" value={f.models} onChange={set('models')}
        helperText="Leave empty to load the list automatically." />
      {err && <Typography sx={{ fontSize: 12.5, color: 'error.main' }}>{err}</Typography>}
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button color="inherit" onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="contained" disableElevation disabled={busy || !f.name || !f.base} onClick={add}>
          {busy ? <CircularProgress size={16} color="inherit" /> : 'Test & add'}
        </Button>
      </Box>
    </Box>
  );
}

export const PROVIDER_STYLE = {
  pollinations: { c: '#10b981', l: 'Po' },
  ollama: { c: '#64748b', l: 'Ol' },
  gemini: { c: '#4285f4', l: 'G' },
  anthropic: { c: '#d97757', l: 'A' },
  openrouter: { c: '#6366f1', l: 'OR' },
  groq: { c: '#f55036', l: 'Gq' },
  cerebras: { c: '#f97316', l: 'Ce' },
  mistral: { c: '#fa520f', l: 'M' },
  openai: { c: '#0f0f0f', l: 'AI' },
  deepseek: { c: '#4d6bfe', l: 'DS' },
};

export function ProviderAvatar({ id, size = 22 }) {
  const s = PROVIDER_STYLE[id] || (id?.startsWith('c_') ? { c: '#0ea5e9', l: id[2].toUpperCase() } : { c: '#888', l: '?' });
  return (
    <Box sx={{
      width: size, height: size, borderRadius: size / 3.5, bgcolor: s.c, color: '#fff', flexShrink: 0,
      display: 'grid', placeItems: 'center', fontSize: size * 0.42, fontWeight: 700, letterSpacing: -0.3,
    }}>{s.l}</Box>
  );
}

export function AioAvatar({ size = 22 }) {
  return (
    <Box sx={{
      width: size, height: size, borderRadius: size / 3.5, flexShrink: 0, display: 'grid', placeItems: 'center',
      background: 'linear-gradient(135deg,#c96442,#7c5cff)', color: '#fff', fontSize: size * 0.55,
    }}>✦</Box>
  );
}

const pretty = (id) => id.split('/').pop().replace(/:free$/, '').replace(/:latest$/, '');

function Section({ title, action }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, pt: 1.5, pb: 0.5 }}>
      <Typography sx={{ flex: 1, fontSize: 11, fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</Typography>
      {action}
    </Box>
  );
}

function ModelRow({ m, active, onPick }) {
  return (
    <ButtonBase onClick={() => onPick(m)} sx={{
      width: '100%', justifyContent: 'flex-start', gap: 1.25, px: 1.5, py: 1, borderRadius: '10px', textAlign: 'left',
      bgcolor: active ? (t) => alpha(t.palette.primary.main, 0.08) : 'transparent',
      '&:hover': { bgcolor: (t) => alpha(t.palette.text.primary, 0.05) },
    }}>
      {m.own ? <AioAvatar /> : <ProviderAvatar id={m.provider} />}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: 14, fontWeight: 500 }}>{m.own ? m.label : pretty(m.id)}</Typography>
        <Typography noWrap sx={{ fontSize: 11.5, color: 'text.secondary' }}>{m.own ? `${m.desc} · runs on your PC` : `${m.providerName} · ${m.id}`}</Typography>
      </Box>
      {m.fast && <Tooltip title="Ultra fast"><BoltIcon sx={{ fontSize: 16, color: '#f59e0b' }} /></Tooltip>}
      {m.vision && <Tooltip title="Understands images"><VisibilityOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} /></Tooltip>}
      {m.free && <Chip label="FREE" size="small" sx={{ height: 18, fontSize: 10, fontWeight: 700, bgcolor: alpha('#10b981', 0.14), color: '#059669' }} />}
      {active && <CheckIcon sx={{ fontSize: 18, color: 'primary.main' }} />}
    </ButtonBase>
  );
}

function ProviderRow({ p, onSaved }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const save = async (k) => {
    setBusy(true); setMsg(null);
    try {
      const r = await saveKey(p.id, k);
      setMsg({ ok: true, t: k ? `Connected · ${r.count} models` : 'Removed' }); setKey(''); onSaved();
    } catch (e) { setMsg({ ok: false, t: e.message }); }
    setBusy(false);
  };
  return (
    <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 3, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <ProviderAvatar id={p.id} size={28} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{p.name}</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{p.tag}</Typography>
        </Box>
        {p.connected
          ? <Chip icon={<CheckCircleIcon />} label={p.builtin ? 'Built-in' : `Connected${p.hint ? ` · ${p.hint}` : ''}`} size="small" color="success" variant="outlined" />
          : p.url && <Link href={p.url} target="_blank" rel="noreferrer" underline="hover" sx={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 0.4 }}>
              {p.id === 'ollama' ? 'Download' : 'Get key'} <OpenInNewIcon sx={{ fontSize: 13 }} /></Link>}
      </Box>
      {!p.builtin && !p.custom && (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField size="small" fullWidth type="password" placeholder={p.connected ? 'Paste a new key to replace' : 'Paste API key'}
            value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && key && save(key)}
            InputProps={{ sx: { fontSize: 13, borderRadius: 2 } }} />
          <Button variant="contained" disableElevation disabled={!key || busy} onClick={() => save(key)} sx={{ minWidth: 76, borderRadius: 2 }}>
            {busy ? <CircularProgress size={16} color="inherit" /> : 'Save'}
          </Button>
          {p.source === 'app' && <Button color="inherit" disabled={busy} onClick={() => save('')} sx={{ borderRadius: 2 }}>Remove</Button>}
        </Box>
      )}
      {p.custom && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="small" color="error" onClick={async () => { if (confirm(`Remove ${p.name}?`)) { await deleteCustomProvider(p.id); onSaved(); } }}>Remove</Button>
        </Box>
      )}
      {p.id === 'ollama' && !p.connected && (
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
          Not running. Install it, run <code>ollama pull llama3.2</code>, then press reload — unlimited free models on your PC.
        </Typography>
      )}
      {msg && <Typography sx={{ fontSize: 12.5, color: msg.ok ? 'success.main' : 'error.main' }}>{msg.t}</Typography>}
    </Box>
  );
}

export default function ModelPicker({ models, value, onChange, freeOnly, loading, onRefresh, status = [], myModels = [], onSaveMyModel, onDeleteMyModel, requestOpen }) {
  const [open, setOpen] = useState(false);
  // Opened from outside (account menu → Get API keys, Settings → API keys)
  useEffect(() => { if (requestOpen) { setTab(requestOpen.tab ?? 0); setOpen(true); } }, [requestOpen]);
  const [builder, setBuilder] = useState(null); // null = closed, {} = new, model = edit
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [providers, setProviders] = useState([]);
  const searchRef = useRef();
  const fullScreen = useMediaQuery('(max-width:600px)');

  const selected = models.find((m) => value && m.provider === value.provider && m.id === value.id);
  const selectedMine = value?.provider === 'mine' ? myModels.find((x) => x.id === value.id) : null;
  const mineList = myModels.filter((x) => !q || `${x.name} ${x.instructions}`.toLowerCase().includes(q.toLowerCase()));
  const loadProviders = () => fetchProviders().then(setProviders).catch(() => {});
  useEffect(() => { if (open) { loadProviders(); onRefresh(); setTimeout(() => searchRef.current?.focus(), 50); } }, [open]); // eslint-disable-line

  const providerIds = useMemo(() => [...new Set(models.map((m) => m.provider))], [models]);
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return models.filter((m) => {
      if (freeOnly && !m.free) return false;
      if (filter === 'free' && !m.free) return false;
      if (filter === 'fast' && !m.fast) return false;
      if (filter === 'vision' && !m.vision) return false;
      if (!['all', 'free', 'fast', 'vision'].includes(filter) && m.provider !== filter) return false;
      const hay = `${m.id} ${m.providerName}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [models, q, filter, freeOnly]);

  const ownList = list.filter((m) => m.own);
  const otherList = list.filter((m) => !m.own);
  const familyName = models.find((m) => m.own)?.providerName?.split(" · ")[0] || "Learn";
  const pick = (m) => { onChange({ provider: m.provider, id: m.id }); setOpen(false); setQ(''); };
  const connected = providers.filter((p) => p.connected).length;

  return (
    <>
      <ButtonBase onClick={() => { setTab(models.length ? 0 : 1); setOpen(true); }} sx={{
        gap: 1, px: 1.25, py: 0.75, borderRadius: 2.5, maxWidth: { xs: 220, sm: 360 },
        '&:hover': { bgcolor: (t) => alpha(t.palette.text.primary, 0.06) },
      }}>
        {loading ? <CircularProgress size={18} /> : selectedMine ? <Box sx={{ fontSize: 18 }}>{selectedMine.icon}</Box>
          : selected ? (selected.own ? <AioAvatar size={20} /> : <ProviderAvatar id={selected.provider} size={20} />) : null}
        <Typography noWrap sx={{ fontWeight: 600, fontSize: 15 }}>
          {loading ? 'Loading models…' : selectedMine ? selectedMine.name : selected ? (selected.own ? selected.label : pretty(selected.id)) : models.length ? 'Choose a model' : 'Connect a provider'}
        </Typography>
        <KeyboardArrowDownIcon fontSize="small" sx={{ color: 'text.secondary' }} />
      </ButtonBase>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" fullScreen={fullScreen}
        PaperProps={{ sx: { borderRadius: fullScreen ? 0 : '20px', height: fullScreen ? '100%' : 'min(640px, 85vh)', display: 'flex', flexDirection: 'column' } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', px: 2, pt: 1 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ flex: 1, minHeight: 40, '& .MuiTab-root': { minHeight: 40, fontWeight: 600 } }}>
            <Tab label={`Models (${models.length})`} />
            <Tab label={`Connect providers${providers.length ? ` (${connected}/${providers.length})` : ''}`} />
          </Tabs>
          <Tooltip title="Reload models"><IconButton size="small" onClick={onRefresh}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
          <IconButton size="small" onClick={() => setOpen(false)}><CloseIcon fontSize="small" /></IconButton>
        </Box>

        {tab === 0 ? (
          <>
            <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.9, borderRadius: '12px', bgcolor: (t) => alpha(t.palette.text.primary, 0.05) }}>
                <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                <InputBase inputRef={searchRef} fullWidth placeholder="Search models… e.g. claude, gemini, llama"
                  value={q} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && list[0] && pick(list[0])} />
              </Box>
              <Box sx={{ display: 'flex', gap: 0.75, mt: 1.25, overflowX: 'auto', pb: 0.5, '&::-webkit-scrollbar': { display: 'none' } }}>
                {[['all', 'All'], ['free', 'Free'], ['fast', '⚡ Fast'], ['vision', 'Vision']].map(([k, l]) => (
                  <Chip key={k} label={l} size="small" onClick={() => setFilter(k)} color={filter === k ? 'primary' : 'default'}
                    variant={filter === k ? 'filled' : 'outlined'} />
                ))}
                {providerIds.map((id) => (
                  <Chip key={id} size="small" avatar={<Box sx={{ display: 'grid !important', placeItems: 'center' }}><ProviderAvatar id={id} size={18} /></Box>}
                    label={models.find((m) => m.provider === id && !m.own)?.providerName || 'Ollama (local)'} onClick={() => setFilter(id)}
                    color={filter === id ? 'primary' : 'default'} variant={filter === id ? 'filled' : 'outlined'} />
                ))}
              </Box>
            </Box>
            <Box sx={{ flex: 1, overflowY: 'auto', px: 1, pb: 1 }}>
              {/* 1. Your own model family (Learn Lite / Pro / Max) */}
              {filter === 'all' && (
                <>
                  <Section title={`${familyName} · your models`} />
                  {ownList.map((m) => (
                    <ModelRow key={`${m.provider}:${m.id}`} m={m} onPick={pick}
                      active={value && value.provider === m.provider && value.id === m.id} />
                  ))}
                  {!ownList.length && !q && (
                    <Typography sx={{ px: 1.5, pb: 1, fontSize: 12.5, color: 'text.secondary' }}>
                      Not built yet — run <code>npm run build-models</code>, then press reload ↻.
                    </Typography>
                  )}
                </>
              )}

              {/* 2. Assistants you built (base model + instructions + your files) */}
              {filter === 'all' && (
                <>
                  <Section title="Your assistants" action={
                    <Button size="small" startIcon={<AddIcon />} onClick={() => setBuilder({})} disabled={!models.length} sx={{ fontSize: 12.5, py: 0 }}>Create</Button>
                  } />
                  {mineList.map((x) => {
                    const active = value?.provider === 'mine' && value.id === x.id;
                    return (
                      <Box key={x.id} sx={{ display: 'flex', alignItems: 'center', '&:hover .edit': { opacity: 1 } }}>
                        <ButtonBase onClick={() => { onChange({ provider: 'mine', id: x.id }); setOpen(false); setQ(''); }} sx={{
                          flex: 1, justifyContent: 'flex-start', gap: 1.25, px: 1.5, py: 1, borderRadius: '10px', textAlign: 'left', minWidth: 0,
                          bgcolor: active ? (t) => alpha(t.palette.primary.main, 0.08) : 'transparent',
                          '&:hover': { bgcolor: (t) => alpha(t.palette.text.primary, 0.05) },
                        }}>
                          <Box sx={{ width: 22, fontSize: 18, textAlign: 'center' }}>{x.icon}</Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography noWrap sx={{ fontSize: 14, fontWeight: 500 }}>{x.name}</Typography>
                            <Typography noWrap sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                              on {models.find((mm) => x.base && mm.provider === x.base.provider && mm.id === x.base.id)?.label?.replace(/:latest$/, '') || pretty(x.base?.id || '?')} · {x.instructions}
                            </Typography>
                          </Box>
                          {active && <CheckIcon sx={{ fontSize: 18, color: 'primary.main' }} />}
                        </ButtonBase>
                        <IconButton className="edit" size="small" sx={{ opacity: 0.4 }} onClick={() => setBuilder(x)}><EditOutlinedIcon fontSize="small" /></IconButton>
                      </Box>
                    );
                  })}
                  {!myModels.length && (
                    <Typography sx={{ px: 1.5, pb: 1, fontSize: 12.5, color: 'text.secondary' }}>
                      Make an assistant with your own instructions and files (PDF, Word, notes).
                    </Typography>
                  )}
                  <Section title="All models" />
                </>
              )}

              {/* 3. Everything else */}
              {(filter === 'all' ? otherList : list).map((m) => (
                <ModelRow key={`${m.provider}:${m.id}`} m={m} onPick={pick}
                  active={value && value.provider === m.provider && value.id === m.id} />
              ))}
              {!list.length && (
                <Box sx={{ textAlign: 'center', py: 6, px: 3 }}>
                  <Typography sx={{ fontWeight: 600, mb: 0.5 }}>{models.length ? 'No matching models' : 'No models yet'}</Typography>
                  <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 2 }}>
                    Google Gemini, Claude and others need their own API key. Gemini, Groq & OpenRouter keys are free.
                  </Typography>
                  <Button variant="contained" disableElevation onClick={() => setTab(1)} sx={{ borderRadius: 2 }}>Connect providers</Button>
                </Box>
              )}
              {!!list.length && models.length < 10 && (
                <ButtonBase onClick={() => setTab(1)} sx={{ width: '100%', mt: 1, p: 1.5, borderRadius: 2, border: 1, borderStyle: 'dashed', borderColor: 'divider', color: 'text.secondary', fontSize: 13.5 }}>
                  + Add Google Gemini, Claude, OpenRouter (300+ models)…
                </ButtonBase>
              )}
            </Box>
          </>
        ) : (
          <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              Keys are tested, then saved only on this computer (keys.json next to server.js). Models appear instantly — no restart.
              Tip: one free <b>OpenRouter</b> key unlocks hundreds of models, including Google and Claude (paid ones need credit).
            </Typography>
            {status.filter((s) => !s.ok && s.id !== 'ollama').map((s) => (
              <Typography key={s.id} sx={{ fontSize: 12.5, color: 'error.main' }}>{s.name}: {s.error}</Typography>
            ))}
            {providers.map((p) => <ProviderRow key={p.id} p={p} onSaved={() => { loadProviders(); onRefresh(); }} />)}
            {!providers.length && <CircularProgress size={24} sx={{ mx: 'auto', mt: 4 }} />}
            <CustomApiForm onAdded={() => { loadProviders(); onRefresh(); }} />
          </Box>
        )}
      </Dialog>
      <MyModelDialog open={!!builder} initial={builder?.id ? builder : null} models={models}
        onClose={() => setBuilder(null)}
        onSave={(m) => { onSaveMyModel(m); onChange({ provider: 'mine', id: m.id }); setOpen(false); }}
        onDelete={onDeleteMyModel} />
    </>
  );
}
