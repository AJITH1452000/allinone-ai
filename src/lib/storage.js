export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const newChat = () => ({ id: uid(), title: 'New chat', messages: [], pinned: false, createdAt: Date.now() });

const CHATS = 'aio-chats';
const SETTINGS = 'aio-settings';

export const DEFAULT_SETTINGS = {
  theme: 'light',
  personaId: 'default',
  customSystem: '',
  lang: 'auto',
  temperature: 0.7,
  maxTokens: 2048,
  memory: 10,      // how many recent messages are sent with each request
  concise: true,   // ask the model for short answers
  model: null,
  freeOnly: false,
  myModels: [],
  profile: {},       // { name, callMe, work } — local only
  onboarded: false,  // false → show the welcome screen once
  signedOut: false,
  fontSize: 'default',
  enterToSend: true,
  webSearch: 'auto', // auto = search the web when the question needs fresh facts
  reasoning: 'balanced', // fast / balanced / expert
  tools: 'auto',     // auto = calculator, date, memory… when the message needs them; off = never
  allowCode: false,  // let the AI run JavaScript in a sandbox (you turn this on)
  memoryOn: true,    // long-term memory of facts you ask the AI to remember
  memories: [],      // [{ id, text, at }]
  autoSpeak: false,  // read every reply aloud
  bigJobs: 'auto',   // full projects use a connected free online model (Gemini / Groq / OpenRouter) instead of the local one
  v: 2,
};

const read = (k, fb) => {
  try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fb; } catch { return fb; }
};
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
};

export const loadChats = () => {
  const c = read(CHATS, null);
  return Array.isArray(c) && c.length ? c : [newChat()];
};
export const saveChats = (chats) => {
  if (write(CHATS, chats)) return;
  // Storage full: drop image data from older chats and retry
  const slim = chats.map((c, i) => (i < 3 ? c : {
    ...c, messages: c.messages.map((m) => ({ ...m, images: [] })),
  }));
  write(CHATS, slim);
};
export const loadSettings = () => {
  const saved = read(SETTINGS, {});
  // v2: lower the old 8192 output limit to the new token-saving default
  if (!saved.v && saved.maxTokens === 8192) saved.maxTokens = DEFAULT_SETTINGS.maxTokens;
  return { ...DEFAULT_SETTINGS, ...saved, v: 2 };
};
export const saveSettings = (s) => write(SETTINGS, s);

// ---------- Projects (group related chats) ----------
const PROJECTS = 'aio-projects';
export const loadProjects = () => { const p = read(PROJECTS, []); return Array.isArray(p) ? p : []; };
export const saveProjects = (p) => write(PROJECTS, p);
