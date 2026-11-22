import { useRef, useState } from 'react';
import { Box, Paper, TextField, IconButton, Tooltip, Chip, Menu, MenuItem, ListItemIcon, Typography, Switch, Divider, alpha } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import { BRAND, BRAND_GRADIENT } from '../brand';
import StopIcon from '@mui/icons-material/Stop';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import CloseIcon from '@mui/icons-material/Close';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { PERSONAS, LANG_MODES } from '../lib/personas';
import LanguageIcon from '@mui/icons-material/Language';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import TerminalIcon from '@mui/icons-material/Terminal';

// Reasoning modes — Fast answers instantly, Expert thinks step by step and then checks its own answer
export const REASONING_MODES = [
  { id: 'fast', icon: '⚡', label: 'Fast', desc: 'Quick, short answers' },
  { id: 'balanced', icon: '⚖️', label: 'Balanced', desc: 'Normal thinking — best for most things' },
  { id: 'expert', icon: '🧠', label: 'Expert', desc: 'Plans step by step, then double-checks itself (slower)' },
];

const MAX_TEXT = 400_000;

const readAsDataURL = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
const readAsText = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });

async function shrinkImage(dataUrl, max = 1600) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  if (scale === 1 && dataUrl.length < 1_500_000) return dataUrl;
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

export default function Composer({ onSend, onStop, streaming, settings, setSettings, disabled }) {
  const [text, setText] = useState('');
  const [images, setImages] = useState([]);
  const [files, setFiles] = useState([]);
  const [listening, setListening] = useState(false);
  const [personaMenu, setPersonaMenu] = useState(null);
  const [plusMenu, setPlusMenu] = useState(null);
  const [modeMenu, setModeMenu] = useState(null);
  const mode = REASONING_MODES.find((m) => m.id === (settings.reasoning || 'balanced')) || REASONING_MODES[1];
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();
  const recRef = useRef(null);

  const addFiles = async (list) => {
    for (const f of Array.from(list)) {
      if (f.type.startsWith('image/')) {
        const url = await shrinkImage(await readAsDataURL(f));
        setImages((v) => [...v, url]);
      } else if (/\.(pdf|docx|xlsx)$/i.test(f.name)) { // binary documents: the server extracts the text
        const data = String(await readAsDataURL(f)).split(',')[1];
        const r = await fetch('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, data }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.text) setFiles((v) => [...v, { name: f.name, text: j.text.slice(0, MAX_TEXT) }]);
        else alert(`${f.name}: ${j.error || 'could not read this file'}`);
      } else {
        const t = await readAsText(f);
        setFiles((v) => [...v, { name: f.name, text: t.slice(0, MAX_TEXT) }]);
      }
    }
  };

  const submit = () => {
    if (streaming || disabled || (!text.trim() && !images.length && !files.length)) return;
    if (onSend({ text: text.trim(), images, files }) === false) return; // e.g. you cancelled the "looks like a password" warning
    setText(''); setImages([]); setFiles([]);
  };

  const toggleMic = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert('Voice input works in Chrome / Edge.');
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SR();
    rec.lang = settings.lang === 'tamil' ? 'ta-IN' : 'en-IN';
    rec.interimResults = true;
    rec.continuous = true;
    const base = text;
    rec.onresult = (e) => {
      const said = Array.from(e.results).map((r) => r[0].transcript).join('');
      setText((base ? base + ' ' : '') + said);
    };
    rec.onend = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  };

  const persona = PERSONAS.find((p) => p.id === settings.personaId) || PERSONAS[0];

  return (
    <Paper elevation={0}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
      sx={{ border: 1, borderColor: dragOver ? 'primary.main' : (t) => (t.palette.mode === 'light' ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.1)'), borderRadius: '24px', p: 1, pl: 1.25,
        bgcolor: (t) => (t.palette.mode === 'light' ? 'rgba(255,255,255,.66)' : 'rgba(24,24,38,.62)'),
        backdropFilter: 'saturate(170%) blur(22px)', WebkitBackdropFilter: 'saturate(170%) blur(22px)',
        boxShadow: '0 1px 2px rgba(20,20,60,.05), 0 12px 36px -12px rgba(40,30,120,.22)', transition: 'border-color .25s, box-shadow .25s, transform .25s',
        '&:focus-within': { borderColor: 'primary.main', boxShadow: (t) => `0 0 0 4px ${alpha(t.palette.primary.main, 0.14)}, 0 16px 44px -12px ${alpha(BRAND.indigo, 0.4)}` } }}>
      {(images.length > 0 || files.length > 0) && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1, px: 0.5 }}>
          {images.map((src, i) => (
            <Box key={i} sx={{ position: 'relative' }}>
              <Box component="img" src={src} sx={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 2, border: 1, borderColor: 'divider' }} />
              <IconButton size="small" onClick={() => setImages((v) => v.filter((_, j) => j !== i))}
                sx={{ position: 'absolute', top: -8, right: -8, bgcolor: 'background.paper', border: 1, borderColor: 'divider', p: 0.2 }}>
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          ))}
          {files.map((f, i) => (
            <Chip key={i} icon={<InsertDriveFileOutlinedIcon />} label={f.name} onDelete={() => setFiles((v) => v.filter((_, j) => j !== i))} />
          ))}
        </Box>
      )}
      <TextField fullWidth multiline maxRows={10} variant="standard"
        placeholder={disabled ? 'Pick a model first…' : 'Ask anything…'}
        value={text} onChange={(e) => setText(e.target.value)}
        onPaste={(e) => { const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/')); if (imgs.length) { e.preventDefault(); addFiles(imgs); } }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          const send = settings.enterToSend === false ? (e.ctrlKey || e.metaKey) : !e.shiftKey;
          if (send) { e.preventDefault(); submit(); }
        }}
        minRows={2} InputProps={{ disableUnderline: true, sx: { fontSize: 15.5, px: 0.75, py: 0.75, lineHeight: 1.5 } }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, flexWrap: 'wrap', rowGap: 0.75 }}>
        <input ref={fileRef} type="file" multiple hidden
          accept="image/*,.pdf,.docx,.xlsx,.txt,.md,.js,.jsx,.ts,.tsx,.json,.css,.html,.py,.java,.c,.cpp,.csv,.xml,.yml,.yaml,.sql,.env,.log"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        {/* + menu (like Claude): files, web search, style */}
        <Tooltip title="Add files, web search & more"><IconButton size="small" onClick={(e) => setPlusMenu(e.currentTarget)} sx={{ border: 1, borderColor: 'divider' }}><AddIcon fontSize="small" /></IconButton></Tooltip>
        {settings.extendedThinking && (
          <Chip size="small" label="🧠 Extended thinking" color="secondary" onDelete={() => setSettings({ ...settings, extendedThinking: false })}
            sx={{ borderRadius: '8px', fontSize: 12.5 }} />
        )}
        <Chip size="small" label={settings.quality === 'max' ? '🧠 Max quality' : '⚡ Fast'} variant={settings.quality === 'max' ? 'filled' : 'outlined'}
          color={settings.quality === 'max' ? 'secondary' : 'default'} onClick={() => setSettings({ ...settings, quality: settings.quality === 'max' ? 'fast' : 'max' })}
          sx={{ borderRadius: '8px', fontSize: 12.5 }} />
        {settings.research && (
          <Chip size="small" label="🔎 Research" color="primary" onDelete={() => setSettings({ ...settings, research: false })}
            sx={{ borderRadius: '8px', fontSize: 12.5 }} />
        )}
        {!!settings.style && settings.style !== 'normal' && (
          <Chip size="small" label={`Style: ${settings.style}`} onDelete={() => setSettings({ ...settings, style: 'normal' })}
            sx={{ borderRadius: '8px', fontSize: 12.5 }} />
        )}
        {settings.webSearch === 'on' && (
          <Chip size="small" icon={<LanguageIcon sx={{ fontSize: '15px !important' }} />} label="Search" color="primary" onDelete={() => setSettings({ ...settings, webSearch: 'auto' })}
            sx={{ borderRadius: '8px', fontSize: 12.5 }} />
        )}
        <Tooltip title={listening ? 'Stop listening' : 'Voice input'}>
          <IconButton size="small" onClick={toggleMic} color={listening ? 'error' : 'default'}>
            {listening ? <MicOffIcon fontSize="small" /> : <MicIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title={`Reasoning: ${mode.desc}`}>
          <Chip size="small" variant={mode.id === 'balanced' ? 'outlined' : 'filled'} color={mode.id === 'expert' ? 'primary' : 'default'}
            onClick={(e) => setModeMenu(e.currentTarget)} label={`${mode.icon} ${mode.label}`}
            sx={{ borderRadius: '8px', fontSize: 12.5, borderColor: 'divider' }} />
        </Tooltip>
        <Chip size="small" variant="outlined" onClick={(e) => setPersonaMenu(e.currentTarget)}
          label={`${persona.icon} ${persona.name.split(' ')[0]} · ${LANG_MODES.find((l) => l.id === settings.lang)?.label || 'Auto'}${settings.concise ? ' · Short' : ''}`}
          sx={{ maxWidth: 240, borderRadius: '8px', fontSize: 12.5, borderColor: 'divider' }} />
        <Box sx={{ flex: 1 }} />
        {streaming ? (
          <Tooltip title="Stop"><IconButton onClick={onStop} sx={{ width: 34, height: 34, bgcolor: 'text.primary', color: 'background.paper', '&:hover': { bgcolor: 'text.secondary' } }}><StopIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
        ) : (
          <IconButton onClick={submit} disabled={disabled || (!text.trim() && !images.length && !files.length)}
            sx={{ width: 34, height: 34, background: BRAND_GRADIENT, color: '#fff', transition: 'transform .15s, box-shadow .2s',
              boxShadow: `0 6px 16px -6px ${alpha(BRAND.indigo, 0.7)}`,
              '&:hover': { transform: 'translateY(-1px) scale(1.05)', boxShadow: `0 10px 22px -8px ${alpha(BRAND.indigo, 0.8)}` },
              '&.Mui-disabled': { background: 'none', bgcolor: 'action.disabledBackground', color: 'background.paper', boxShadow: 'none' } }}>
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      <Menu anchorEl={plusMenu} open={!!plusMenu} onClose={() => setPlusMenu(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        PaperProps={{ sx: { borderRadius: '14px', minWidth: 260, mt: -1 } }} MenuListProps={{ dense: true }}>
        <MenuItem onClick={() => { setPlusMenu(null); fileRef.current.click(); }} sx={{ borderRadius: '8px', mx: 0.75, py: 1 }}>
          <ListItemIcon><AttachFileIcon fontSize="small" /></ListItemIcon>
          <Box><Typography sx={{ fontSize: 14 }}>Add photos & files</Typography><Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>Images, PDFs as text, code, notes</Typography></Box>
        </MenuItem>
        <Divider sx={{ my: 0.5 }} />
        <Typography sx={{ px: 2, py: 0.5, fontSize: 11.5, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <LanguageIcon sx={{ fontSize: 15 }} /> Web search
        </Typography>
        {[['auto', 'Auto', 'Searches when your question needs fresh facts'], ['on', 'Always', 'Search the web for every message'], ['off', 'Off', 'Answer from the model only']].map(([v, l, d]) => (
          <MenuItem key={v} onClick={() => { setSettings({ ...settings, webSearch: v }); setPlusMenu(null); }} sx={{ borderRadius: '8px', mx: 0.75 }}>
            <Box sx={{ flex: 1 }}><Typography sx={{ fontSize: 14 }}>{l}</Typography><Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{d}</Typography></Box>
            {(settings.webSearch || 'auto') === v && <CheckIcon fontSize="small" sx={{ color: 'primary.main' }} />}
          </MenuItem>
        ))}
        <Divider sx={{ my: 0.5 }} />
        <Typography sx={{ px: 2, py: 0.5, fontSize: 11.5, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <BuildOutlinedIcon sx={{ fontSize: 15 }} /> Tools
        </Typography>
        <MenuItem onClick={() => setSettings({ ...settings, tools: (settings.tools || 'auto') === 'off' ? 'auto' : 'off' })} sx={{ borderRadius: '8px', mx: 0.75 }}>
          <Box sx={{ flex: 1 }}><Typography sx={{ fontSize: 14 }}>Use tools</Typography><Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>Exact calculator, dates, memory, web search</Typography></Box>
          <Switch size="small" checked={(settings.tools || 'auto') !== 'off'} />
        </MenuItem>
        <MenuItem onClick={() => setSettings({ ...settings, allowCode: !settings.allowCode })} sx={{ borderRadius: '8px', mx: 0.75 }}>
          <ListItemIcon><TerminalIcon fontSize="small" /></ListItemIcon>
          <Box sx={{ flex: 1 }}><Typography sx={{ fontSize: 14 }}>Run code</Typography><Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>AI may run JavaScript in a locked sandbox</Typography></Box>
          <Switch size="small" checked={!!settings.allowCode} />
        </MenuItem>
        <MenuItem onClick={() => setSettings({ ...settings, research: !settings.research })} sx={{ borderRadius: '8px', mx: 0.75 }}>
          <Box sx={{ flex: 1 }}><Typography sx={{ fontSize: 14 }}>🔎 Research</Typography><Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>3–5 searches → a report with sources</Typography></Box>
          <Switch size="small" checked={!!settings.research} />
        </MenuItem>
        <MenuItem onClick={() => setSettings({ ...settings, extendedThinking: !settings.extendedThinking })} sx={{ borderRadius: '8px', mx: 0.75 }}>
          <Box sx={{ flex: 1 }}><Typography sx={{ fontSize: 14 }}>🧠 Extended thinking</Typography><Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>Learn thinks before every answer (slower)</Typography></Box>
          <Switch size="small" checked={!!settings.extendedThinking} />
        </MenuItem>
        <Typography variant="caption" color="text.secondary" sx={{ px: 2, fontWeight: 600 }}>Style</Typography>
        <Box sx={{ display: 'flex', gap: 0.5, px: 1.5, py: 0.75, flexWrap: 'wrap' }}>
          {['normal', 'concise', 'explanatory', 'formal'].map((st) => (
            <Chip key={st} size="small" label={st[0].toUpperCase() + st.slice(1)} color={(settings.style || 'normal') === st ? 'primary' : 'default'}
              variant={(settings.style || 'normal') === st ? 'filled' : 'outlined'} onClick={() => setSettings({ ...settings, style: st })} />
          ))}
        </Box>
      </Menu>

      <Menu anchorEl={modeMenu} open={!!modeMenu} onClose={() => setModeMenu(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        PaperProps={{ sx: { borderRadius: '14px', minWidth: 280, mt: -1 } }} MenuListProps={{ dense: true }}>
        <Typography sx={{ px: 2, py: 0.5, fontSize: 11.5, color: 'text.secondary' }}>Reasoning mode</Typography>
        {REASONING_MODES.map((m) => (
          <MenuItem key={m.id} onClick={() => { setSettings({ ...settings, reasoning: m.id }); setModeMenu(null); }} sx={{ borderRadius: '8px', mx: 0.75, py: 0.9 }}>
            <ListItemIcon sx={{ fontSize: 18 }}>{m.icon}</ListItemIcon>
            <Box sx={{ flex: 1 }}><Typography sx={{ fontSize: 14 }}>{m.label}</Typography><Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{m.desc}</Typography></Box>
            {mode.id === m.id && <CheckIcon fontSize="small" sx={{ color: 'primary.main' }} />}
          </MenuItem>
        ))}
      </Menu>

      <Menu anchorEl={personaMenu} open={!!personaMenu} onClose={() => setPersonaMenu(null)}
        PaperProps={{ sx: { borderRadius: 3, minWidth: 260, maxHeight: 480 } }} MenuListProps={{ dense: true }}>
        <Typography variant="caption" color="text.secondary" sx={{ px: 2, fontWeight: 600 }}>Reply language</Typography>
        <Box sx={{ display: 'flex', gap: 0.5, px: 1.5, py: 0.75, flexWrap: 'wrap' }}>
          {LANG_MODES.map((l) => (
            <Chip key={l.id} size="small" label={l.label} color={settings.lang === l.id ? 'primary' : 'default'}
              variant={settings.lang === l.id ? 'filled' : 'outlined'} onClick={() => setSettings({ ...settings, lang: l.id })} />
          ))}
        </Box>
        <MenuItem onClick={() => setSettings({ ...settings, concise: !settings.concise })}>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: 14 }}>Short answers</Typography>
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>Uses fewer tokens</Typography>
          </Box>
          <Switch size="small" checked={!!settings.concise} />
        </MenuItem>
        <Divider />
        <Typography variant="caption" color="text.secondary" sx={{ px: 2, fontWeight: 600 }}>Persona</Typography>
        {PERSONAS.map((p) => (
          <MenuItem key={p.id} selected={p.id === settings.personaId} onClick={() => { setSettings({ ...settings, personaId: p.id }); setPersonaMenu(null); }}>
            <ListItemIcon sx={{ fontSize: 18 }}>{p.icon}</ListItemIcon>{p.name}
          </MenuItem>
        ))}
      </Menu>
    </Paper>
  );
}
