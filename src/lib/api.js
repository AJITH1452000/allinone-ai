export async function fetchModels(refresh = false) {
  const r = await fetch(`/api/models${refresh ? '?refresh=1' : ''}`);
  if (!r.ok) throw new Error('Cannot reach server');
  const j = await r.json();
  return { models: j.models || [], status: j.status || [] };
}

export async function fetchProviders() {
  const r = await fetch('/api/providers');
  if (!r.ok) throw new Error('Cannot reach server');
  return r.json();
}

export async function saveKey(provider, key) {
  const r = await fetch('/api/keys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, key }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Failed to save key');
  return j;
}

export async function addCustomProvider(data) {
  const r = await fetch('/api/custom-provider', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Failed to add');
  return j;
}

export const deleteCustomProvider = (id) => fetch(`/api/custom-provider/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ---------- Knowledge base for "My models" ----------
export const kbList = (id) => fetch(`/api/kb/${id}`).then((r) => r.json()).catch(() => []);
export const kbDelete = (id, docId) => fetch(`/api/kb/${id}/${docId}`, { method: 'DELETE' });
export const kbDeleteAll = (id) => fetch(`/api/kb/${id}`, { method: 'DELETE' });

const TEXT_EXT = /\.(txt|md|csv|json|js|jsx|ts|tsx|py|java|c|cpp|cs|go|rb|php|sql|html|htm|css|xml|yml|yaml|log|ini|env)$/i;
export async function kbUpload(id, file) {
  let body;
  if (/\.(pdf|docx)$/i.test(file.name)) {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file);
    });
    body = { name: file.name, data: b64 };
  } else if (TEXT_EXT.test(file.name) || file.type.startsWith('text/')) {
    body = { name: file.name, text: await file.text() };
  } else {
    throw new Error(`${file.name}: unsupported type (use PDF, Word .docx, txt, md, csv, json, html or code files)`);
  }
  if (JSON.stringify(body).length > 24e6) throw new Error(`${file.name}: too large (max ~18 MB)`);
  const r = await fetch(`/api/kb/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${file.name}: ${j.error || 'upload failed'}`);
  return j;
}
export const kbAddText = (id, name, text) => fetch(`/api/kb/${id}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text }),
}).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; });

export async function streamChat(payload, { onText, onReasoning, onError, onUsage, onSources, onCost, onSearch, onNote, onTool, onMemory, onVerify, onStep, signal }) {
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.t === 'text') onText?.(ev.v);
        else if (ev.t === 'reasoning') onReasoning?.(ev.v);
        else if (ev.t === 'error') onError?.(ev.v);
        else if (ev.t === 'usage') onUsage?.(ev.v);
        else if (ev.t === 'sources') onSources?.(ev.v);
        else if (ev.t === 'cost') onCost?.(ev.v);
        else if (ev.t === 'searching') onSearch?.({ searching: true, query: ev.v });
        else if (ev.t === 'search') onSearch?.({ searching: false, ...ev.v });
        else if (ev.t === 'note') onNote?.(ev.v);
        else if (ev.t === 'tool') onTool?.(ev.v);
        else if (ev.t === 'memory') onMemory?.(ev.v);
        else if (ev.t === 'verify') onVerify?.(ev.v);
        else if (ev.t === 'step') onStep?.(ev.v);
      } catch {}
    }
  }
}

// Rough token estimate (~4 chars per token; images ≈ 800 tokens each)
export const estTokens = (msgs) => msgs.reduce((n, m) => {
  if (typeof m.content === 'string') return n + Math.ceil(m.content.length / 4) + 4;
  return n + m.content.reduce((k, p) => k + (p.type === 'text' ? Math.ceil(p.text.length / 4) : 800), 4);
}, 0);

const clip = (s, max, note) => (s.length > max ? `${s.slice(0, max)}\n…[${note}]` : s);
// Drop big code blocks from OLD answers — the model rarely needs them again, and they cost the most tokens
const artifactNote = (attrs) => {
  const title = /title="([^"]+)"/.exec(attrs)?.[1];
  return `[artifact${title ? ` "${title}"` : ''} omitted to save tokens]`;
};
const slimOld = (s) => clip(s
  .replace(/<artifact\b([^>]*)>[\s\S]*?(<\/artifact>|$)/gi, (_, attrs) => artifactNote(attrs))
  .replace(/<file\s+path=["']([^"']+)["'][^>]*>[\s\S]*?(<\/file>|$)/gi, (_, p) => `[file ${p} omitted to save tokens]`)
  .replace(/```[\s\S]*?```/g, (b) => (b.length > 600 ? '```\n[code omitted to save tokens]\n```' : b)), 1200, 'trimmed');
// The model's private <thinking> notes are never sent back
const noThinking = (s) => s.replace(/<thinking>[\s\S]*?(<\/thinking>|$)/gi, '').trim();

/**
 * Convert stored messages to OpenAI-format messages, keeping token use low:
 *  - only the last `memory` messages are sent
 *  - images and full file text are sent only with the newest message
 *  - older assistant answers are shortened (big code blocks removed)
 */
export const toApiMessages = (messages, { memory = 10 } = {}) => {
  const all = messages.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content && !m.error));
  // Window moves in steps of memory/2 (not 1 message at a time): the start of the conversation stays
  // identical for several turns, so local models reuse their prompt cache instead of re-reading everything.
  const mem = Math.max(1, memory);
  const step = Math.max(1, Math.ceil(mem / 2));
  const start = Math.max(0, Math.ceil(Math.max(0, all.length - mem) / step) * step);
  let recent = all.slice(Math.min(start, all.length - 1));
  while (recent.length > 1 && recent[0].role !== 'user') recent = recent.slice(1);
  const last = recent.length - 1;
  return recent.map((m, i) => {
    const isLatest = i === last;
    const isPrevAnswer = i === last - 1;
    if (m.role === 'assistant') return { role: 'assistant', content: isPrevAnswer ? noThinking(m.content) : slimOld(noThinking(m.content)) };
    const fileText = (m.files || [])
      .map((f) => `\n\n--- File: ${f.name} ---\n${isLatest ? f.text : clip(f.text, 1500, 'file trimmed')}`)
      .join('');
    let text = (m.content || '') + fileText;
    if (!isLatest && m.images?.length) text += `\n[${m.images.length} image(s) shared earlier]`;
    if (!isLatest || !m.images?.length) return { role: 'user', content: text };
    return {
      role: 'user',
      content: [
        { type: 'text', text: text || 'Describe this image.' },
        ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ],
    };
  });
};

export const exportMarkdown = (chat) => {
  const md = `# ${chat.title}\n\n` + chat.messages
    .map((m) => `### ${m.role === 'user' ? '🧑 You' : `🤖 ${m.model?.id || 'AI'}`}\n\n${m.content}\n`)
    .join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  a.download = `${chat.title.replace(/[^\w\s-]/g, '').slice(0, 40) || 'chat'}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
};
