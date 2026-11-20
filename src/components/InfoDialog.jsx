import { useEffect, useState } from 'react';
import { Box, Button, Chip, Dialog, IconButton, Typography, useMediaQuery } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import { SHORTCUTS } from './SettingsDialog';

const FAQ = [
  ['Which model should I use?', 'Learn Pro for everyday work, Learn Max for big coding / reasoning tasks (slower), Learn Lite for quick questions. With API keys: Gemini Flash and Groq are fast and free; Claude and ChatGPT are paid.'],
  ['How do I add Google Gemini, Claude or ChatGPT?', 'Account menu → Get API keys (or the model picker → Connect providers). Paste the key and press Save — models appear instantly.'],
  ['How do I teach a model my own data?', 'Model picker → Your assistants → Create. Pick a base model (e.g. Learn Pro), then drop your PDFs, Word files or notes into "Your data".'],
  ['Why is a reply slow?', 'Local models run on your CPU. Learn Lite is fastest. Shorter chat memory and "Short answers" (Settings → Models & tokens) also help.'],
  ['How do I preview a web page or React component?', 'When a reply contains an artifact or HTML/React code, press "Preview" on the code block.'],
  ['The model list is empty', 'Make sure "npm run dev" is running and Ollama is open, then press reload ↻ in the model picker.'],
];

const PLANS = [
  { name: 'Local', price: 'Free forever', tag: 'Current', points: ['Your Learn Lite / Pro / Max models', 'Any Ollama model', 'Unlimited messages', 'Your files (RAG) & assistants', 'Private — runs on your PC'] },
  { name: 'Free cloud', price: '$0 · free API keys', points: ['Google Gemini (free tier)', 'Groq & Cerebras — ultra fast', 'OpenRouter :free models', 'Daily limits set by each provider'] },
  { name: 'Pay as you go', price: 'Pay providers directly', points: ['Claude (Anthropic)', 'ChatGPT / GPT models (OpenAI)', 'DeepSeek, Mistral, OpenRouter paid', 'Monthly budget limit in Usage'] },
];

function Plans() {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
      {PLANS.map((p) => (
        <Box key={p.name} sx={{ p: 2.25, borderRadius: '16px', border: p.tag ? 2 : 1, borderColor: p.tag ? 'primary.main' : 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: 17, fontWeight: 650, flex: 1 }}>{p.name}</Typography>
            {p.tag && <Chip label={p.tag} size="small" color="primary" />}
          </Box>
          <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 1.5 }}>{p.price}</Typography>
          {p.points.map((t) => (
            <Box key={t} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', py: 0.4 }}>
              <CheckIcon sx={{ fontSize: 17, color: 'primary.main', mt: 0.2 }} />
              <Typography sx={{ fontSize: 13.5 }}>{t}</Typography>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

function Apps() {
  const [prompt, setPrompt] = useState(window.__installPrompt || null);
  const [done, setDone] = useState(window.matchMedia?.('(display-mode: standalone)').matches);
  useEffect(() => {
    const h = (e) => { e.preventDefault(); window.__installPrompt = e; setPrompt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  const install = async () => { await prompt.prompt(); const r = await prompt.userChoice; if (r.outcome === 'accepted') setDone(true); setPrompt(null); };
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {[
        ['Desktop app (Windows / Mac)', done ? 'Installed ✓' : 'Installs as an app with its own window and Start-menu icon.',
          prompt && !done ? <Button variant="contained" disableElevation onClick={install}>Install</Button>
            : <Typography sx={{ fontSize: 12.5, color: 'text.secondary', maxWidth: 220 }}>{done ? '' : 'In Chrome / Edge: click the install icon ⊕ in the address bar.'}</Typography>],
        ['Phone (same Wi-Fi)', 'Run "npm run dev -- --host", then open the shown Network address on your phone and choose "Add to Home screen".', null],
        ['Ollama', 'Runs your Learn models. Starts automatically with Windows.', <Button href="https://ollama.com/download" target="_blank" variant="outlined" color="inherit" sx={{ borderColor: 'divider' }}>Download</Button>],
      ].map(([t, d, a]) => (
        <Box key={t} sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, borderRadius: '14px', border: 1, borderColor: 'divider' }}>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{t}</Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{d}</Typography>
          </Box>
          {a}
        </Box>
      ))}
    </Box>
  );
}

const PAGES = {
  help: { title: 'Get help', body: () => FAQ.map(([q, a]) => (
    <Box key={q} sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
      <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{q}</Typography>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.25 }}>{a}</Typography>
    </Box>
  )) },
  plans: { title: 'Plans', wide: true, body: () => <Plans /> },
  apps: { title: 'Get apps and extensions', body: () => <Apps /> },
  shortcuts: { title: 'Keyboard shortcuts', body: () => SHORTCUTS.map(([l, k]) => (
    <Box key={l} sx={{ display: 'flex', py: 1.1, borderBottom: 1, borderColor: 'divider' }}>
      <Typography sx={{ flex: 1, fontSize: 14 }}>{l}</Typography><Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{k}</Typography>
    </Box>
  )) },
  about: { title: 'About All-in-One AI', body: () => (
    <Typography sx={{ fontSize: 14, lineHeight: 1.7 }}>
      One place for your own <b>Learn</b> models (Lite, Pro, Max), any Ollama model, and cloud AI like <b>Google Gemini</b>, <b>Claude</b> and <b>ChatGPT</b>.
      Build assistants with your own files, preview web pages and React components live, and track usage and cost — all running on your computer.
    </Typography>
  ) },
  privacy: { title: 'Privacy & your data', body: () => (
    <Box component="ul" sx={{ pl: 2.5, fontSize: 14, lineHeight: 1.8, m: 0 }}>
      <li>Chats and settings are stored in this browser only.</li>
      <li>API keys, uploaded files and usage logs are stored in <code>keys.json</code> and <code>data/</code> next to <code>server.js</code>.</li>
      <li>Learn and Ollama models run fully offline — nothing leaves your PC.</li>
      <li>Cloud models (Gemini, Claude, ChatGPT…) receive only the messages you send to them.</li>
      <li>Export or delete everything in Settings → Data controls.</li>
    </Box>
  ) },
  models: { title: 'Your Learn models', body: () => (
    <Box sx={{ fontSize: 14, lineHeight: 1.7 }}>
      {[['Learn Lite', 'gemma3:1b · fastest, quick answers'], ['Learn Pro', 'gemma3:4b · balanced, understands images'], ['Learn Max', 'qwen2.5:7b · best for coding & reasoning']].map(([n, d]) => (
        <Box key={n} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}><b>{n}</b> — {d}</Box>
      ))}
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 1.5 }}>
        Change their instructions in <code>models/system.md</code>, their name in <code>models/family.json</code>, then run <code>npm run build-models</code>.
      </Typography>
    </Box>
  ) },
};

export default function InfoDialog({ page, onClose }) {
  const full = useMediaQuery('(max-width:600px)');
  const p = PAGES[page];
  return (
    <Dialog open={!!p} onClose={onClose} fullWidth maxWidth={p?.wide ? 'md' : 'sm'} fullScreen={full}
      PaperProps={{ sx: { borderRadius: full ? 0 : '20px' } }}>
      {p && (
        <Box sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Typography sx={{ flex: 1, fontSize: 19, fontWeight: 650 }}>{p.title}</Typography>
            <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
          </Box>
          {p.body()}
        </Box>
      )}
    </Dialog>
  );
}
