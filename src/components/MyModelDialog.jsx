import { useEffect, useRef, useState } from 'react';
import {
  Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, Slider, TextField, Tooltip, Typography,
} from '@mui/material';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { uid } from '../lib/storage';
import { kbList, kbUpload, kbDelete, kbDeleteAll, kbAddText } from '../lib/api';

const ACCEPT = '.pdf,.docx,.xlsx,.txt,.md,.csv,.json,.html,.htm,.xml,.yml,.yaml,.log,.sql,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.php,.css';

/** Upload area + list of files this model knows. Files live on this PC in data/kb/. */
function DataSection({ modelId }) {
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState('');
  const [errs, setErrs] = useState([]);
  const [drag, setDrag] = useState(false);
  const [paste, setPaste] = useState(null);
  const input = useRef();
  const refresh = () => kbList(modelId).then(setDocs);
  useEffect(() => { refresh(); }, [modelId]); // eslint-disable-line

  const upload = async (files) => {
    const errors = [];
    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      setBusy(`Reading ${list[i].name} (${i + 1}/${list.length})…`);
      try { await kbUpload(modelId, list[i]); } catch (e) { errors.push(e.message); }
    }
    setErrs(errors); setBusy(''); refresh();
  };

  const total = docs.reduce((n, d) => n + d.chars, 0);
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Your data — files this model learns from</Typography>
      <Box onClick={() => !busy && input.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
        sx={{ border: 2, borderStyle: 'dashed', borderColor: drag ? 'primary.main' : 'divider', borderRadius: 3, p: 2, textAlign: 'center',
          cursor: 'pointer', bgcolor: drag ? 'action.hover' : 'transparent', transition: '.15s', '&:hover': { borderColor: 'primary.main' } }}>
        <CloudUploadOutlinedIcon sx={{ color: 'text.secondary' }} />
        <Typography sx={{ fontSize: 13.5, fontWeight: 500 }}>Drop files or click to upload</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>PDF, Word, TXT, Markdown, CSV, JSON, HTML, code — many files at once</Typography>
        <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button size="small" onClick={() => setPaste(paste ? null : { name: '', text: '' })} sx={{ fontSize: 12.5 }}>
          {paste ? 'Cancel' : '+ Paste text instead'}
        </Button>
      </Box>
      {paste && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1 }}>
          <TextField size="small" label="Title" value={paste.name} onChange={(e) => setPaste({ ...paste, name: e.target.value })} />
          <TextField multiline minRows={3} maxRows={8} size="small" label="Text" value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} />
          <Button variant="outlined" size="small" disabled={!paste.text.trim() || !!busy} onClick={async () => {
            setBusy('Saving…');
            try { await kbAddText(modelId, `${(paste.name || 'Notes').trim()}.txt`, paste.text); setPaste(null); }
            catch (e) { setErrs([e.message]); }
            setBusy(''); refresh();
          }}>Add text</Button>
        </Box>
      )}
      {busy && <Box sx={{ my: 1 }}><Typography sx={{ fontSize: 12.5, mb: 0.5 }}>{busy}</Typography><LinearProgress /></Box>}
      {errs.map((e) => <Typography key={e} sx={{ fontSize: 12.5, color: 'error.main' }}>{e}</Typography>)}
      {docs.length > 0 && (
        <Box sx={{ mt: 1, border: 1, borderColor: 'divider', borderRadius: 2, maxHeight: 200, overflowY: 'auto' }}>
          {docs.map((d) => (
            <Box key={d.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.5, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'divider' } }}>
              <InsertDriveFileOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: 13 }}>{d.name}</Typography>
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                  {(d.chars / 1000).toFixed(1)}k chars · {d.chunks} parts · {d.semantic ? 'smart search' : 'keyword search'}
                </Typography>
              </Box>
              <Tooltip title="Remove"><IconButton size="small" onClick={async () => { await kbDelete(modelId, d.id); refresh(); }}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
            </Box>
          ))}
        </Box>
      )}
      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.75 }}>
        {docs.length ? `${docs.length} file(s) · ${(total / 1000).toFixed(0)}k chars. ` : ''}
        Stored only on this PC. For each question, only the ~5 most relevant parts are sent to the AI, so big data still uses few tokens.
      </Typography>
    </Box>
  );
}

const ICONS = ['🤖', '🧠', '⚛️', '💻', '📚', '🎓', '✍️', '🌐', '💼', '🩺', '⚖️', '🎨', '📈', '🍳', '🕉️', '🚀'];

const TEMPLATES = [
  { name: 'Tamil Code Mentor', icon: '💻', instructions: 'You are a friendly coding mentor. Explain in simple Tanglish, then give clean, complete code. Point out common mistakes.' },
  { name: 'Interview Prep', icon: '💼', instructions: 'You run mock technical interviews. Ask one question at a time, wait for my answer, then score it out of 10 with short feedback.' },
  { name: 'Study Notes Maker', icon: '📚', instructions: 'Turn any topic or text I give into short exam notes: key points as bullets, one example, and 3 quick quiz questions at the end.' },
];

/** Build / edit a "My model": a named assistant = base model + your own instructions + settings. */
export default function MyModelDialog({ open, onClose, onSave, onDelete, models, initial }) {
  const blank = { name: '', icon: '🤖', instructions: '', base: null, temperature: 0.7, knowledge: '' };
  const [m, setM] = useState(blank);
  // A new model gets its id right away, so files can be uploaded before pressing Create
  useEffect(() => { if (open) setM(initial ? { ...blank, ...initial } : { ...blank, id: `my_${uid()}` }); }, [open]); // eslint-disable-line
  const cancel = () => { if (!initial && m.id) kbDeleteAll(m.id); onClose(); };
  const set = (k, v) => setM((s) => ({ ...s, [k]: v }));
  const base = models.find((x) => m.base && x.provider === m.base.provider && x.id === m.base.id) || null;
  const valid = m.name.trim() && m.instructions.trim() && m.base;

  return (
    <Dialog open={open} onClose={cancel} fullWidth maxWidth="sm" PaperProps={{ sx: { borderRadius: 4 } }}>
      <DialogTitle sx={{ fontWeight: 700, pb: 0.5 }}>{initial ? 'Edit my model' : 'Create my model'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        {!initial && (
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mr: 0.5 }}>Start from:</Typography>
            {TEMPLATES.map((t) => (
              <Button key={t.name} size="small" variant="outlined" color="inherit" onClick={() => setM((s) => ({ ...s, ...t }))}
                sx={{ borderColor: 'divider', borderRadius: 5, fontSize: 12.5, py: 0.25 }}>{t.icon} {t.name}</Button>
            ))}
          </Box>
        )}
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField select SelectProps={{ native: true }} size="small" label="Icon" value={m.icon} onChange={(e) => set('icon', e.target.value)} sx={{ width: 84 }}>
            {ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
          </TextField>
          <TextField size="small" fullWidth label="Name" placeholder="e.g. My React Helper" value={m.name}
            onChange={(e) => set('name', e.target.value.slice(0, 40))} />
        </Box>
        <Autocomplete size="small" options={models} value={base} groupBy={(o) => o.providerName}
          getOptionLabel={(o) => o.id} isOptionEqualToValue={(a, b) => a.provider === b.provider && a.id === b.id}
          onChange={(_, v) => set('base', v ? { provider: v.provider, id: v.id } : null)}
          renderInput={(p) => <TextField {...p} label="Base model (the brain)" helperText="Your model runs on top of this one." />} />
        <TextField multiline minRows={4} maxRows={10} label="Instructions — how should it behave?" value={m.instructions}
          onChange={(e) => set('instructions', e.target.value)}
          placeholder="You are … Always … Never … Reply in …" />
        {m.id && <DataSection modelId={m.id} />}
        <TextField multiline minRows={2} maxRows={6} label="Always-known facts (optional)" value={m.knowledge}
          onChange={(e) => set('knowledge', e.target.value.slice(0, 4000))}
          helperText={`A few lines sent with every message (name, rules, key facts). Put big data in files above instead. (${m.knowledge.length}/4000 ≈ ${Math.ceil(m.knowledge.length / 4)} tokens)`} />
        <Box>
          <Typography variant="subtitle2">Creativity: {m.temperature}</Typography>
          <Slider min={0} max={1.5} step={0.1} value={m.temperature} onChange={(_, v) => set('temperature', v)}
            marks={[{ value: 0, label: 'Precise' }, { value: 0.7, label: 'Balanced' }, { value: 1.5, label: 'Creative' }]} />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {initial && <Button color="error" onClick={() => { if (confirm(`Delete "${initial.name}"?`)) { onDelete(initial.id); onClose(); } }}>Delete</Button>}
        <Box sx={{ flex: 1 }} />
        <Button onClick={cancel} color="inherit">Cancel</Button>
        <Button variant="contained" disableElevation disabled={!valid}
          onClick={() => { onSave({ ...m, id: m.id || `my_${uid()}`, name: m.name.trim() }); onClose(); }}>
          {initial ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
