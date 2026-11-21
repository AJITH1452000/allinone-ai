import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThemeProvider, CssBaseline, Box, Button, Drawer, IconButton, Tooltip, Typography, useMediaQuery, Alert, ButtonBase, InputBase, alpha } from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import MenuIcon from '@mui/icons-material/Menu';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined';
import CodeIcon from '@mui/icons-material/Code';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import TranslateIcon from '@mui/icons-material/Translate';
import WebOutlinedIcon from '@mui/icons-material/WebOutlined';
import NotesOutlinedIcon from '@mui/icons-material/NotesOutlined';
import { makeTheme } from './theme';
import { BRAND, BRAND_GRADIENT } from './brand';
import Sidebar from './components/Sidebar';
import { LogoMark } from './components/Logo';
import Message, { parseSpecial } from './components/Message';
import { mergeFiles, fixRequest } from './lib/project';
import Composer from './components/Composer';
import ModelPicker from './components/ModelPicker';
import SettingsDialog from './components/SettingsDialog';
import UsageDialog from './components/UsageDialog';
import InfoDialog from './components/InfoDialog';
import WelcomeScreen from './components/WelcomeScreen';
import PreviewPanel from './components/PreviewPanel';
import { loadChats, saveChats, loadSettings, saveSettings, newChat, uid, loadProjects, saveProjects } from './lib/storage';
import ChatMenu from './components/ChatMenu';
import ShareDialog from './components/ShareDialog';
import { quickTitle } from './lib/titles';
import IosShareIcon from '@mui/icons-material/IosShare';
import { SearchDialog, ProjectsDialog, ArtifactsDialog } from './components/Panels';
import { buildSystem, rememberedFact, looksSecret } from './lib/personas';
import { speak } from './lib/speech';
import { fetchModels, streamChat, toApiMessages, estTokens, kbDeleteAll } from './lib/api';

const STARTERS = [
  { label: 'Code', Icon: CodeIcon, t: 'Build a responsive React + MUI login page with full code' },
  { label: 'Learn', Icon: SchoolOutlinedIcon, t: 'Explain closures in JavaScript with simple examples' },
  { label: 'தமிழ் கதை', Icon: TranslateIcon, t: 'தமிழில் ஒரு சிறு கதை எழுது' },
  { label: 'Web page', Icon: WebOutlinedIcon, t: 'Make an HTML landing page for a tea shop' },
  { label: 'Plan', Icon: NotesOutlinedIcon, t: 'Make a simple 7-day study plan for TNPSC Group 4' },
];

/**
 * The system prompt for the chosen model. Kept identical between messages so local models can reuse
 * their prompt cache (= fast first word). Your own Learn models already contain their main
 * instructions, so the default persona text is not added on top of them.
 */
function systemFor(settings, models) {
  const mine = settings.model?.provider === 'mine' ? settings.myModels.find((x) => x.id === settings.model.id) : null;
  if (mine) {
    return buildSystem({
      ...settings, personaId: 'custom',
      customSystem: [mine.instructions, mine.knowledge && `Knowledge you can use:\n${mine.knowledge}`, settings.customSystem].filter(Boolean).join('\n\n'),
    });
  }
  const own = models.find((m) => m.own && settings.model && m.provider === settings.model.provider && m.id === settings.model.id);
  if (own && (settings.personaId || 'default') === 'default') return buildSystem({ ...settings, personaId: 'custom' });
  return buildSystem(settings);
}

const greeting = (name) => {
  const h = new Date().getHours();
  return `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${name || 'Vanakkam'}!`;
};

export default function App() {
  const [chats, setChats] = useState(loadChats);
  const [activeId, setActiveId] = useState(() => chats[0].id);
  const [settings, setSettings] = useState(loadSettings);
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelErr, setModelErr] = useState('');
  const [provStatus, setProvStatus] = useState([]);
  const [streamingId, setStreamingId] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('general');
  const [infoPage, setInfoPage] = useState(null);
  const [pickerReq, setPickerReq] = useState(null); // ask the model picker to open on a tab
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [warming, setWarming] = useState(false); // local model is loading / pre-reading its prompt
  const [projects, setProjects] = useState(loadProjects);
  const [activeProject, setActiveProject] = useState(null); // sidebar is showing this project's chats
  const [shareId, setShareId] = useState(null);
  const [panel, setPanel] = useState(null); // 'search' | 'projects' | 'artifacts'
  const [titleEdit, setTitleEdit] = useState(null); // header inline rename
  const [titleMenu, setTitleMenu] = useState(null);
  const [projectRename, setProjectRename] = useState(null);
  useEffect(() => { saveProjects(projects); }, [projects]);
  const [preview, setPreview] = useState(null);
  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const searchRef = useRef(null);

  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;
  const theme = useMemo(() => makeTheme(mode), [mode]);
  const profile = settings.profile || {};

  const openSettings = (tab = 'general') => { setSettingsTab(tab); setSettingsOpen(true); setMobileOpen(false); };
  // Account menu actions
  const onAction = (a) => {
    setMobileOpen(false);
    if (a === 'settings') openSettings('general');
    else if (a === 'usage') setUsageOpen(true);
    else if (a === 'keys') setPickerReq({ tab: 1, at: Date.now() });
    else if (a === 'logout') setSettings((s) => ({ ...s, signedOut: true }));
    else setInfoPage(a); // help, plans, apps, about, shortcuts, privacy, models
  };
  const isMobile = useMediaQuery('(max-width:900px)');
  const chat = chats.find((c) => c.id === activeId) || chats[0];
  const chatProject = projects.find((p) => p.id === chat.projectId);
  const streaming = !!streamingId;
  // Project mode: for each message, the project files written in EARLIER answers of this chat
  // (a "Fix with AI" reply contains only the changed files; the rest come from here)
  const projectBase = useMemo(() => {
    let acc = [];
    return chat.messages.map((m) => {
      const before = acc;
      if (m.role === 'assistant' && m.content && /<file\s+path=/i.test(m.content)) acc = mergeFiles(acc, parseSpecial(m.content).files);
      return before;
    });
  }, [chat.messages]);

  useEffect(() => { const t = setTimeout(() => saveChats(chats), 400); return () => clearTimeout(t); }, [chats]);
  useEffect(() => { saveSettings(settings); }, [settings]);

  const loadModels = useCallback(async (refresh) => {
    setModelsLoading(true); setModelErr('');
    try {
      const { models: list, status } = await fetchModels(refresh);
      setModels(list);
      setProvStatus(status);
      const failed = status.filter((s) => !s.ok && s.id !== 'ollama').map((s) => `${s.name}: ${s.error}`);
      if (!list.length) setModelErr('No models found. Click the model name at the top → Connect providers to add a free key.'
        + (failed.length ? ` Errors — ${failed.join('; ')}` : ''));
      else if (failed.length) setModelErr(`Some providers failed — ${failed.join('; ')}`);
      setSettings((s) => {
        const has = (ref) => ref && list.some((m) => m.provider === ref.provider && m.id === ref.id);
        const mine = s.model?.provider === 'mine' && (s.myModels || []).find((x) => x.id === s.model.id);
        const ok = mine ? has(mine.base) : has(s.model);
        if (ok || !list.length) return s;
        // Prefer your own model (Learn Code+ once trained, else Learn), then a fast free one, then Gemini Flash, local Ollama, any free one
        const pick = list.find((m) => m.own && m.default && !m.hidden) || list.find((m) => m.own && !m.hidden) || list.find((m) => m.fast &&/llama-3\.3-70b|llama3\.3|gpt-oss-120b/.test(m.id)) || list.find((m) => m.fast)
          || list.find((m) => m.provider === 'gemini' && /flash/.test(m.id) && !/preview|exp|tts|lite/.test(m.id))
          || list.find((m) => m.provider === 'ollama') || list.find((m) => m.free) || list[0];
        return { ...s, model: { provider: pick.provider, id: pick.id } };
      });
    } catch (e) {
      setModelErr('Server not running. Run "npm run dev".');
    }
    setModelsLoading(false);
  }, []);
  useEffect(() => { loadModels(false); }, [loadModels]);

  // Auto-scroll unless the user scrolled up
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);
  const [showJump, setShowJump] = useState(false); // "↓ jump to latest" button (like Claude / ChatGPT)
  const onScroll = (e) => {
    const el = e.currentTarget;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 400);
  };
  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (el) { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); stickRef.current = true; }
  };

  const updateChat = useCallback((id, fn) => setChats((cs) => cs.map((c) => (c.id === id ? fn(c) : c))), []);

  const run = useCallback(async (chatId, history, opts = {}) => {
    // "My model" = a base model + your own instructions, knowledge and temperature
    const mine = settings.model?.provider === 'mine' ? settings.myModels.find((x) => x.id === settings.model.id) : null;
    if (settings.model?.provider === 'mine' && !mine?.base) return;
    let model = mine ? { ...mine.base, mine: `${mine.icon} ${mine.name}` } : settings.model;
    // 🧠 Max quality (message box): your own Learn / Learn Code+ → Learn Max for this message (bigger, slower)
    if (settings.quality === 'max' && model.provider === 'ollama' && models.some((x) => x.own && !x.hidden && x.id === model.id)) {
      const max = models.find((x) => x.own && /-max(:|$)/.test(x.id));
      if (max) model = { provider: max.provider, id: max.id, mine: model.mine };
    }
    // A photo needs a model that can see. Text-only models (e.g. Learn Lite) → use a vision model for this message.
    let note = null;
    const lastUser = history[history.length - 1];
    if (lastUser?.images?.length) {
      const cur = models.find((m) => m.provider === model.provider && m.id === model.id);
      if (cur && !cur.vision) {
        const v = models.find((m) => m.own && m.vision) || models.find((m) => m.vision && m.free) || models.find((m) => m.vision);
        const name = (m) => (m.label || m.id).replace(/:latest$/, '');
        if (v) {
          model = { provider: v.provider, id: v.id, mine: model.mine };
          note = `${name(cur)} can't see images, so ${name(v)} answered this one.`;
        } else {
          note = `${name(cur)} can't see images. Pull a vision model (ollama pull gemma3:4b) or add a Gemini key.`;
        }
      }
    }
    const asstId = uid();
    updateChat(chatId, (c) => ({ ...c, messages: [...history, { id: asstId, role: 'assistant', content: '', reasoning: '', model, note }] }));
    setStreamingId(asstId);
    stickRef.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let text = '', reasoning = '', error = false, usage = null, raf = 0, sources = null, cost = null, search = null, tools = null, verify = null, steps = null, speed = null, savedMemory = false;
    const flush = () => {
      raf = 0;
      updateChat(chatId, (c) => ({
        ...c, messages: c.messages.map((m) => (m.id === asstId ? { ...m, content: text, reasoning, error, usage, sent: m.sent, sources, cost, search, tools, verify, steps, speed } : m)),
      }));
    };
    const remember = (fact) => {
      if (settings.memoryOn === false || !fact) return;
      savedMemory = true;
      setSettings((s) => ((s.memories || []).some((x) => x.text.toLowerCase() === fact.toLowerCase()) ? s
        : { ...s, memories: [...(s.memories || []), { id: uid(), text: fact, at: Date.now() }] }));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(flush); };

    const apiMessages = toApiMessages(history, { memory: settings.memory });
    const system = systemFor(settings, models);
    const sent = estTokens([{ content: system }, ...apiMessages]);
    updateChat(chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === asstId ? { ...m, sent } : m)) }));
    try {
      await streamChat({
        provider: model.provider, model: model.id,
        messages: apiMessages,
        system,
        // Learn models use their own tuned (low, accurate) creativity unless you changed the slider from the default
        temperature: mine ? mine.temperature
          : models.some((x) => x.own && x.id === model.id) && settings.temperature === 0.7 ? undefined : settings.temperature,
        maxTokens: settings.maxTokens,
        kbId: mine?.id, // the server searches this model's uploaded files
        webSearch: settings.webSearch || 'auto', // auto / on / off
        reasoning: settings.reasoning || 'balanced', // fast / balanced / expert
        tools: settings.tools || 'auto',
        allowCode: !!settings.allowCode,
        extendedThinking: !!settings.extendedThinking, // Learn thinks before every answer (otherwise only when needed)
        style: settings.style && settings.style !== 'normal' ? settings.style : '', // concise / explanatory / formal
        regenerate: !!opts.regenerate, // a fresh answer, never the 10-minute cached one
        research: !!settings.research, // 3-5 web searches on sub-questions → a structured report with sources
      }, {
        signal: ctrl.signal,
        onTool: (t) => { tools = [...(tools || []).filter((x) => x.id !== t.id), t]; schedule(); },
        onMemory: remember,
        onVerify: (v) => { verify = v; schedule(); },
        onSpeed: (v) => { speed = v; schedule(); },
        onStep: (s) => { const cur = steps || []; steps = cur.some((x) => x.id === s.id) ? cur.map((x) => (x.id === s.id ? s : x)) : [...cur, s]; schedule(); },
        onSources: (s) => { sources = s; schedule(); },
        onCost: (c) => { cost = c; schedule(); },
        onSearch: (s) => { search = s; schedule(); },
        onNote: (n) => { note = note ? `${note} ${n}` : n; updateChat(chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === asstId ? { ...m, note } : m)) })); },
        onText: (t) => { text += t; schedule(); },
        onReasoning: (t) => { reasoning += t; schedule(); },
        onUsage: (u) => { usage = u; },
        onError: (msg) => { error = !text; text += `${text ? '\n\n' : ''}⚠️ **Error:** ${msg}`; schedule(); },
      });
    } catch (e) {
      if (e.name !== 'AbortError') { error = true; text += `\n\n⚠️ **Error:** ${e.message}`; }
    }
    if (raf) cancelAnimationFrame(raf);
    flush();
    setStreamingId(null);
    abortRef.current = null;
    // Long-term memory for models without tools: "remember that …" is saved by the app itself
    if (!error && !savedMemory) remember(rememberedFact(lastUser?.content || ''));
    if (settings.autoSpeak && !error && text && !ctrl.signal.aborted) speak(text);

    // First answer in a chat → let a fast cloud model write a better short title (local models keep the instant one)
    if (!error && text && history.filter((m) => m.role === 'user').length === 1) {
      const first = history.find((m) => m.role === 'user');
      fetch('/api/title', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: model.provider, model: model.id, text: first.content, reply: text.slice(0, 300) }),
      }).then((r) => r.json()).then(({ title }) => { if (title) updateChat(chatId, (c) => ({ ...c, title })); }).catch(() => {});
    }
  }, [settings, updateChat, models]);

  // Speed: as soon as a model is chosen, load it and pre-process its prompt (and your files' index) in the background
  const warmKey = JSON.stringify([settings.model, settings.lang, settings.concise, settings.personaId, settings.customSystem, settings.profile, models.length]);
  useEffect(() => {
    if (!settings.model || !models.length) return;
    const mine = settings.model.provider === 'mine' ? settings.myModels.find((x) => x.id === settings.model.id) : null;
    const base = mine ? mine.base : settings.model;
    if (!base) return;
    let alive = true;
    const t = setTimeout(() => {
      if (base.provider === 'ollama') setWarming(true);
      // Never let "Preparing model…" hang: stop waiting after 45 s (the model keeps loading in the background)
      fetch('/api/warm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({ provider: base.provider, model: base.id, system: systemFor(settings, models), kbId: mine?.id }),
      }).catch(() => {}).finally(() => { if (alive) setWarming(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [warmKey]); // eslint-disable-line

  const send = ({ text, images, files }) => {
    if (!settings.model) return;
    // Safety: warn before a password / API key / card number goes to a cloud AI (local Ollama models are private)
    const base = settings.model.provider === 'mine' ? settings.myModels.find((x) => x.id === settings.model.id)?.base : settings.model;
    if (base?.provider !== 'ollama' && looksSecret(`${text}\n${files.map((f) => f.text).join('\n')}`)
      && !window.confirm('Your message looks like it contains a password, API key or card number.\n\nIt will be sent to an online AI provider. Send anyway?')) return false;
    const userMsg = { id: uid(), role: 'user', content: text, images, files };
    const history = [...chat.messages, userMsg];
    const title = chat.messages.length ? chat.title : quickTitle(text, { hasImages: images.length > 0, fileName: files[0]?.name });
    updateChat(chat.id, (c) => ({ ...c, title, updatedAt: Date.now() }));
    run(chat.id, history);
  };

  const edit = (msgId, newText) => {
    const idx = chat.messages.findIndex((m) => m.id === msgId);
    const history = [...chat.messages.slice(0, idx), { ...chat.messages[idx], content: newText }];
    run(chat.id, history);
  };

  // 👍 / 👎 / ✏️ on an answer. For local Learn answers this is training data: good → lesson, corrected → lesson + preference pair
  // (your version beats the original), bad → retried by npm run self-train. Online AIs' answers are never sent (their terms forbid it).
  const giveFeedback = (m, v, extra = {}) => {
    const unset = v !== 'corrected' && m.feedback === v && !extra.note;
    updateChat(chat.id, (c) => ({ ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...x, feedback: unset ? null : v, ...(v === 'corrected' ? { correction: extra.corrected } : {}) } : x)) }));
    if (unset || m.model?.provider !== 'ollama') return;
    const idx = chat.messages.findIndex((x) => x.id === m.id);
    const prompt = chat.messages.slice(Math.max(0, idx - 5), idx).filter((x) => x.role === 'user' || x.role === 'assistant')
      .map((x) => ({ role: x.role, content: `${x.content || ''}${(x.files || []).map((f) => `\n\n--- File: ${f.name} ---\n${f.text}`).join('')}` }));
    fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      chatId: chat.id, messageId: m.id, model: m.model.id, provider: m.model.provider, prompt, answer: m.content,
      rating: v === 'up' ? 'good' : v === 'down' ? 'bad' : 'corrected', corrected: extra.corrected, note: extra.note,
    }) }).catch(() => {});
  };

  const regenerate = () => {
    const lastUser = chat.messages.map((m) => m.role).lastIndexOf('user');
    if (lastUser >= 0) run(chat.id, chat.messages.slice(0, lastUser + 1), { regenerate: true });
  };

  const startNew = (projectId = activeProject) => {
    // reuse the current empty chat if it's already a fresh one in the same place
    if (!chat.messages.length && (chat.projectId || null) === (projectId || null)) { setMobileOpen(false); return; }
    const c = { ...newChat(), projectId: projectId || null };
    setChats((cs) => [c, ...cs.filter((x) => x.messages.length)]); // drop leftover empty chats
    setActiveId(c.id); setMobileOpen(false); setPreview(null);
  };

  const remove = (id) => setChats((cs) => {
    const rest = cs.filter((c) => c.id !== id);
    const next = rest.length ? rest : [newChat()];
    if (id === activeId) setActiveId((next.find((c) => !c.archived) || next[0]).id);
    return next;
  });

  // ---- Sidebar navigation (New chat · Search · Projects · Artifacts · Assistants · Usage) ----
  const onNav = (id) => {
    if (isMobile) setMobileOpen(false);
    if (id === 'new') startNew();
    else if (id === 'search' || id === 'projects' || id === 'artifacts') setPanel(id);
    else if (id === 'assistants') setPickerReq({ tab: 0, at: Date.now() });
    else if (id === 'usage') setUsageOpen(true);
    else if (id === 'apps') setInfoPage('apps');
  };

  // ---- Chat menu actions (Pin · Rename · Add to project · Share · Archive · Delete) ----
  const createProject = (name) => {
    const p = { id: uid(), name: (name || 'New project').slice(0, 60), createdAt: Date.now() };
    setProjects((ps) => [p, ...ps]);
    return p;
  };
  const chatAction = (id, type, value) => {
    const c = chats.find((x) => x.id === id);
    if (!c) return;
    if (type === 'pin') updateChat(id, (x) => ({ ...x, pinned: !x.pinned }));
    else if (type === 'renameTo') value && updateChat(id, (x) => ({ ...x, title: value.slice(0, 80) }));
    else if (type === 'rename') { setActiveId(id); setTitleEdit(c.title); }
    else if (type === 'project') updateChat(id, (x) => ({ ...x, projectId: value }));
    else if (type === 'newProject') { const p = createProject(value); updateChat(id, (x) => ({ ...x, projectId: p.id })); }
    else if (type === 'share') setShareId(id);
    else if (type === 'archive') {
      updateChat(id, (x) => ({ ...x, archived: !x.archived, pinned: false }));
      if (id === activeId && !c.archived) { const nxt = chats.find((x) => x.id !== id && !x.archived); nxt ? setActiveId(nxt.id) : startNew(); }
    } else if (type === 'delete') { if (confirm(`Delete "${c.title}"? This cannot be undone.`)) remove(id); }
  };
  const projectAction = (pid, type, value) => {
    if (type === 'create') { const p = createProject(value); setActiveProject(p.id); setTimeout(() => setProjectRename(p.id), 0); }
    else if (type === 'rename') value && setProjects((ps) => ps.map((p) => (p.id === pid ? { ...p, name: value.slice(0, 60) } : p)));
    else if (type === 'delete') {
      setProjects((ps) => ps.filter((p) => p.id !== pid));
      setChats((cs) => cs.map((c) => (c.projectId === pid ? { ...c, projectId: null } : c)));
      if (activeProject === pid) setActiveProject(null);
    }
  };

  // Keyboard shortcuts (same as Claude / ChatGPT)
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === ',' || e.key === '<')) { e.preventDefault(); openSettings('general'); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); startNew(); }
      else if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setPanel('search'); }
      else if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); setSidebarHidden((v) => !v); }
      else if (mod && e.key === '/') { e.preventDefault(); setInfoPage('shortcuts'); }
      else if (e.key === 'Escape' && abortRef.current) abortRef.current.abort();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const composer = (
    <Composer onSend={send} onStop={() => abortRef.current?.abort()} streaming={streaming}
      settings={settings} setSettings={setSettings} disabled={!settings.model} />
  );

  const sidebar = (
    <Sidebar chats={chats} projects={projects} activeId={chat.id} activeProject={activeProject}
      onOpenProject={(pid) => { setActiveProject(pid); const first = chats.find((c) => c.projectId === pid && !c.archived); if (pid && first) setActiveId(first.id); }}
      onSelect={(id) => { setActiveId(id); setMobileOpen(false); setPreview(null); }}
      onChatAction={chatAction} onProjectAction={projectAction} renameProject={projectRename} onRenameStarted={() => setProjectRename(null)}
      settings={settings} setSettings={setSettings} onAction={onAction} onNav={onNav}
      collapsed={!isMobile && sidebarHidden} onToggleCollapse={() => (isMobile ? setMobileOpen(false) : setSidebarHidden((v) => !v))} />
  );

  if (settings.signedOut || !settings.onboarded) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <WelcomeScreen profile={profile}
          onContinue={(p) => setSettings((s) => ({ ...s, profile: { ...s.profile, ...p }, signedOut: false, onboarded: true }))} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.default', overflow: 'hidden', position: 'relative' }}>
        {/* Aurora: soft brand-coloured light drifting slowly behind the glass surfaces */}
        <Box aria-hidden sx={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden',
          '& > span': { position: 'absolute', borderRadius: '50%', filter: 'blur(90px)', opacity: mode === 'dark' ? 0.32 : 0.28 } }}>
          <Box component="span" sx={{ width: '46vw', height: '46vw', top: '-18vw', left: '8vw', background: BRAND.violet, animation: 'evx-drift-a 26s ease-in-out infinite' }} />
          <Box component="span" sx={{ width: '40vw', height: '40vw', top: '-10vw', right: '-12vw', background: BRAND.cyan, animation: 'evx-drift-b 32s ease-in-out infinite' }} />
          <Box component="span" sx={{ width: '36vw', height: '36vw', bottom: '-20vw', left: '34vw', background: BRAND.indigo, animation: 'evx-drift-c 38s ease-in-out infinite' }} />
        </Box>
        <Drawer variant={isMobile ? 'temporary' : 'permanent'} open={isMobile ? mobileOpen : true} onClose={() => setMobileOpen(false)}
          sx={{ width: isMobile ? 0 : sidebarHidden ? 56 : 272, flexShrink: 0, transition: 'width .2s', '& .MuiDrawer-paper': { width: isMobile ? 272 : sidebarHidden ? 56 : 272, border: 0, transition: 'width .2s', overflowX: 'hidden' } }}>
          {sidebar}
        </Drawer>

        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative', zIndex: 1 }}>
          {/* Header */}
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, position: 'relative', zIndex: 2,
            backdropFilter: 'saturate(180%) blur(14px)', bgcolor: (t) => alpha(t.palette.background.default, 0.45),
          }}>
            {isMobile && <IconButton onClick={() => setMobileOpen(true)}><MenuIcon /></IconButton>}
            <ModelPicker requestOpen={pickerReq} models={models} value={settings.model} freeOnly={settings.freeOnly} loading={modelsLoading} status={provStatus}
              myModels={settings.myModels}
              onSaveMyModel={(m) => setSettings((s) => ({ ...s, myModels: s.myModels.some((x) => x.id === m.id) ? s.myModels.map((x) => (x.id === m.id ? m : x)) : [m, ...s.myModels] }))}
              onDeleteMyModel={(id) => kbDeleteAll(id) && setSettings((s) => ({ ...s, myModels: s.myModels.filter((x) => x.id !== id), model: s.model?.id === id ? null : s.model }))}
              onChange={(model) => setSettings((s) => ({ ...s, model }))} onRefresh={() => loadModels(true)} />
            {/* Chat title ⌄ — Pin · Rename · Add to project · Share · Archive · Delete */}
            {chat.messages.length > 0 && !isMobile && (
              <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, ml: 1, pl: 1.5, borderLeft: 1, borderColor: 'divider' }}>
                {chatProject && (
                  <ButtonBase onClick={() => setActiveProject(chatProject.id)} sx={{ fontSize: 14, color: 'text.secondary', borderRadius: 1, px: 0.5, flexShrink: 0, '&:hover': { color: 'text.primary' } }}>
                    {chatProject.name}<Box component="span" sx={{ mx: 0.75 }}>/</Box>
                  </ButtonBase>
                )}
                {titleEdit !== null ? (
                  <InputBase autoFocus value={titleEdit} onChange={(e) => setTitleEdit(e.target.value)}
                    onBlur={() => { chatAction(chat.id, 'renameTo', titleEdit.trim()); setTitleEdit(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setTitleEdit(null); }}
                    sx={{ fontSize: 15, fontWeight: 500, minWidth: 220, px: 0.75, borderRadius: 1, bgcolor: 'action.hover' }} />
                ) : (
                  <ButtonBase onClick={(e) => setTitleMenu(e.currentTarget)} sx={{
                    gap: 0.5, px: 0.75, py: 0.5, borderRadius: '10px', minWidth: 0, bgcolor: titleMenu ? 'action.selected' : 'transparent', '&:hover': { bgcolor: 'action.hover' },
                  }}>
                    <Typography noWrap sx={{ fontSize: 15, fontWeight: 500, maxWidth: 320 }}>{chat.title}</Typography>
                    <KeyboardArrowDownIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                  </ButtonBase>
                )}
              </Box>
            )}
            <ChatMenu anchorEl={titleMenu} open={!!titleMenu} chat={chat} projects={projects} onClose={() => setTitleMenu(null)}
              onAction={(type, value) => (type === 'rename' ? setTitleEdit(chat.title) : chatAction(chat.id, type, value))} />
            {warming && (
              <Tooltip title="Loading the model into memory and pre-reading its instructions — after this, replies start fast.">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.4, borderRadius: '999px', bgcolor: 'action.hover', fontSize: 12.5, color: 'text.secondary' }}>
                  <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#f59e0b', animation: 'pulse 1s ease-in-out infinite', '@keyframes pulse': { '50%': { opacity: 0.3 } } }} />
                  Preparing model…
                </Box>
              </Tooltip>
            )}
            <Box sx={{ flex: 1 }} />
            {isMobile && <Tooltip title="New chat"><IconButton onClick={startNew}><AddCommentOutlinedIcon /></IconButton></Tooltip>}
            {chat.messages.length > 0 && (
              <Button size="small" color="inherit" startIcon={<IosShareIcon sx={{ fontSize: '18px !important' }} />} onClick={() => setShareId(chat.id)}
                sx={{ borderRadius: '10px', px: 1.5, fontSize: 14, display: { xs: 'none', sm: 'inline-flex' } }}>Share</Button>
            )}
            <Tooltip title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
              <IconButton onClick={() => setSettings((s) => ({ ...s, theme: mode === 'dark' ? 'light' : 'dark' }))}>
                {mode === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Settings (Ctrl+Shift+,)"><IconButton onClick={() => openSettings('general')}><SettingsOutlinedIcon /></IconButton></Tooltip>
          </Box>

          <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {chat.messages.length === 0 ? (
                /* Empty chat: centered greeting + composer + quick chips (modern layout) */
                <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', px: 2, py: 3 }}>
                  <Box sx={{ width: '100%', maxWidth: 720, animation: 'fadeUp .4s ease both' }}>
                    {modelErr && <Alert severity="warning" sx={{ mb: 2, borderRadius: '12px' }}>{modelErr}</Alert>}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, mb: 1 }}>
                      <LogoMark size={38} />
                      <Typography component="h1" sx={{ fontSize: { xs: 24, sm: 30 }, fontWeight: 600, letterSpacing: '-0.02em' }}>
                        {greeting(profile.callMe || profile.name?.split(' ')[0])}
                      </Typography>
                    </Box>
                    <Typography color="text.secondary" sx={{ textAlign: 'center', mb: 3, fontSize: 14 }}>
                      {modelsLoading ? 'Loading models…' : `${models.length} models ready · ${models.filter((m) => m.free).length} free · Tamil, Tanglish & English`}
                    </Typography>
                    {composer}
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 1, mt: 2 }}>
                      {STARTERS.map(({ t, label, Icon }) => (
                        <ButtonBase key={label} onClick={() => settings.model && send({ text: t, images: [], files: [] })}
                          sx={{
                            gap: 0.75, px: 1.5, py: 0.75, borderRadius: '999px', border: 1, borderColor: 'divider', fontSize: 13.5,
                            color: 'text.secondary', bgcolor: (t) => (t.palette.mode === 'light' ? 'rgba(255,255,255,.6)' : 'rgba(30,30,46,.55)'), backdropFilter: 'blur(14px)', transition: 'all .2s', animation: 'fadeUp .5s ease both',
                            '&:hover': { color: 'primary.main', borderColor: 'primary.main', transform: 'translateY(-2px)', boxShadow: (t) => `0 8px 20px -10px ${alpha(t.palette.primary.main, 0.6)}` },
                          }}>
                          <Icon sx={{ fontSize: 17 }} /> {label}
                        </ButtonBase>
                      ))}
                    </Box>
                  </Box>
                </Box>
              ) : (
                <>
                  <Box ref={scrollRef} onScroll={onScroll} sx={{ flex: 1, overflowY: 'auto' }}>
                    <Box sx={{ maxWidth: 780, mx: 'auto', px: 2, pt: 3, pb: 2 }}>
                      {modelErr && <Alert severity="warning" sx={{ mb: 2, borderRadius: '12px' }}>{modelErr}</Alert>}
                      {chat.messages.map((m, i) => (
                        <Message key={m.id} m={m} isLast={i === chat.messages.length - 1} fontSize={settings.fontSize} baseFiles={projectBase[i]}
                          onAsk={(q) => !streaming && send({ text: q, images: [], files: [] })}
                          streaming={streaming} onEdit={edit} onRegenerate={regenerate}
                          onFeedback={(v, extra) => giveFeedback(m, v, extra)}
                          onPreview={(code, lang, title, files) => setPreview({ code: code || '', lang, title, files })} />
                      ))}
                    </Box>
                  </Box>
                  <Box sx={{ maxWidth: 780, width: '100%', mx: 'auto', px: 2, pb: 1.5, pt: 0.5, position: 'relative' }}>
                    {showJump && (
                      <Tooltip title="Jump to latest">
                        <IconButton onClick={jumpToLatest} sx={{
                          position: 'absolute', top: -52, left: '50%', transform: 'translateX(-50%)', zIndex: 3,
                          bgcolor: 'background.paper', border: 1, borderColor: 'divider', boxShadow: '0 4px 14px rgba(0,0,0,.12)', '&:hover': { bgcolor: 'background.paper' },
                        }}><KeyboardArrowDownIcon /></IconButton>
                      </Tooltip>
                    )}
                    {composer}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 0.75, fontSize: 11.5 }}>
                      AI can make mistakes. Check important info.
                    </Typography>
                  </Box>
                </>
              )}
            </Box>
            <PreviewPanel preview={preview} onClose={() => setPreview(null)}
              onFix={(errors, isProject) => { if (streaming) return; setPreview(null); send({ text: isProject ? fixRequest(errors) : `The preview of your code shows these errors:

${errors}

Fix them and give the complete corrected code.`, images: [], files: [] }); }} />
          </Box>
        </Box>
      </Box>

      <UsageDialog open={usageOpen} onClose={() => setUsageOpen(false)} />
      <SearchDialog open={panel === 'search'} onClose={() => setPanel(null)} chats={chats} onNew={() => startNew(null)}
        onOpen={(id) => { setActiveId(id); setPreview(null); setMobileOpen(false); }} />
      <ProjectsDialog open={panel === 'projects'} onClose={() => setPanel(null)} projects={projects} chats={chats}
        onOpen={(pid) => { setActiveProject(pid); const first = chats.find((c) => c.projectId === pid && !c.archived && c.messages.length); if (first) setActiveId(first.id); else startNew(pid); }}
        onCreate={(name) => { const p = createProject(name); setActiveProject(p.id); startNew(p.id); }} />
      <ArtifactsDialog open={panel === 'artifacts'} onClose={() => setPanel(null)} chats={chats}
        onOpen={(a) => { setActiveId(a.chatId); setPreview({ code: a.code, lang: a.lang, title: a.title }); }} />
      <ShareDialog chat={chats.find((c) => c.id === shareId)} onClose={() => setShareId(null)} />
      <InfoDialog page={infoPage} onClose={() => setInfoPage(null)} />
      <SettingsDialog open={settingsOpen} tab={settingsTab} onClose={() => setSettingsOpen(false)} settings={settings} setSettings={setSettings}
        chats={chats}
        onImport={(list) => setChats((cs) => [...list.map((c) => ({ ...c, id: cs.some((x) => x.id === c.id) ? uid() : c.id })), ...cs])}
        onOpenKeys={() => { setSettingsOpen(false); setPickerReq({ tab: 1, at: Date.now() }); }}
        onOpenUsage={() => { setSettingsOpen(false); setUsageOpen(true); }}
        onClearAll={() => { const c = newChat(); setChats([c]); setActiveId(c.id); }} />
    </ThemeProvider>
  );
}
