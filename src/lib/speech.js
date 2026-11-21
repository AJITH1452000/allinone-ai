// Speech output (text-to-speech) using the browser's built-in voices — free and offline in Edge/Chrome.
const clean = (t = '') => t
  .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
  .replace(/<artifact\b[\s\S]*?(<\/artifact>|$)/gi, ' (code shown on screen) ')
  .replace(/```[\s\S]*?(```|$)/g, ' (code shown on screen) ')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → their text
  .replace(/https?:\/\/\S+/g, '')
  .replace(/[#*`>_|~]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

let current = null;
export const isSpeaking = () => !!current && window.speechSynthesis?.speaking;

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
  current = null;
}

/** Speaks text; returns a promise that resolves when it finishes or is stopped. */
export function speak(text, { onEnd } = {}) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const said = clean(text);
  if (!said) return;
  const tamil = /[஀-௿]/.test(said);
  const lang = tamil ? 'ta-IN' : 'en-IN';
  const voices = synth.getVoices();
  const voice = voices.find((v) => v.lang === lang && /natural|online/i.test(v.name))
    || voices.find((v) => v.lang === lang)
    || voices.find((v) => v.lang.startsWith(tamil ? 'ta' : 'en') && /natural|online/i.test(v.name))
    || voices.find((v) => v.lang.startsWith(tamil ? 'ta' : 'en'));
  // Long text is split into sentences — browsers stop long single utterances early
  const parts = said.match(/[^.!?।\n]+[.!?।]?/g) || [said];
  const id = {};
  current = id;
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p.trim());
    u.lang = lang;
    if (voice) u.voice = voice;
    u.rate = 1.02;
    if (i === parts.length - 1) u.onend = () => { if (current === id) current = null; onEnd?.(); };
    synth.speak(u);
  });
}
