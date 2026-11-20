// Instant, rule-based chat titles (like Claude's "Greeting", "Pongal Festival Date").
// Cloud models can improve them afterwards via /api/title.

const SMALLTALK = /^\s*(hi+|hello+|hey+|hai|vanakkam|வணக்கம்|how (are|r) (you|u)|how('s| is) it going|what'?s up|good (morning|afternoon|evening|night)|thanks?|thank you|nandri|நன்றி|எப்படி இருக்கீங்க|நலமா|eppadi irukeenga|epdi iruka)(?=$|[\s!.?,])/i;
const FILLER = /^(please |pls |kindly |hey |hi |ok(ay)? |so |can you |could you |would you |will you |i want( you)? to |i need( you)? to |i want |i need |help me( to)? |tell me( about)? |explain( to me)?( about)? |describe |give me |show me |what is |what are |what's |who is |who was |who are |write( me)?( a| an)? |make( me)?( a| an)? |create( a| an)? |build( a| an)? |generate( a| an)? |list( the)? )+/i;
const TRAILING = /\s*(with (simple |some |an? )?examples?|with (full|complete) code|in detail|in simple (words|terms)|step by step|for me|please|pls|now|asap)\s*$/i;
const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with', 'by', 'at', 'vs', 'from']);

const caseWord = (w, i) => {
  // keep acronyms, Tamil, camelCase and plain numbers as typed
  if (/[A-Z]{2,}|[஀-௿]/.test(w) || /[a-z][A-Z]/.test(w) || /^[\d.,:%+]+$/.test(w)) return w;
  const lw = w.toLowerCase();
  if (i > 0 && SMALL_WORDS.has(lw)) return lw;
  return lw.replace(/(^|[.\-/])(\p{L})/gu, (_, p, c) => p + c.toUpperCase()); // "c.joseph" → "C.Joseph", "7-day" → "7-Day"
};

export function quickTitle(text = '', { hasImages, fileName } = {}) {
  const raw = text.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return fileName ? fileName.replace(/\.[^.]+$/, '') : hasImages ? 'Image Question' : 'New chat';
  if (SMALLTALK.test(raw) && raw.split(' ').length <= 6) return 'Greeting';
  let t = raw.split(/[?!\n]|\.\s/)[0] || raw; // first sentence (the dot in "C.Joseph" is not an end)
  t = t.replace(FILLER, '').replace(TRAILING, '').replace(/^(a|an|the) /i, '')
    .replace(/^(simple|quick|short|basic|small|good|nice) /i, '').trim();
  if (!t) t = raw;
  const words = t.split(' ').filter(Boolean).slice(0, 8);
  while (words.length > 1 && SMALL_WORDS.has(words[words.length - 1].toLowerCase())) words.pop(); // never end on "with"
  const title = words.map(caseWord).join(' ').replace(/[,:;\-–]+$/, '');
  return title.length > 60 ? `${title.slice(0, 57).replace(/\s+\S*$/, '')}…` : title;
}
