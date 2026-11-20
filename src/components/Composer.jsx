import { useRef, useState } from 'react';
import { Box, Paper, TextField, IconButton, Tooltip, Chip, Menu, MenuItem, ListItemIcon, Typography, Switch, Divider, alpha } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import StopIcon from '@mui/icons-material/Stop';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import CloseIcon from '@mui/icons-material/Close';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { PERSONAS, LANG_MODES } from '../lib/personas';
import LanguageIcon from '@mui/icons-material/Language';

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
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();
  const recRef = useRef(null);

  const addFiles = async (list) => {
    for (const f of Array.from(list)) {
      if (f.type.startsWith('image/')) {
        const url = await shrinkImage(await readAsDataURL(f));
        setImages((v) => [...v, url]);
      } else {
        const t = await readAsText(f);
        setFiles((v) => [...v, { name: f.name, text: t.slice(0, MAX_TEXT) }]);
      }
    }
  };

  const submit = () => {
    if (streaming || disabled || (!text.trim() && !images.length && !files.length)) return;
    onSend({ text: text.trim(), images, files });
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
      sx={{ border: 1, borderColor: dragOver ? 'primary.main' : 'divider', borderRadius: '24px', p: 1, pl: 1.25, bgcolor: 'background.paper',
        boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 8px 28px -10px rgba(0,0,0,.14)', transition: 'border-color .2s, box-shadow .2s',
        '&:focus-within': { borderColor: 'primary.main', boxShadow: (t) => `0 0 0 3px ${alpha(t.palette.primary.main, 0.12)}, 0 8px 28px -10px rgba(0,0,0,.14)` } }}>
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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
        <input ref={fileRef} type="file" multiple hidden
          accept="image/*,.txt,.md,.js,.jsx,.ts,.tsx,.json,.css,.html,.py,.java,.c,.cpp,.csv,.xml,.yml,.yaml,.sql,.env,.log"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <Tooltip title="Attach images or code/text files"><IconButton size="small" onClick={() => fileRef.current.click()}><AttachFileIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title={{ auto: 'Web search: Auto — searches when your question needs fresh facts (click to change)', on: 'Web search: ON for every message', off: 'Web search: OFF' }[settings.webSearch || 'auto']}>
          <Chip size="small" icon={<LanguageIcon sx={{ fontSize: '16px !important' }} />} label={{ auto: 'Auto', on: 'Search', off: 'Off' }[settings.webSearch || 'auto']}
            onClick={() => setSettings({ ...settings, webSearch: { auto: 'on', on: 'off', off: 'auto' }[settings.webSearch || 'auto'] })}
            color={settings.webSearch === 'on' ? 'primary' : 'default'} variant={settings.webSearch === 'on' ? 'filled' : 'outlined'}
            sx={{ borderRadius: '8px', fontSize: 12.5, borderColor: 'divider', opacity: settings.webSearch === 'off' ? 0.6 : 1 }} />
        </Tooltip>
        <Tooltip title={listening ? 'Stop listening' : 'Voice input'}>
          <IconButton size="small" onClick={toggleMic} color={listening ? 'error' : 'default'}>
            {listening ? <MicOffIcon fontSize="small" /> : <MicIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Chip size="small" variant="outlined" onClick={(e) => setPersonaMenu(e.currentTarget)}
          label={`${persona.icon} ${persona.name.split(' ')[0]} · ${LANG_MODES.find((l) => l.id === settings.lang)?.label || 'Auto'}${settings.concise ? ' · Short' : ''}`}
          sx={{ maxWidth: 240, borderRadius: '8px', fontSize: 12.5, borderColor: 'divider' }} />
        <Box sx={{ flex: 1 }} />
        {streaming ? (
          <Tooltip title="Stop"><IconButton onClick={onStop} sx={{ width: 34, height: 34, bgcolor: 'text.primary', color: 'background.paper', '&:hover': { bgcolor: 'text.secondary' } }}><StopIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
        ) : (
          <IconButton onClick={submit} disabled={disabled || (!text.trim() && !images.length && !files.length)}
            sx={{ width: 34, height: 34, bgcolor: 'text.primary', color: 'background.paper', transition: '.15s',
              '&:hover': { bgcolor: 'primary.main', color: '#fff' }, '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'background.paper' } }}>
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

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
