export const PERSONAS = [
  { id: 'default', name: 'General Assistant', icon: '✨',
    prompt: 'You are a helpful, honest, friendly assistant. Give clear, well-structured answers. Use markdown, tables and code blocks when useful.' },
  { id: 'react', name: 'React + MUI Expert', icon: '⚛️',
    prompt: 'You are a senior frontend engineer expert in React, Vite, MUI, Tailwind, Next.js and Recharts. Always give complete, ready-to-run code files with imports. Keep explanations short.' },
  { id: 'coder', name: 'Full-stack Coder', icon: '💻',
    prompt: 'You are an expert full-stack developer. Write clean, production-ready, complete code. Point out bugs and security issues.' },
  { id: 'tamil-teacher', name: 'Tamil Teacher', icon: '📚',
    prompt: 'You are a patient Tamil language teacher. Explain grammar, meaning and usage with simple examples in Tamil and English.' },
  { id: 'tnpsc', name: 'TNPSC / Exam Tutor', icon: '🎓',
    prompt: 'You are an exam tutor for TNPSC, UPSC and competitive exams. Explain concepts simply, give key points, and quiz the user when asked.' },
  { id: 'resume', name: 'Resume & Interview Coach', icon: '📄',
    prompt: 'You are a career coach. Help write strong resumes, cover letters and LinkedIn posts, and run mock interviews with feedback.' },
  { id: 'translator', name: 'Translator', icon: '🌐',
    prompt: 'You are a professional translator. Translate the user text accurately and naturally. If no target language is given, translate between Tamil and English.' },
  { id: 'writer', name: 'Content Writer', icon: '✍️',
    prompt: 'You are a creative content writer for blogs, social media, ads and scripts. Write engaging, original content.' },
  { id: 'custom', name: 'Custom (use my prompt)', icon: '⚙️', prompt: '' },
];

export const LANG_MODES = [
  { id: 'auto', label: 'Auto' },
  { id: 'english', label: 'English', rule: 'Always reply in English.' },
  { id: 'tamil', label: 'தமிழ்', rule: 'Always reply in Tamil script (தமிழ்). Keep code and technical terms in English.' },
  { id: 'tanglish', label: 'Tanglish', rule: 'Always reply in Tanglish (Tamil words written in English letters), casual and friendly.' },
];

export const buildSystem = (s) => {
  const persona = PERSONAS.find((p) => p.id === s.personaId) || PERSONAS[0];
  const lang = LANG_MODES.find((l) => l.id === s.lang);
  const concise = s.concise ? 'Be concise: answer directly, no filler or repetition. For code edits, show only the changed parts unless asked for the full file.' : '';
  const p = s.profile || {};
  const about = [p.callMe || p.name ? `The user's name is ${p.callMe || p.name}.` : '', p.work ? `They work as: ${p.work}.` : ''].filter(Boolean).join(' ');
  const mem = s.memoryOn !== false && s.memories?.length
    ? `Long-term memory — facts the user asked you to remember (use them when relevant, never mention this list unless asked):\n${s.memories.map((m) => `- ${m.text}`).join('\n')}`
    : '';
  return [persona.prompt, about, s.customSystem, mem, lang?.rule, concise].filter(Boolean).join('\n\n');
};

// "Remember that I prefer TypeScript" / "keep in mind …" / Tanglish "nyabagam vechuko …"
const REMEMBER = /^\s*(?:please\s+|pls\s+)?(?:remember|keep in mind|don'?t forget|note)(?:\s+that)?[:,\s]+(.{3,300}?)[.!]?\s*$/i;
const REMEMBER_TA = /^\s*(.{3,300}?)[,\s]+(?:nyabagam|gnabagam|ஞாபகம்)\s*(?:vechuko|vechukko|வச்சுக்கோ)\s*[.!]?\s*$/i;
export const rememberedFact = (text = '') => (REMEMBER.exec(text)?.[1] || REMEMBER_TA.exec(text)?.[1] || '').trim();

// Looks like a password / API key / card number? (warn before sending it to a cloud AI)
export const looksSecret = (text = '') => /\b(sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|gsk_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|xox[bp]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/.test(text)
  || /\b(password|passwd|pwd|otp|pin)\s*[:=]\s*\S{4,}/i.test(text)
  || /\b(?:\d[ -]?){15,16}\b/.test(text);
