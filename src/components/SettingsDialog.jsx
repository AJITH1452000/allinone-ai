import { useEffect, useRef, useState } from 'react';
import {
  Box, Button, ButtonBase, Dialog, Divider, FormControlLabel, IconButton, MenuItem, Select, Slider, Switch, TextField, Typography,
  ToggleButton, ToggleButtonGroup, useMediaQuery,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import TuneIcon from '@mui/icons-material/Tune';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import HowToRegOutlinedIcon from '@mui/icons-material/HowToRegOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import { AccessTab, AuditTab, AdminTab, ConsentTab } from './OfficeAdmin';
import KeyboardOutlinedIcon from '@mui/icons-material/KeyboardOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PsychologyAltOutlinedIcon from '@mui/icons-material/PsychologyAltOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { LANG_MODES } from '../lib/personas';

export const SETTINGS_TABS = [
  { id: 'general', label: 'General', Icon: TuneIcon },
  { id: 'profile', label: 'Profile', Icon: PersonOutlineIcon },
  { id: 'memory', label: 'Memory', Icon: PsychologyAltOutlinedIcon },
  { id: 'models', label: 'Models & tokens', Icon: AutoAwesomeOutlinedIcon },
  { id: 'keys', label: 'API keys', Icon: KeyOutlinedIcon },
  { id: 'training', label: 'Training', Icon: SchoolOutlinedIcon },
  { id: 'data', label: 'Data controls', Icon: StorageOutlinedIcon },
  { id: 'shortcuts', label: 'Shortcuts', Icon: KeyboardOutlinedIcon },
  { id: 'about', label: 'About', Icon: InfoOutlinedIcon },
];

export const SHORTCUTS = [
  ['New chat', 'Ctrl + Shift + O'],
  ['Open settings', 'Ctrl + Shift + ,'],
  ['Search chats', 'Ctrl + K'],
  ['Toggle sidebar', 'Ctrl + B'],
  ['Show shortcuts', 'Ctrl + /'],
  ['Send message', 'Enter'],
  ['New line', 'Shift + Enter'],
  ['Stop generating', 'Esc'],
];

/** Long-term memory: facts the AI keeps across all chats. Stored only in this browser. */
// Settings → Training: what Learn has learned from (your 👍 / ✏️ / 👎, self-practice, your code, open-source code)
function TrainingTab() {
  const [st, setSt] = useState(null);
  useEffect(() => { fetch('/api/training/stats').then((r) => r.json()).then(setSt).catch(() => setSt({ error: true })); }, []);
  if (!st) return <Typography sx={{ color: 'text.secondary', fontSize: 14 }}>Loading…</Typography>;
  if (st.error) return <Typography sx={{ color: 'text.secondary', fontSize: 14 }}>Training data lives on your PC — run the app locally to see it.</Typography>;
  const tiles = [['👍 Good', st.good], ['✏️ Corrected', st.corrected], ['👎 Bad', st.bad], ['Pairs', st.pairs], ['Lessons', st.lessons]];
  const files = Object.entries(st.files || {}).filter(([, n]) => n > 0);
  return (
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 1, mb: 2 }}>
        {tiles.map(([l, n]) => (
          <Box key={l} sx={{ p: 1.25, borderRadius: '12px', border: 1, borderColor: 'divider', textAlign: 'center' }}>
            <Typography sx={{ fontSize: 22, fontWeight: 700 }}>{n}</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{l}</Typography>
          </Box>
        ))}
      </Box>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1.5 }}>
        Press 👍 / 👎 / ✏️ under Learn's answers. Corrections count double. Answers from online AIs are never saved (their terms forbid training on them).
      </Typography>
      {files.map(([name, n]) => (
        <Row key={name} title={`${name}.jsonl`} desc={`${n} row${n === 1 ? '' : 's'}`}>
          <Button variant="outlined" color="inherit" size="small" href={`/api/training/file/${name}`} sx={{ borderColor: 'divider' }}>Export</Button>
        </Row>
      ))}
      {!!Object.keys(st.quality || {}).length && (
        <>
          <Typography sx={{ fontSize: 13, fontWeight: 600, mt: 2, mb: 0.5 }}>How answers got verified</Typography>
          {Object.entries(st.quality).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
            <Typography key={k} sx={{ fontSize: 13, color: 'text.secondary' }}>{k} — {n}×</Typography>
          ))}
        </>
      )}
    </>
  );
}

function MemoryTab({ settings, setSettings }) {
  const [draft, setDraft] = useState('');
  const list = settings.memories || [];
  const save = (memories) => setSettings((s) => ({ ...s, memories }));
  const add = () => { const t = draft.trim(); if (t) { save([...list, { id: Math.random().toString(36).slice(2, 10), text: t.slice(0, 300), at: Date.now() }]); setDraft(''); } };
  return (
    <>
      <Row title="Use memory" desc='The AI remembers facts you tell it — say "remember that I prefer TypeScript". Saved memories are added to every chat.'>
        <Switch checked={settings.memoryOn !== false} onChange={(e) => setSettings((s) => ({ ...s, memoryOn: e.target.checked }))} />
      </Row>
      <Row column title={`Saved memories (${list.length})`} desc="Stored only in this browser. Delete anything you don't want the AI to know.">
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField size="small" fullWidth placeholder="Add a memory, e.g. I'm preparing for TNPSC Group 2" value={draft}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <Button variant="contained" disableElevation disabled={!draft.trim()} onClick={add}>Add</Button>
        </Box>
        {list.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 1.5 }}>Nothing saved yet.</Typography>
        ) : list.map((m) => (
          <Box key={m.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
            <Typography sx={{ flex: 1, fontSize: 14 }}>{m.text}</Typography>
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary', flexShrink: 0 }}>{new Date(m.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Typography>
            <IconButton size="small" onClick={() => save(list.filter((x) => x.id !== m.id))}><DeleteOutlineIcon fontSize="small" /></IconButton>
          </Box>
        ))}
      </Row>
      {list.length > 0 && (
        <Row title="Forget everything" desc="Deletes all saved memories. This cannot be undone.">
          <Button variant="outlined" color="error" size="small" onClick={() => { if (confirm('Delete all saved memories?')) save([]); }}>Delete all</Button>
        </Row>
      )}
    </>
  );
}

function Row({ title, desc, children, column }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: column ? 'column' : { xs: 'column', sm: 'row' }, alignItems: column ? 'stretch' : { sm: 'center' },
      gap: column ? 1 : { xs: 1, sm: 3 }, py: 2, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 500 }}>{title}</Typography>
        {desc && <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>{desc}</Typography>}
      </Box>
      <Box sx={{ flexShrink: 0, ...(column ? { width: '100%' } : {}) }}>{children}</Box>
    </Box>
  );
}

/** Optional search API keys. Without them: DuckDuckGo (may rate-limit) + Wikipedia. */
function SearchKeys() {
  const [have, setHave] = useState({});
  const [val, setVal] = useState({ tavily: '', brave: '' });
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState('');
  const load = () => fetch('/api/search-keys').then((r) => r.json()).then(setHave).catch(() => {});
  useEffect(() => { load(); }, []);
  const save = async (engine, key) => {
    setBusy(engine); setMsg((m) => ({ ...m, [engine]: '' }));
    const r = await fetch('/api/search-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine, key }) });
    const j = await r.json().catch(() => ({}));
    setMsg((m) => ({ ...m, [engine]: r.ok ? (key ? '✓ Connected' : 'Removed') : j.error }));
    setBusy(''); setVal((v) => ({ ...v, [engine]: '' })); load();
  };
  return (
    <>
      {[['tavily', 'Tavily', 'Best for AI answers · free monthly credits', 'https://app.tavily.com'],
        ['brave', 'Brave Search', 'Independent web index · free plan', 'https://api-dashboard.search.brave.com']].map(([id, name, desc, url]) => (
        <Row key={id} column title={<>{name} {have[id] && <Typography component="span" sx={{ fontSize: 12, color: 'success.main', ml: 1 }}>Connected · {have[id]}</Typography>}</>}
          desc={<>{desc} — <a href={url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>get a key</a></>}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField size="small" fullWidth type="password" placeholder={have[id] ? 'Paste a new key to replace' : 'Paste API key'}
              value={val[id]} onChange={(e) => setVal((v) => ({ ...v, [id]: e.target.value }))} />
            <Button variant="contained" disableElevation disabled={!val[id] || busy === id} onClick={() => save(id, val[id])}>{busy === id ? '…' : 'Save'}</Button>
            {have[id] && <Button color="inherit" onClick={() => save(id, '')}>Remove</Button>}
          </Box>
          {msg[id] && <Typography sx={{ fontSize: 12.5, color: msg[id].startsWith('✓') || msg[id] === 'Removed' ? 'success.main' : 'error.main' }}>{msg[id]}</Typography>}
        </Row>
      ))}
      <Typography sx={{ fontSize: 12, color: 'text.secondary', pt: 1 }}>
        Without a key, the app uses DuckDuckGo (can be rate-limited) and Wikipedia (English & Tamil). For live prices, news and latest versions, add a Tavily or Brave key.
      </Typography>
    </>
  );
}

const Kbd = ({ children }) => (
  <Box component="kbd" sx={{ px: 0.75, py: 0.25, borderRadius: '6px', border: 1, borderColor: 'divider', fontSize: 12, fontFamily: 'inherit', bgcolor: 'background.default' }}>
    {children}
  </Box>
);

export default function SettingsDialog({ open, onClose, tab: initialTab = 'general', settings, setSettings, chats, onClearAll, onImport, onOpenKeys, onOpenUsage }) {
  const [tab, setTab] = useState(initialTab);
  const [msg, setMsg] = useState('');
  const fileRef = useRef();
  const full = useMediaQuery('(max-width:700px)');
  useEffect(() => { if (open) { setTab(initialTab); setMsg(''); } }, [open, initialTab]);
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  const setProfile = (k, v) => setSettings((s) => ({ ...s, profile: { ...s.profile, [k]: v } }));
  const p = settings.profile || {};

  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ app: 'all-in-one-ai', exportedAt: new Date().toISOString(), chats, settings: { ...settings } }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `all-in-one-ai-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(a.href);
  };
  // 👍 answers from LOCAL models → training examples for Learn Code+ (Kaggle notebook picks up evolvix-training-*.jsonl).
  // Answers from online AIs (Claude, ChatGPT, Gemini…) are left out: their terms forbid training other models on them.
  const exportTraining = () => {
    const strip = (s = '') => s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').replace(/<\/?search_results>/gi, '').trim();
    const rows = [];
    let skippedCloud = 0;
    for (const c of chats) {
      c.messages.forEach((m, i) => {
        if (m.role !== 'assistant' || m.feedback !== 'up' || m.error || !m.content) return;
        if (m.model?.provider !== 'ollama') { skippedCloud++; return; }
        const q = c.messages.slice(0, i).reverse().find((x) => x.role === 'user');
        if (!q?.content || q.images?.length) return;
        rows.push(JSON.stringify({ messages: [{ role: 'user', content: q.content }, { role: 'assistant', content: strip(m.content) }], model: m.model.id }));
      });
    }
    if (!rows.length) { setMsg(`No 👍 answers from local models yet${skippedCloud ? ` (${skippedCloud} from online AIs were skipped)` : ''}. Rate good answers with 👍 first.`); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n') + '\n'], { type: 'application/jsonl' }));
    a.download = `evolvix-training-${new Date().toISOString().slice(0, 10)}.jsonl`; a.click();
    URL.revokeObjectURL(a.href);
    setMsg(`Exported ${rows.length} training example${rows.length > 1 ? 's' : ''}${skippedCloud ? ` · ${skippedCloud} from online AIs skipped` : ''}`);
  };
  const importAll = async (file) => {
    try {
      const j = JSON.parse(await file.text());
      if (!Array.isArray(j.chats)) throw new Error('Not a backup file');
      onImport(j.chats); setMsg(`Imported ${j.chats.length} chats`);
    } catch (e) { setMsg(`Import failed: ${e.message}`); }
  };

  const content = {
    general: (
      <>
        <Row title="Appearance" desc="Light, dark, or follow your system.">
          <ToggleButtonGroup size="small" exclusive value={settings.theme} onChange={(_, v) => v && set('theme', v)}>
            <ToggleButton value="light">Light</ToggleButton><ToggleButton value="dark">Dark</ToggleButton><ToggleButton value="system">System</ToggleButton>
          </ToggleButtonGroup>
        </Row>
        <Row title="Reply language" desc="The language the AI answers in.">
          <Select size="small" value={settings.lang} onChange={(e) => set('lang', e.target.value)} sx={{ minWidth: 150 }}>
            {LANG_MODES.map((l) => <MenuItem key={l.id} value={l.id}>{l.id === 'auto' ? 'Auto (match me)' : l.label}</MenuItem>)}
          </Select>
        </Row>
        <Row title="Chat font size">
          <ToggleButtonGroup size="small" exclusive value={settings.fontSize || 'default'} onChange={(_, v) => v && set('fontSize', v)}>
            <ToggleButton value="small">Small</ToggleButton><ToggleButton value="default">Default</ToggleButton><ToggleButton value="large">Large</ToggleButton>
          </ToggleButtonGroup>
        </Row>
        <Row title="Read replies aloud" desc="Speaks every answer automatically (Tamil and English voices). You can also press 🔊 under any answer.">
          <Switch checked={!!settings.autoSpeak} onChange={(e) => set('autoSpeak', e.target.checked)} />
        </Row>
        <Row title="Send with Enter" desc="Off: Enter adds a new line and Ctrl + Enter sends.">
          <Switch checked={settings.enterToSend !== false} onChange={(e) => set('enterToSend', e.target.checked)} />
        </Row>
        <Row title="Show only free models" desc="Hide paid models in the model picker.">
          <Switch checked={!!settings.freeOnly} onChange={(e) => set('freeOnly', e.target.checked)} />
        </Row>
      </>
    ),
    profile: (
      <>
        <Row title="Full name">
          <TextField size="small" value={p.name || ''} onChange={(e) => setProfile('name', e.target.value)} placeholder="Your name" sx={{ width: 240 }} />
        </Row>
        <Row title="What should the AI call you?">
          <TextField size="small" value={p.callMe || ''} onChange={(e) => setProfile('callMe', e.target.value)} placeholder="e.g. Ajith" sx={{ width: 240 }} />
        </Row>
        <Row title="What best describes your work?">
          <Select size="small" displayEmpty value={p.work || ''} onChange={(e) => setProfile('work', e.target.value)} sx={{ width: 240 }}>
            <MenuItem value="">Select…</MenuItem>
            {['Software developer', 'Student', 'Teacher', 'Designer', 'Business owner', 'Data / AI', 'Writer / Content creator', 'Government exam aspirant', 'Other'].map((w) => <MenuItem key={w} value={w}>{w}</MenuItem>)}
          </Select>
        </Row>
        <Row column title="Personal preferences" desc="What should the AI keep in mind in every chat? (added to every conversation)">
          <TextField fullWidth multiline minRows={4} value={settings.customSystem || ''} onChange={(e) => set('customSystem', e.target.value)}
            placeholder="e.g. I'm a React developer from Chennai. Keep answers short and give full code. Explain in Tanglish when I ask in Tanglish." />
        </Row>
      </>
    ),
    memory: <MemoryTab settings={settings} setSettings={setSettings} />,
    training: window.__EVX_OFFICE && window.__EVX_USER?.role !== 'owner' ? <ConsentTab /> : <TrainingTab />,
    access: <AccessTab />,
    audit: <AuditTab />,
    admin: <AdminTab />,
    models: (
      <>
        <Row title="Reasoning mode" desc="Fast = quick answers. Expert = plans step by step and double-checks itself (slower). Also in the message box.">
          <ToggleButtonGroup size="small" exclusive value={settings.reasoning || 'balanced'} onChange={(_, v) => v && set('reasoning', v)}>
            <ToggleButton value="fast">⚡ Fast</ToggleButton><ToggleButton value="balanced">Balanced</ToggleButton><ToggleButton value="expert">🧠 Expert</ToggleButton>
          </ToggleButtonGroup>
        </Row>
        <Row title="Use tools" desc="Exact calculator, date counter, memory and web search when a message needs them (models that support tools).">
          <Switch checked={(settings.tools || 'auto') !== 'off'} onChange={(e) => set('tools', e.target.checked ? 'auto' : 'off')} />
        </Row>
        <Row title="Let the AI run code" desc="JavaScript runs in a locked sandbox on this PC: no files, no programs, 5-second limit. Off by default.">
          <Switch checked={!!settings.allowCode} onChange={(e) => set('allowCode', e.target.checked)} />
        </Row>
        <Row column title={`Creativity: ${settings.temperature}`} desc="Lower = precise and consistent. Higher = more creative.">
          <Slider min={0} max={1.5} step={0.1} value={settings.temperature} onChange={(_, v) => set('temperature', v)}
            marks={[{ value: 0, label: 'Precise' }, { value: 0.7, label: 'Balanced' }, { value: 1.5, label: 'Creative' }]} sx={{ mx: 3.5, width: 'calc(100% - 56px)' }} />
        </Row>
        <Row column title={`Max reply length: ${settings.maxTokens} tokens`} desc="Caps how long one answer can be.">
          <Slider min={512} max={8192} step={256} value={settings.maxTokens} onChange={(_, v) => set('maxTokens', v)}
            marks={[{ value: 512, label: 'Short' }, { value: 4096, label: 'Medium' }, { value: 8192, label: 'Long code' }]} sx={{ mx: 3.5, width: 'calc(100% - 56px)' }} />
        </Row>
        <Row column title={`Chat memory: last ${settings.memory} messages`} desc="Only these recent messages are sent each time. Old images, files and code are trimmed automatically.">
          <Slider min={2} max={40} step={2} value={settings.memory} onChange={(_, v) => set('memory', v)}
            marks={[{ value: 4, label: 'Cheap' }, { value: 10, label: 'Balanced' }, { value: 40, label: 'Full' }]} sx={{ mx: 3.5, width: 'calc(100% - 56px)' }} />
        </Row>
        <Row title="Short answers" desc="Asks the model to skip filler — uses fewer tokens.">
          <Switch checked={!!settings.concise} onChange={(e) => set('concise', e.target.checked)} />
        </Row>
        <Row title="Usage & billing" desc="Tokens, cost, credits and monthly budget.">
          <Button variant="outlined" color="inherit" size="small" onClick={onOpenUsage} sx={{ borderColor: 'divider' }}>Open</Button>
        </Row>
      </>
    ),
    keys: (
      <>
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary', py: 2 }}>
          Connect Google Gemini, Claude, ChatGPT (OpenAI), OpenRouter, Groq and more. Keys are tested, then stored only on this computer.
        </Typography>
        <Row title="Manage API keys & custom APIs">
          <Button variant="contained" disableElevation size="small" onClick={onOpenKeys}>Open</Button>
        </Row>
        <Row title="Your own Learn models" desc="Runs free on your PC with Ollama — no key needed. Rebuild with: npm run build-models" />
        <Typography sx={{ fontSize: 14, fontWeight: 600, pt: 3, pb: 0.5 }}>Web search (for accurate, up-to-date answers)</Typography>
        <Row title="When to search">
          <ToggleButtonGroup size="small" exclusive value={settings.webSearch || 'auto'} onChange={(_, v) => v && set('webSearch', v)}>
            <ToggleButton value="auto">Auto</ToggleButton><ToggleButton value="on">Always</ToggleButton><ToggleButton value="off">Off</ToggleButton>
          </ToggleButtonGroup>
        </Row>
        <SearchKeys />
      </>
    ),
    data: (
      <>
        <Row title="Export all chats" desc="Download a backup file of every chat (JSON).">
          <Button variant="outlined" color="inherit" size="small" onClick={exportAll} sx={{ borderColor: 'divider' }}>Export</Button>
        </Row>
        <Row title="Import chats" desc="Restore from a backup file. Imported chats are added to your list.">
          <Button variant="outlined" color="inherit" size="small" onClick={() => fileRef.current.click()} sx={{ borderColor: 'divider' }}>Import</Button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => { e.target.files[0] && importAll(e.target.files[0]); e.target.value = ''; }} />
        </Row>
        <Row title="Export training data" desc="Your 👍 answers from local Learn / Ollama models as a JSONL file for training Learn Code+ on Kaggle (see training/README.md). Answers from online AIs are left out.">
          <Button variant="outlined" color="inherit" size="small" onClick={exportTraining} sx={{ borderColor: 'divider' }}>Export</Button>
        </Row>
        <Row title="Lessons from the build agent" desc="Every project the agent verified or fixed (local models only) is saved as a training example: the request + the final working files, and the broken first try vs the fixed version. Upload this file to Kaggle with the Learn Code+ notebook so the model learns from its own mistakes.">
          <Button variant="outlined" color="inherit" size="small" href="/api/training/export" sx={{ borderColor: 'divider' }}>Download</Button>
        </Row>
        <Row title="Where your data lives" desc="Chats & settings: this browser. API keys, your files and usage: data/ and keys.json next to server.js. Nothing is sent anywhere except to the AI provider you choose." />
        <Row title="Delete all chats" desc="This cannot be undone.">
          <Button variant="outlined" color="error" size="small" onClick={() => { if (confirm('Delete ALL chats? This cannot be undone.')) { onClearAll(); setMsg('All chats deleted'); } }}>Delete all</Button>
        </Row>
        {msg && <Typography sx={{ fontSize: 13, color: msg.includes('failed') ? 'error.main' : 'success.main', pt: 1 }}>{msg}</Typography>}
      </>
    ),
    shortcuts: (
      <Box sx={{ py: 1 }}>
        {SHORTCUTS.map(([label, keys]) => (
          <Box key={label} sx={{ display: 'flex', alignItems: 'center', py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
            <Typography sx={{ flex: 1, fontSize: 14 }}>{label}</Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>{keys.split(' + ').map((k) => <Kbd key={k}>{k}</Kbd>)}</Box>
          </Box>
        ))}
      </Box>
    ),
    about: (
      <>
        <Row title="Evolvix" desc="One app for your own Learn models, local Ollama models, Google Gemini, Claude, ChatGPT and more." />
        <Row title="Your models" desc="Learn Lite · Learn Pro · Learn Max — built from models/Modelfile.* and models/system.md." />
        <Row title="Privacy" desc="Runs on your computer. Chats stay in your browser; local models never send data anywhere." />
      </>
    ),
  };

  // Office mode: the owner also gets Access / Audit / Admin; users don't see keys or data controls
  const owner = window.__EVX_OFFICE && window.__EVX_USER?.role === 'owner';
  const TABS = !window.__EVX_OFFICE ? SETTINGS_TABS
    : owner ? [...SETTINGS_TABS, { id: 'access', label: 'Access', Icon: HowToRegOutlinedIcon }, { id: 'audit', label: 'Audit', Icon: ReceiptLongOutlinedIcon }, { id: 'admin', label: 'Admin', Icon: AdminPanelSettingsOutlinedIcon }]
      : SETTINGS_TABS.filter((t) => !['keys', 'data'].includes(t.id));
  const current = TABS.find((t) => t.id === tab) || TABS[0];
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" fullScreen={full}
      PaperProps={{ sx: { borderRadius: full ? 0 : '20px', height: full ? '100%' : 'min(640px, 88vh)', overflow: 'hidden' } }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, height: '100%' }}>
        {/* Left navigation */}
        <Box sx={{ width: { sm: 210 }, flexShrink: 0, p: 1.5, borderRight: { sm: 1 }, borderBottom: { xs: 1, sm: 0 }, borderColor: 'divider', bgcolor: 'background.side' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', px: 1, pb: 1.5 }}>
            <Typography sx={{ flex: 1, fontSize: 17, fontWeight: 650 }}>Settings</Typography>
            <IconButton size="small" onClick={onClose} sx={{ display: { sm: 'none' } }}><CloseIcon fontSize="small" /></IconButton>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: { xs: 'row', sm: 'column' }, gap: 0.25, overflowX: 'auto' }}>
            {TABS.map(({ id, label, Icon }) => (
              <ButtonBase key={id} onClick={() => setTab(id)} sx={{
                justifyContent: 'flex-start', gap: 1.25, px: 1.25, py: 0.9, borderRadius: '10px', fontSize: 13.5, flexShrink: 0,
                fontWeight: tab === id ? 600 : 400, bgcolor: tab === id ? 'action.selected' : 'transparent', '&:hover': { bgcolor: 'action.hover' },
              }}>
                <Icon sx={{ fontSize: 18, color: 'text.secondary' }} /> {label}
              </ButtonBase>
            ))}
          </Box>
        </Box>
        {/* Content */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', px: 3, pt: 2.5, pb: 0.5 }}>
            <Typography sx={{ flex: 1, fontSize: 17, fontWeight: 600 }}>{current.label}</Typography>
            <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
          </Box>
          <Divider sx={{ display: { xs: 'none', sm: 'block' }, mx: 3 }} />
          <Box sx={{ flex: 1, overflowY: 'auto', px: 3, pb: 3 }}>{content[tab]}</Box>
        </Box>
      </Box>
    </Dialog>
  );
}
