import { useState } from 'react';
import { Box, Button, Dialog, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CodeIcon from '@mui/icons-material/Code';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { parseSpecial } from './Message';

const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const who = (m) => (m.role === 'user' ? 'You' : (m.model?.mine || m.model?.id?.replace(/:latest$/, '') || 'AI'));
const clean = (m) => (m.role === 'assistant' ? parseSpecial(m.content).text : m.content || '');

export const chatToMarkdown = (chat) => `# ${chat.title}\n\n` + chat.messages
  .filter((m) => m.content)
  .map((m) => `**${who(m)}:**\n\n${clean(m)}\n`).join('\n---\n\n');

// Self-contained web page (opens in any browser, no app needed)
export const chatToHtml = (chat) => {
  const body = chat.messages.filter((m) => m.content).map((m) => {
    const html = esc(clean(m))
      .replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, l, c) => `<pre><code>${c}</code></pre>`)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/^[-*] (.*)$/gm, '• $1')
      .replace(/\n/g, '<br>').replace(/<br>(<\/?(pre|h\d))/g, '$1');
    return `<div class="m ${m.role}"><div class="who">${esc(who(m))}</div><div class="c">${html}</div></div>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(chat.title)}</title><style>
body{margin:0;background:#fbfaf7;color:#1a1917;font:15.5px/1.7 Inter,system-ui,"Noto Sans Tamil",sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px}h1.t{font-size:24px;margin:0 0 24px}
.m{margin:0 0 22px}.who{font-size:12.5px;font-weight:600;color:#6b6963;margin-bottom:4px}
.user .c{background:#efede6;border-radius:16px;padding:10px 16px;display:inline-block;max-width:85%}
pre{background:#1e1e22;color:#e6e6ea;padding:14px 16px;border-radius:12px;overflow:auto;font-size:13px}
code{font-family:ui-monospace,Consolas,monospace}a{color:#c2593a}footer{color:#999;font-size:12px;margin-top:32px}
</style></head><body><main><h1 class="t">${esc(chat.title)}</h1>${body}
<footer>Shared from All-in-One AI · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</footer></main></body></html>`;
};

export default function ShareDialog({ chat, onClose }) {
  const [done, setDone] = useState('');
  if (!chat) return null;
  const flash = (t) => { setDone(t); setTimeout(() => setDone(''), 1800); };
  const download = (name, text, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  };
  const base = chat.title.replace(/[^\w\s-]/g, '').trim().slice(0, 40) || 'chat';
  const opts = [
    [ContentCopyIcon, 'Copy as text', 'Paste into WhatsApp, email or notes', async () => { await navigator.clipboard.writeText(chatToMarkdown(chat)); flash('Copied to clipboard'); }],
    [CodeIcon, 'Download as web page', 'A .html file anyone can open in a browser', () => { download(`${base}.html`, chatToHtml(chat), 'text/html'); flash('Downloaded'); }],
    [DescriptionOutlinedIcon, 'Download as Markdown', 'A .md file for docs, GitHub or Notion', () => { download(`${base}.md`, chatToMarkdown(chat), 'text/markdown'); flash('Downloaded'); }],
  ];
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: '20px' } }}>
      <Box sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
          <Typography sx={{ flex: 1, fontSize: 18, fontWeight: 650 }}>Share chat</Typography>
          <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
        </Box>
        <Typography noWrap sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>{chat.title} · {chat.messages.length} messages</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {opts.map(([Icon, t, d, fn]) => (
            <Button key={t} onClick={fn} color="inherit" sx={{ justifyContent: 'flex-start', gap: 1.5, p: 1.5, borderRadius: '12px', border: 1, borderColor: 'divider', textAlign: 'left' }}>
              <Icon sx={{ color: 'text.secondary' }} />
              <Box><Typography sx={{ fontSize: 14, fontWeight: 600 }}>{t}</Typography><Typography sx={{ fontSize: 12.5, color: 'text.secondary', fontWeight: 400 }}>{d}</Typography></Box>
            </Button>
          ))}
        </Box>
        <Typography sx={{ fontSize: 13, color: 'success.main', mt: 1.5, minHeight: 20 }}>{done}</Typography>
      </Box>
    </Dialog>
  );
}
