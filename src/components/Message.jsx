import { memo, useState } from 'react';
import { Box, Paper, Avatar, IconButton, Tooltip, TextField, Button, Collapse, Typography, Chip, useTheme } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
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
import KnowledgeCard, { WaitingNote } from './KnowledgeCard';
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
  let text = content.replace(/<thinking>([\s\S]*?)(<\/thinking>|$)/gi, (_, t) => { thought += t.trim() + '\n'; return ''; });
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
  return { thought: thought.trim(), text: text.trim() };
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
    return (
      <Box sx={{ my: 1.5, borderRadius: 3, overflow: 'hidden', border: '1px solid #26262b', bgcolor: '#1e1e22' }}>
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
    return <a href={href} target="_blank" rel="noreferrer" style={{ color: '#c96442' }}>{children}</a>;
  },
});

function speak(text) {
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[#*`>_-]/g, ''));
  if (/[஀-௿]/.test(text)) u.lang = 'ta-IN';
  window.speechSynthesis.speak(u);
}

function Message({ m, isLast, streaming, onEdit, onRegenerate, onPreview, fontSize, onAsk, onFeedback }) {
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
              <Paper elevation={0} sx={{ bgcolor: 'background.soft', px: 2, py: 1.25, maxWidth: '80%', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
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
      <Avatar sx={{ background: 'linear-gradient(135deg,#c96442,#7c5cff)', width: 28, height: 28, mt: 0.25 }}>
        <AutoAwesomeIcon sx={{ fontSize: 16, ...(working && { animation: 'spin 2s linear infinite' }), '@keyframes spin': { to: { transform: 'rotate(360deg)' } } }} />
      </Avatar>
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
            <Tooltip title="Read aloud"><IconButton size="small" onClick={() => speak(m.content)}><VolumeUpIcon fontSize="inherit" /></IconButton></Tooltip>
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
