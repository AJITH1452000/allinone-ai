import { memo, useState } from 'react';
import { Box, Paper, IconButton, Tooltip, TextField, Button, ButtonBase, Collapse, Typography, Chip, useTheme, alpha } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { downloadZip } from '../lib/zip';
import { mergeFiles, repairProject } from '../lib/project';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import PsychologyIcon from '@mui/icons-material/Psychology';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import LanguageIcon from '@mui/icons-material/Language';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownOutlinedIcon from '@mui/icons-material/ThumbDownOutlined';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import KnowledgeCard, { WaitingNote } from './KnowledgeCard';
import { speak, stopSpeaking } from '../lib/speech';
import { LogoMark } from './Logo';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';

// Models write maths as \( … \) and \[ … \] — turn those into $$ … $$ for KaTeX.
// A single $ is NOT treated as maths, so prices like "$10 and $20" stay as normal text.
const mathify = (t = '') => t
  .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
  .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$$${m.trim()}$$`);
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

const PREVIEWABLE = ['html', 'svg', 'xml', 'react', 'jsx', 'tsx', 'mermaid'];

// Safety: code that can destroy data, take over a PC or leak secrets gets a visible warning
const DANGER = [
  [/\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\*|\$HOME)(\s|$)/i, 'deletes files recursively'],
  [/\b(format|diskpart)\s+[a-z]:|\bmkfs(\.\w+)?\b|\bdd\s+if=.*of=\/dev\//i, 'formats or overwrites a disk'],
  [/\bdel\s+\/[sfq]|\brd\s+\/s|\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force/i, 'force-deletes folders'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'is a fork bomb (freezes the PC)'],
  [/(curl|wget|iwr|Invoke-WebRequest)[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b|\biex\s*\(\s*(New-Object|iwr|Invoke-WebRequest)/i, 'downloads and runs a script from the internet'],
  [/\bchmod\s+(-R\s+)?777\s+\//i, 'makes system files writable by everyone'],
  [/\b(reg\s+delete\s+HK|Set-MpPreference\s+-Disable|netsh\s+advfirewall\s+set\s+\w+\s+state\s+off)/i, 'weakens Windows security settings'],
  [/\b(xmrig|minerd|cryptonight|coinhive)\b/i, 'looks like a crypto miner'],
  [/\beval\s*\(\s*(atob|base64_decode|Buffer\.from)/i, 'runs hidden (encoded) code'],
];
const dangerOf = (code) => DANGER.filter(([re]) => re.test(code)).map(([, why]) => why);

const TOOL_LABEL = { calculator: '🧮 Calculator', get_datetime: '📅 Date & time', date_diff: '📆 Day counter', run_javascript: '▶️ Ran code', web_search: '🔎 Web search', save_memory: '🧠 Saved to memory' };
function ToolSteps({ tools }) {
  const [open, setOpen] = useState(false);
  if (!tools?.length) return null;
  const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  return (
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {tools.map((t) => (
          <Chip key={t.id} size="small" onClick={() => setOpen((v) => !v)}
            label={`${TOOL_LABEL[t.name] || `🔧 ${t.name}`}${t.status === 'running' ? ' …' : t.result?.error ? ' ⚠️' : ''}`}
            sx={{ height: 24, fontSize: 12, bgcolor: 'action.hover', ...(t.status === 'running' && { animation: 'pulse 1s ease-in-out infinite', '@keyframes pulse': { '50%': { opacity: 0.5 } } }) }} />
        ))}
        <Typography component="span" onClick={() => setOpen((v) => !v)} sx={{ fontSize: 11.5, color: 'text.secondary', cursor: 'pointer', ml: 0.5 }}>{open ? 'hide details' : 'details'}</Typography>
      </Box>
      <Collapse in={open}>
        <Box sx={{ mt: 1, p: 1.25, borderRadius: '10px', bgcolor: 'background.soft', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 280, overflowY: 'auto' }}>
          {tools.map((t) => (
            <Box key={t.id} sx={{ mb: 1 }}>
              <b>{t.name}</b>({t.args?.code ? '…' : show(t.args)}){t.args?.code && <Box component="pre" sx={{ m: 0, mt: 0.5, opacity: 0.85 }}>{t.args.code}</Box>}
              {t.result && <Box sx={{ color: t.result.error ? 'error.main' : 'success.main' }}>→ {show(t.result.error ? t.result.error : t.result.output ?? t.result.result ?? t.result)}</Box>}
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

// Project mode work log (like Claude): Planning → Writing files → Building & running → Fixing → Verified
function BuildSteps({ steps }) {
  const [open, setOpen] = useState(null);
  if (!steps?.length) return null;
  return (
    <Box sx={{ mb: 1.25, borderRadius: '14px', border: 1, borderColor: 'divider', overflow: 'hidden', bgcolor: (t) => alpha(t.palette.background.paper, 0.6), backdropFilter: 'blur(10px)' }}>
      {steps.map((s, i) => (
        <Box key={s.id} sx={{ borderTop: i ? 1 : 0, borderColor: 'divider' }}>
          <ButtonBase disabled={!s.detail} onClick={() => setOpen(open === s.id ? null : s.id)}
            sx={{ width: '100%', justifyContent: 'flex-start', gap: 1.25, px: 1.5, py: 0.9, fontSize: 13.5, textAlign: 'left' }}>
            <Box component="span" sx={{ width: 18, display: 'grid', placeItems: 'center', flexShrink: 0,
              color: s.status === 'done' ? 'success.main' : s.status === 'error' ? 'error.main' : 'primary.main',
              ...(s.status === 'running' && { animation: 'pulse 1s ease-in-out infinite', '@keyframes pulse': { '50%': { opacity: 0.35 } } }) }}>
              {s.status === 'done' ? '✓' : s.status === 'error' ? '✕' : '●'}
            </Box>
            <Box component="span" sx={{ flex: 1, color: s.status === 'running' ? 'text.primary' : 'text.secondary' }}>{s.label}{s.status === 'running' ? '…' : ''}</Box>
            {s.detail && <ExpandMoreIcon sx={{ fontSize: 18, color: 'text.secondary', transform: open === s.id ? 'rotate(180deg)' : 'none', transition: '.2s' }} />}
          </ButtonBase>
          {s.detail && (
            <Collapse in={open === s.id}>
              <Box component="pre" sx={{ m: 0, px: 1.5, pb: 1.25, pl: 5, fontSize: 12, color: 'error.main', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, Consolas, monospace' }}>{s.detail}</Box>
            </Collapse>
          )}
        </Box>
      ))}
    </Box>
  );
}

function VerifyBadge({ v }) {
  const [open, setOpen] = useState(false);
  if (!v || v.status === 'skipped') return null;
  if (v.status === 'checking') return <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.5 }}>🔎 Expert mode: double-checking the answer…</Typography>;
  if (v.status === 'ok') return <Chip size="small" label={`✓ ${v.label || 'Self-checked — no errors found'}`} sx={{ mt: 0.5, height: 24, fontSize: 12, color: 'success.main', bgcolor: (t) => alpha(t.palette.success.main, 0.1) }} />;
  return (
    <Box sx={{ mt: 1, p: 1.25, borderRadius: '10px', border: 1, borderColor: (t) => alpha(t.palette.warning.main, 0.5), bgcolor: (t) => alpha(t.palette.warning.main, 0.08) }}>
      <Typography onClick={() => setOpen((x) => !x)} sx={{ fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>⚠️ Self-check found possible mistakes {open ? '▴' : '▾'}</Typography>
      <Collapse in={open}><Typography sx={{ fontSize: 13.5, whiteSpace: 'pre-wrap', mt: 0.75 }}>{v.text}</Typography></Collapse>
    </Box>
  );
}

function CopyBtn({ text, size = 'small', color }) {
  const [ok, setOk] = useState(false);
  return (
    <Tooltip title={ok ? 'Copied' : 'Copy'}>
      <IconButton size={size} sx={{ color }} onClick={() => {
        navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500);
      }}>
        {ok ? <CheckIcon fontSize="inherit" /> : <ContentCopyIcon fontSize="inherit" />}
      </IconButton>
    </Tooltip>
  );
}

// <artifact type="..."> → language used for highlighting + preview
const ARTIFACT_LANG = { 'text/html': 'html', 'image/svg+xml': 'svg', 'application/mermaid': 'mermaid', 'application/react': 'react' };

/**
 * Turns the model's special tags into normal markdown:
 *  <thinking>…</thinking>  → pulled out and shown as a collapsible "Thought process"
 *  <artifact …>code</artifact> → a fenced code block with a title and a Preview button
 * Works while streaming too (unclosed tags are handled).
 */
export function parseSpecial(content = '') {
  let thought = '';
  // Project mode: <file path="src/App.jsx">…</file> blocks → a project (file tree + live preview + ZIP). Unclosed = still streaming.
  const files = [];
  content = content.replace(/<file\s+path=["']([^"']+)["']\s*>\n?([\s\S]*?)(<\/file>|$)/gi, (_, p, body, close) => {
    files.push({ path: p.trim().replace(/^\.?\//, ''), content: body.replace(/^\s*```[\w-]*\n/, '').replace(/\n?```\s*$/, '').replace(/\s+$/, '') + '\n', done: !!close });
    return '';
  });
  let text = content.replace(/<thinking>([\s\S]*?)(<\/thinking>|$)/gi, (_, t) => { thought += t.trim() + '\n'; return ''; })
    .replace(/<\/?search_results>/gi, ''); // a model imitating the app's search tag (the server warns about it)
  // (?<!`) = skip a tag that is only *mentioned* in `backticks` inside a sentence
  text = text.replace(/(?<!`)<artifact\b([^>]*)>([\s\S]*?)(<\/artifact>|$)/gi, (whole, attrs, code) => {
    const type = /type="([^"]+)"/.exec(attrs)?.[1] || 'text/html';
    let title = /title="([^"]+)"/.exec(attrs)?.[1] || 'Artifact';
    if (/^[.…\s]*$/.test(title)) title = /<title>([^<]+)<\/title>/i.exec(code)?.[1] || 'Web page'; // model left "…" as the title
    if (!code.trim() && !/<\/artifact>/i.test(whole)) return ''; // still streaming the opening tag
    const lang = ARTIFACT_LANG[type] || 'html';
    const body = code.replace(/^\s*```[\w-]*\n?/, '').replace(/\n?```\s*$/, '').trim();
    return `\n\n\`\`\`${lang}--${title.replace(/[^\w]+/g, '_')}\n${body}\n\`\`\`\n\n`;
  });
  return { thought: thought.trim(), text: text.trim(), files };
}

const LANG_OF = { js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', json: 'json', css: 'css', html: 'markup', md: 'markdown' };
function ProjectCard({ files: own, baseFiles = [], working, onPreview }) {
  // A fix reply only has the changed files → combine with the earlier project; then auto-repair missing icon imports
  const files = repairProject(mergeFiles(baseFiles, own));
  const fromEarlier = files.filter((f) => !own.some((o) => o.path === f.path)).length;
  const repaired = files.flatMap((f) => f.repaired || []);
  const [open, setOpen] = useState(null);
  const pkg = files.find((f) => f.path === 'package.json');
  let name = 'react-vite-project';
  try { name = JSON.parse(pkg?.content || '{}').name || name; } catch {}
  const folder = name.replace(/[^\w.-]+/g, '-');
  const complete = !working && files.every((f) => f.done);
  return (
    <Box sx={{ my: 1.5, borderRadius: '16px', border: 1, borderColor: 'divider', overflow: 'hidden', bgcolor: (t) => alpha(t.palette.background.paper, 0.7), backdropFilter: 'blur(12px)' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.75, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
        <Typography sx={{ fontSize: 20 }}>📦</Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 650, fontSize: 14.5 }}>{name}</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            React + Vite project · {files.length} file{files.length > 1 ? 's' : ''}{fromEarlier ? ` (${own.length} updated)` : ''}{working ? ' · writing…' : ''}{repaired.length ? ` · auto-fixed ${repaired.length} issue${repaired.length > 1 ? 's' : ''}` : ''}
          </Typography>
        </Box>
        <Button size="small" variant="outlined" startIcon={<PlayArrowIcon />} disabled={!complete}
          onClick={() => onPreview(null, 'project', name, files)}>Preview</Button>
        <Button size="small" variant="contained" disableElevation startIcon={<DownloadIcon />} disabled={!complete}
          onClick={() => downloadZip(files, folder)}>ZIP</Button>
      </Box>
      {files.map((f, i) => (
        <Box key={f.path} sx={{ borderBottom: i < files.length - 1 ? 1 : 0, borderColor: 'divider' }}>
          <ButtonBase onClick={() => setOpen(open === f.path ? null : f.path)}
            sx={{ width: '100%', justifyContent: 'flex-start', gap: 1, px: 1.75, py: 0.75, fontSize: 13, fontFamily: 'ui-monospace, Consolas, monospace', '&:hover': { bgcolor: 'action.hover' } }}>
            <Box component="span" sx={{ color: f.done ? 'success.main' : 'warning.main', width: 14 }}>{f.done ? '✓' : '…'}</Box>
            <Box component="span" sx={{ flex: 1, textAlign: 'left' }}>{f.path}</Box>
            <Box component="span" sx={{ color: 'text.secondary', fontSize: 11.5 }}>{f.content.split('\n').length} lines</Box>
            <ExpandMoreIcon sx={{ fontSize: 18, color: 'text.secondary', transform: open === f.path ? 'rotate(180deg)' : 'none', transition: '.2s' }} />
          </ButtonBase>
          <Collapse in={open === f.path} unmountOnExit>
            <Box sx={{ position: 'relative' }}>
              <Box sx={{ position: 'absolute', right: 6, top: 4, zIndex: 1 }}><CopyBtn text={f.content} color="#bbb" /></Box>
              <SyntaxHighlighter language={LANG_OF[f.path.split('.').pop()] || 'text'} style={oneDark}
                customStyle={{ margin: 0, borderRadius: 0, fontSize: 12.5, maxHeight: 420, background: '#1e1e22', padding: '12px 16px' }}>{f.content}</SyntaxHighlighter>
            </Box>
          </Collapse>
        </Box>
      ))}
      {complete && <Typography sx={{ px: 1.75, py: 1, fontSize: 12, color: 'text.secondary', borderTop: 1, borderColor: 'divider' }}>
        Run it: unzip → <code>npm install</code> → <code>npm run dev</code></Typography>}
    </Box>
  );
}

const HL_LANG = { react: 'jsx', mermaid: 'text', svg: 'markup', html: 'markup' };

// allowed = links that really came from web search (null = no search → don't filter)
const norm = (u = '') => { try { return decodeURI(u).replace(/[/#?]+$/, '').toLowerCase(); } catch { return u.toLowerCase(); } };
const makeComponents = (onPreview, allowed) => ({
  pre: ({ children }) => <>{children}</>,
  code({ className, children }) {
    const code = String(children).replace(/\n$/, '');
    const raw = /language-([\w-]+)/.exec(className || '')?.[1];
    const [lang, titleRaw] = (raw || '').split('--');
    const title = titleRaw?.replace(/_/g, ' ').trim();
    if (!raw && !code.includes('\n')) {
      return <Box component="code" sx={{ bgcolor: 'background.soft', px: 0.6, py: 0.2, borderRadius: 1, fontSize: '0.88em', fontFamily: 'monospace' }}>{children}</Box>;
    }
    const danger = dangerOf(code);
    return (
      <Box sx={{ my: 1.5, borderRadius: 3, overflow: 'hidden', border: danger.length ? '1px solid #b45309' : '1px solid #26262b', bgcolor: '#1e1e22' }}>
        {danger.length > 0 && (
          <Box sx={{ px: 1.5, py: 0.75, bgcolor: '#451a03', color: '#fde68a', fontSize: 12.5, fontFamily: 'Inter' }}>
            ⚠️ Careful — this code {danger.join(', ')}. Read it fully before running it.
          </Box>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: '#26262b', color: '#a9a9b3', px: 1.5, py: 0.25, fontSize: 12, fontFamily: 'Inter', gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title ? <><b style={{ color: '#e6e6ea' }}>{title}</b> · {lang}</> : (lang || 'code')}
          </Box>
          {PREVIEWABLE.includes(lang) && (
            <Button size="small" startIcon={<PlayArrowIcon />} sx={{ color: '#bbb', fontSize: 12, flexShrink: 0 }} onClick={() => onPreview(code, lang, title)}>
              Preview
            </Button>
          )}
          <CopyBtn text={code} color="#bbb" />
        </Box>
        <SyntaxHighlighter language={HL_LANG[lang] || lang || 'text'} style={oneDark} customStyle={{ margin: 0, borderRadius: 0, fontSize: 13, background: '#1e1e22', padding: '14px 16px' }}>
          {code}
        </SyntaxHighlighter>
      </Box>
    );
  },
  a: ({ href, children }) => {
    // A link the model invented (not in the search results) is shown as plain text, never as a clickable source
    if (allowed && href && !allowed.has(norm(href))) {
      return <Tooltip title="Removed: this link was not in the search results (the model made it up)"><span style={{ textDecoration: 'line-through dotted', opacity: 0.75 }}>{children}</span></Tooltip>;
    }
    return <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--evx-link)' }}>{children}</a>;
  },
});

function SpeakBtn({ text }) {
  const [on, setOn] = useState(false);
  return (
    <Tooltip title={on ? 'Stop reading' : 'Read aloud'}>
      <IconButton size="small" onClick={() => {
        if (on) { stopSpeaking(); setOn(false); return; }
        setOn(true); speak(text, { onEnd: () => setOn(false) });
      }}>
        {on ? <StopCircleOutlinedIcon fontSize="inherit" /> : <VolumeUpIcon fontSize="inherit" />}
      </IconButton>
    </Tooltip>
  );
}

function Message({ m, isLast, streaming, onEdit, onRegenerate, onPreview, fontSize, onAsk, onFeedback, baseFiles }) {
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [showThink, setShowThink] = useState(false);

  if (m.role === 'user') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', mb: 3, '&:hover .act': { opacity: 1 } }}>
        {m.images?.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {m.images.map((src, i) => <Box key={i} component="img" src={src} sx={{ maxHeight: 160, maxWidth: 220, borderRadius: 2, objectFit: 'cover' }} />)}
          </Box>
        )}
        {m.files?.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {m.files.map((f, i) => <Chip key={i} icon={<InsertDriveFileOutlinedIcon />} label={f.name} variant="outlined" />)}
          </Box>
        )}
        {editing ? (
          <Paper elevation={0} sx={{ width: '100%', p: 1.5, bgcolor: 'background.soft' }}>
            <TextField fullWidth multiline autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} variant="standard" InputProps={{ disableUnderline: true }} />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
              <Button size="small" onClick={() => { setEditing(false); setDraft(m.content); }}>Cancel</Button>
              <Button size="small" variant="contained" disableElevation disabled={!draft.trim() || streaming}
                onClick={() => { setEditing(false); onEdit(m.id, draft.trim()); }}>Save & Send</Button>
            </Box>
          </Paper>
        ) : (
          <>
            {m.content && (
              <Paper elevation={0} sx={{ bgcolor: (t) => alpha(t.palette.primary.main, t.palette.mode === 'light' ? 0.1 : 0.2), border: 1, borderColor: (t) => alpha(t.palette.primary.main, 0.18), backdropFilter: 'blur(12px)', animation: 'fadeUp .3s ease both', px: 2, py: 1.25, maxWidth: '80%', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                borderRadius: '18px 18px 4px 18px', fontSize: 15.5, lineHeight: 1.6 }}>
                {m.content}
              </Paper>
            )}
            <Box className="act" sx={{ opacity: 0, transition: '.2s', display: 'flex' }}>
              <CopyBtn text={m.content} />
              <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditing(true)} disabled={streaming}><EditOutlinedIcon fontSize="inherit" /></IconButton></Tooltip>
            </Box>
          </>
        )}
      </Box>
    );
  }

  const working = streaming && isLast;
  const parsed = parseSpecial(m.content);
  const thinking = [m.reasoning, parsed.thought].filter(Boolean).join('\n\n');
  // Links that really came from the web search (full URL or the short /api/r/… form). null = no search → no filtering.
  const allowedLinks = m.search && !m.search.searching
    ? new Set([...(m.search.results || []), ...(m.search.related || [])].flatMap((r) => [r.url, r.short]).filter(Boolean).map(norm))
    : null;
  return (
    <Box sx={{ display: 'flex', gap: 1.5, mb: 3, '&:hover .act': { opacity: 1 } }}>
      <LogoMark size={28} spin={working} sx={{ mt: 0.25 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {thinking && (
          <Box sx={{ mb: 1 }}>
            <Button size="small" startIcon={<PsychologyIcon />} endIcon={<ExpandMoreIcon sx={{ transform: showThink ? 'rotate(180deg)' : 'none', transition: '.2s' }} />}
              onClick={() => setShowThink((v) => !v)} sx={{ color: 'text.secondary' }}>
              {working && !parsed.text ? 'Thinking…' : 'Thought process'}
            </Button>
            <Collapse in={showThink}>
              <Box sx={{ borderLeft: 2, borderColor: 'divider', pl: 2, ml: 1, color: 'text.secondary', fontSize: 14, whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto' }}>
                {thinking}
              </Box>
            </Collapse>
          </Box>
        )}
        {m.note && (
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.75, mb: 1, px: 1.25, py: 0.5, borderRadius: '8px', bgcolor: 'action.hover', width: 'fit-content' }}>
            <VisibilityOutlinedIcon sx={{ fontSize: 15 }} /> {m.note}
          </Typography>
        )}
        {m.search && (m.search.searching ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
            <LanguageIcon sx={{ fontSize: 16, animation: 'spin 1.5s linear infinite', '@keyframes spin': { to: { transform: 'rotate(360deg)' } } }} />
            Searching the web…
          </Typography>
        ) : <KnowledgeCard search={m.search} onAsk={onAsk} />)}
        <BuildSteps steps={m.steps} />
        <ToolSteps tools={m.tools} />
        {parsed.files.length > 0 && <ProjectCard files={parsed.files} baseFiles={baseFiles} working={working} onPreview={onPreview} />}
        <Box sx={{
          fontSize: { small: 14, large: 17.5 }[fontSize] || 15.5, lineHeight: 1.7, wordBreak: 'break-word', letterSpacing: -0.1,
          '& p': { my: 1 }, '& h1,& h2,& h3': { mt: 2, mb: 1, fontWeight: 650, letterSpacing: -0.3 },
          '& h1': { fontSize: 22 }, '& h2': { fontSize: 19 }, '& h3': { fontSize: 16.5 },
          '& ul, & ol': { pl: 3 }, '& li': { my: 0.4 },
          '& table': { borderCollapse: 'collapse', display: 'block', overflowX: 'auto', my: 1.5 },
          '& td, & th': { border: `1px solid ${theme.palette.divider}`, px: 1.25, py: 0.6, fontSize: 14.5 },
          '& th': { bgcolor: 'background.soft' },
          '& blockquote': { borderLeft: 3, borderColor: 'primary.main', m: 0, pl: 2, color: 'text.secondary' },
          ...(m.error && { color: 'error.main' }),
        }}>
          {m.content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
              components={makeComponents(onPreview, allowedLinks)}>{mathify(parsed.text)}</ReactMarkdown>
          ) : working && !thinking && m.search && !m.search.searching ? (
            <WaitingNote sources={m.search.results?.length} />
          ) : working && !thinking ? (
            <Box sx={{ display: 'flex', gap: 0.6, py: 1.5 }}>
              {[0, 1, 2].map((i) => (
                <Box key={i} sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'primary.main',
                  animation: `b 1.2s ${i * 0.15}s infinite`, '@keyframes b': { '0%,80%,100%': { opacity: 0.2 }, '40%': { opacity: 1 } } }} />
              ))}
            </Box>
          ) : null}
        </Box>
        <VerifyBadge v={m.verify} />
        {m.sources?.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center', mt: 0.5, mb: 0.5 }}>
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mr: 0.25 }}>From your data:</Typography>
            {m.sources.map((s) => (
              <Chip key={s} size="small" icon={<InsertDriveFileOutlinedIcon sx={{ fontSize: '14px !important' }} />} label={s} variant="outlined"
                sx={{ height: 22, fontSize: 11.5, maxWidth: 220 }} />
            ))}
          </Box>
        )}
        {!working && m.content && (
          <Box className="act" sx={{ display: 'flex', alignItems: 'center', gap: 0.25, opacity: isLast ? 1 : 0, transition: '.2s' }}>
            <CopyBtn text={m.content} />
            <SpeakBtn text={m.content} />
            <Tooltip title="Good response"><IconButton size="small" onClick={() => onFeedback?.('up')} sx={{ color: m.feedback === 'up' ? 'success.main' : undefined }}>{m.feedback === 'up' ? <ThumbUpIcon fontSize="inherit" /> : <ThumbUpOutlinedIcon fontSize="inherit" />}</IconButton></Tooltip>
            <Tooltip title="Bad response"><IconButton size="small" onClick={() => onFeedback?.('down')} sx={{ color: m.feedback === 'down' ? 'error.main' : undefined }}>{m.feedback === 'down' ? <ThumbDownIcon fontSize="inherit" /> : <ThumbDownOutlinedIcon fontSize="inherit" />}</IconButton></Tooltip>
            {isLast && <Tooltip title="Regenerate"><IconButton size="small" onClick={onRegenerate}><RefreshIcon fontSize="inherit" /></IconButton></Tooltip>}
            {m.model && (
              <Tooltip title="Tokens sent to the model (input) and received (output). Lower input = cheaper & faster.">
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1, fontSize: 11.5 }}>
                  {m.model.mine ? `${m.model.mine} (${m.model.id.split('/').pop()})` : m.model.id.split('/').pop().replace(/:latest$/, '')}
                  {m.usage?.prompt_tokens != null
                    ? ` · ${m.usage.prompt_tokens} in · ${m.usage.completion_tokens} out`
                    : m.sent ? ` · ~${m.sent} in · ~${Math.ceil(m.content.length / 4)} out` : ''}
                  {m.cost && (m.cost.free ? ' · free' : m.cost.cost != null ? ` · $${m.cost.cost < 0.01 ? m.cost.cost.toFixed(4) : m.cost.cost.toFixed(2)}` : '')}
                </Typography>
              </Tooltip>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default memo(Message);
