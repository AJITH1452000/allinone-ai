import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, ButtonBase, Dialog, IconButton, InputBase, TextField, Typography, useMediaQuery } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import AddIcon from '@mui/icons-material/Add';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import CodeIcon from '@mui/icons-material/Code';
import WebIcon from '@mui/icons-material/Web';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import { parseSpecial } from './Message';

const when = (t) => {
  if (!t) return '';
  const d = (Date.now() - t) / 864e5;
  if (d < 1) return 'Today';
  if (d < 2) return 'Yesterday';
  if (d < 7) return `${Math.floor(d)} days ago`;
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const lastAt = (c) => c.updatedAt || c.createdAt || 0;

function Shell({ open, onClose, children, width = 640, top }) {
  const full = useMediaQuery('(max-width:600px)');
  return (
    <Dialog open={open} onClose={onClose} fullWidth fullScreen={full}
      PaperProps={{ sx: { maxWidth: width, borderRadius: full ? 0 : '18px', ...(top && !full && { alignSelf: 'flex-start', mt: '12vh' }), height: full ? '100%' : undefined, maxHeight: full ? '100%' : '72vh', display: 'flex', flexDirection: 'column' } }}>
      {children}
    </Dialog>
  );
}

// ---------------- Search (Ctrl+K) ----------------
export function SearchDialog({ open, onClose, chats, onOpen, onNew }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const ref = useRef();
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => ref.current?.focus(), 50); } }, [open]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const live = chats.filter((c) => c.messages.length).sort((a, b) => lastAt(b) - lastAt(a));
    if (!s) return live.slice(0, 12).map((c) => ({ c }));
    return live.map((c) => {
      if (c.title.toLowerCase().includes(s)) return { c, score: 2 };
      const m = c.messages.find((x) => x.content?.toLowerCase().includes(s));
      if (!m) return null;
      const i = m.content.toLowerCase().indexOf(s);
      return { c, score: 1, snip: `${i > 40 ? '…' : ''}${m.content.slice(Math.max(0, i - 40), i + s.length + 70).replace(/\s+/g, ' ')}…` };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 30);
  }, [q, chats]);

  const go = (r) => { if (r) { onOpen(r.c.id); onClose(); } };
  const mark = (text) => {
    const s = q.trim(); if (!s) return text;
    const i = text.toLowerCase().indexOf(s.toLowerCase()); if (i < 0) return text;
    return <>{text.slice(0, i)}<Box component="mark" sx={{ bgcolor: 'rgba(91,76,240,.2)', color: 'inherit', borderRadius: '3px', px: 0.2 }}>{text.slice(i, i + s.length)}</Box>{text.slice(i + s.length)}</>;
  };

  return (
    <Shell open={open} onClose={onClose} top>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2.25, py: 1.75, borderBottom: 1, borderColor: 'divider' }}>
        <SearchIcon sx={{ color: 'text.secondary' }} />
        <InputBase inputRef={ref} fullWidth placeholder="Search chats…" value={q} sx={{ fontSize: 16 }}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(v + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(v - 1, 0)); }
            if (e.key === 'Enter') go(results[sel]);
          }} />
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Box>
      <Box sx={{ overflowY: 'auto', p: 1 }}>
        {!q && (
          <ButtonBase onClick={() => { onNew(); onClose(); }} sx={{ width: '100%', justifyContent: 'flex-start', gap: 1.5, px: 1.5, py: 1.1, borderRadius: '10px', '&:hover': { bgcolor: 'action.hover' } }}>
            <AddIcon sx={{ fontSize: 19 }} /><Typography sx={{ fontSize: 14.5 }}>New chat</Typography>
          </ButtonBase>
        )}
        {!q && results.length > 0 && <Typography sx={{ px: 1.5, pt: 1, pb: 0.5, fontSize: 12, color: 'text.secondary' }}>Recent chats</Typography>}
        {results.map((r, i) => (
          <ButtonBase key={r.c.id} onClick={() => go(r)} onMouseEnter={() => setSel(i)} sx={{
            width: '100%', justifyContent: 'flex-start', alignItems: 'flex-start', gap: 1.5, px: 1.5, py: 1.1, borderRadius: '10px', textAlign: 'left',
            bgcolor: i === sel ? 'action.hover' : 'transparent',
          }}>
            <ChatBubbleOutlineIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.25 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: 14.5 }}>{mark(r.c.title)}</Typography>
              {r.snip && <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{mark(r.snip)}</Typography>}
            </Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', flexShrink: 0 }}>{when(lastAt(r.c))}</Typography>
          </ButtonBase>
        ))}
        {q && !results.length && <Typography sx={{ p: 3, textAlign: 'center', color: 'text.secondary', fontSize: 14 }}>No chats found for "{q}"</Typography>}
      </Box>
    </Shell>
  );
}

// ---------------- Projects ----------------
export function ProjectsDialog({ open, onClose, projects, chats, onOpen, onCreate }) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(null);
  useEffect(() => { if (open) { setQ(''); setCreating(null); } }, [open]);
  const list = projects.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  const stats = (pid) => {
    const cs = chats.filter((c) => c.projectId === pid && !c.archived);
    return { n: cs.length, last: Math.max(0, ...cs.map(lastAt)) };
  };
  return (
    <Shell open={open} onClose={onClose} width={860}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3, pt: 2.5, pb: 1.5 }}>
        <Typography sx={{ flex: 1, fontSize: 22, fontWeight: 600, fontFamily: '"Source Serif 4", Georgia, serif' }}>Projects</Typography>
        <Button variant="contained" disableElevation startIcon={<AddIcon />} onClick={() => setCreating('')} sx={{ borderRadius: '10px' }}>New project</Button>
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Box>
      <Box sx={{ px: 3, pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.9, borderRadius: '12px', border: 1, borderColor: 'divider' }}>
          <SearchIcon sx={{ fontSize: 19, color: 'text.secondary' }} />
          <InputBase fullWidth placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} sx={{ fontSize: 14.5 }} />
        </Box>
      </Box>
      <Box sx={{ overflowY: 'auto', px: 3, pb: 3 }}>
        {creating !== null && (
          <Box component="form" onSubmit={(e) => { e.preventDefault(); if (creating.trim()) { onCreate(creating.trim()); onClose(); } }}
            sx={{ display: 'flex', gap: 1, p: 2, mb: 1.5, borderRadius: '14px', border: 1, borderColor: 'primary.main' }}>
            <TextField autoFocus size="small" fullWidth placeholder="Project name, e.g. TNPSC prep, Office website" value={creating} onChange={(e) => setCreating(e.target.value)} />
            <Button type="submit" variant="contained" disableElevation disabled={!creating.trim()}>Create</Button>
            <Button color="inherit" onClick={() => setCreating(null)}>Cancel</Button>
          </Box>
        )}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
          {list.map((p) => {
            const s = stats(p.id);
            return (
              <ButtonBase key={p.id} onClick={() => { onOpen(p.id); onClose(); }} sx={{
                display: 'block', textAlign: 'left', p: 2, borderRadius: '14px', border: 1, borderColor: 'divider', '&:hover': { borderColor: 'text.secondary', bgcolor: 'action.hover' },
              }}>
                <FolderOutlinedIcon sx={{ color: 'primary.main', mb: 1 }} />
                <Typography noWrap sx={{ fontSize: 15.5, fontWeight: 600 }}>{p.name}</Typography>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>
                  {s.n} chat{s.n === 1 ? '' : 's'}{s.last ? ` · Updated ${when(s.last).toLowerCase()}` : ` · Created ${when(p.createdAt).toLowerCase()}`}
                </Typography>
              </ButtonBase>
            );
          })}
        </Box>
        {!projects.length && creating === null && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <FolderOutlinedIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
            <Typography sx={{ fontWeight: 600, mt: 1 }}>No projects yet</Typography>
            <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.5 }}>Group related chats — e.g. "TNPSC prep" or "Office website". Use a chat's ⋯ → Add to project.</Typography>
          </Box>
        )}
      </Box>
    </Shell>
  );
}

// ---------------- Artifacts ----------------
const CODE_LANGS = ['html', 'svg', 'xml', 'react', 'jsx', 'tsx', 'mermaid'];
export function collectArtifacts(chats) {
  const out = [];
  for (const c of chats) {
    for (const m of c.messages) {
      if (m.role !== 'assistant' || !m.content) continue;
      const text = parseSpecial(m.content).text; // <artifact> tags become ```lang--Title fences
      for (const [, raw, code] of text.matchAll(/```([\w-]+)\n([\s\S]*?)```/g)) {
        const [lang, t] = raw.split('--');
        if (!CODE_LANGS.includes(lang) || code.trim().split('\n').length < 5) continue;
        const title = t?.replace(/_/g, ' ').trim()
          || /<title>([^<]+)<\/title>/i.exec(code)?.[1]
          || /(?:function|const)\s+([A-Z]\w+)/.exec(code)?.[1]
          || `${lang.toUpperCase()} from "${c.title.slice(0, 30)}"`;
        out.push({ id: `${m.id}:${out.length}`, title, lang, code, chatId: c.id, chatTitle: c.title, at: lastAt(c) });
      }
    }
  }
  return out.sort((a, b) => b.at - a.at);
}
const TYPE = { html: ['Web page', WebIcon], xml: ['Web page', WebIcon], react: ['React app', CodeIcon], jsx: ['React app', CodeIcon], tsx: ['React app', CodeIcon], mermaid: ['Diagram', AccountTreeOutlinedIcon], svg: ['Graphic', ImageOutlinedIcon] };

export function ArtifactsDialog({ open, onClose, chats, onOpen }) {
  const [q, setQ] = useState('');
  const all = useMemo(() => (open ? collectArtifacts(chats) : []), [open, chats]);
  const list = all.filter((a) => `${a.title} ${a.chatTitle}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Shell open={open} onClose={onClose} width={860}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 3, pt: 2.5, pb: 1.5 }}>
        <Typography sx={{ flex: 1, fontSize: 22, fontWeight: 600, fontFamily: '"Source Serif 4", Georgia, serif' }}>Artifacts</Typography>
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Box>
      <Box sx={{ px: 3, pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.9, borderRadius: '12px', border: 1, borderColor: 'divider' }}>
          <SearchIcon sx={{ fontSize: 19, color: 'text.secondary' }} />
          <InputBase fullWidth placeholder="Search artifacts…" value={q} onChange={(e) => setQ(e.target.value)} sx={{ fontSize: 14.5 }} />
        </Box>
      </Box>
      <Box sx={{ overflowY: 'auto', px: 3, pb: 3 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 1.5 }}>
          {list.map((a) => {
            const [label, Icon] = TYPE[a.lang] || ['Code', CodeIcon];
            return (
              <ButtonBase key={a.id} onClick={() => { onOpen(a); onClose(); }} sx={{
                display: 'block', textAlign: 'left', borderRadius: '14px', border: 1, borderColor: 'divider', overflow: 'hidden', '&:hover': { borderColor: 'text.secondary' },
              }}>
                <Box sx={{ height: 96, bgcolor: '#1e1e22', color: '#9a9aa5', p: 1.25, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 10, lineHeight: 1.45, overflow: 'hidden', whiteSpace: 'pre' }}>
                  {a.code.split('\n').slice(0, 8).join('\n')}
                </Box>
                <Box sx={{ p: 1.5 }}>
                  <Typography noWrap sx={{ fontSize: 14, fontWeight: 600 }}>{a.title}</Typography>
                  <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
                    <Icon sx={{ fontSize: 14 }} /> {label} · {a.chatTitle}
                  </Typography>
                </Box>
              </ButtonBase>
            );
          })}
        </Box>
        {!list.length && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <WebIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
            <Typography sx={{ fontWeight: 600, mt: 1 }}>{all.length ? 'No matching artifacts' : 'No artifacts yet'}</Typography>
            <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.5 }}>Ask for a web page, React component, diagram or SVG — every one you create is collected here.</Typography>
          </Box>
        )}
      </Box>
    </Shell>
  );
}
