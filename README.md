# Evolvix

A Claude-style chat app that brings every AI model into one place.

**Live:** https://evolvix-wheat.vercel.app

React + Vite + MUI frontend, Node/Express backend.

## Features
- All providers in one model picker: Ollama (local), OpenRouter, Groq, Gemini, Cerebras, Mistral, Claude, OpenAI, DeepSeek
- FREE badge + "free models only" filter
- Answers appear word by word, with a Stop button
- "Thinking" panel for reasoning models (DeepSeek-R1, Qwen3 …)
- Upload images (vision models), code and text files; drag & drop; paste screenshots
- Voice input (English / Tamil) and read-aloud answers
- Tamil / Tanglish / English reply modes
- 9 personas (React expert, TNPSC tutor, Resume coach, Translator …) + custom instructions
- Edit a message and resend, regenerate, copy
- Code highlighting + live HTML/SVG preview panel
- Chat search, pin, rename, delete, export to Markdown
- Dark mode, mobile layout, chats saved in the browser

## Intelligence engines
| Engine | What it does | Where |
|---|---|---|
| Reasoning | ⚡ Fast / ⚖️ Balanced / 🧠 Expert. Expert plans step by step, then a second pass checks the answer for errors | Message box chip · `engines.js` |
| Math | Exact calculator (no guessing): + − × ÷ ^ % ! mod, sqrt, log, trig, round, nCr… | Tool `calculator` |
| Tool calling | Agent loop (max 10 steps / 120 s): calculator, date & day counter, web search, memory, code runner. Only runs when a message needs it, so normal chat stays fast | `server.js` · `engines.js` |
| Code execution | JavaScript in a locked Node sandbox — no files, no programs, 5 s, 64 MB. **Off by default** (+ menu → Run code) | Tool `run_javascript` |
| Memory | Long-term facts ("remember that I prefer TypeScript"), added to every chat. View / delete in Settings → Memory | `personas.js` |
| Knowledge | Your files (RAG) per assistant + live web search with source links | `kb.js` · `search.js` |
| Multilingual | Tamil, Tanglish, English replies; Tamil voice for read-aloud | Learn models · `speech.js` |
| Safety | Prompt-injection guard on web pages, files and documents; warning on dangerous code (rm -rf, format, curl \| sh…); warning before sending passwords/API keys to a cloud AI; invented links are struck out | `engines.js` · `Message.jsx` |
| Speech | Voice input + read-aloud (stop button, Tamil/English voices, optional auto-read) | `speech.js` |
| Evaluation | 43 tests in 11 categories through the real pipeline; per-category score + regression check vs the last run | `eval/` |

### Evaluate a model
```bash
npm run dev                                   # keep the app running
npm run eval -- learn-pro                     # all tests
npm run eval -- learn-max --mode expert       # Expert reasoning mode
npm run eval -- learn-code --only programming,tool_usage
```
Results are saved in `eval/results/`. Run it again after changing `models/system.md` or a Modelfile — it shows which tests got better or broke.

## Setup
```bash
npm install
# edit .env and add any keys you have (all optional)
npm run dev        # open http://localhost:5173
```

## FREE + UNLIMITED (recommended)
1. Install Ollama: https://ollama.com
2. Pull models:
   ```bash
   ollama pull qwen3          # smart, has thinking
   ollama pull llama3.2       # fast
   ollama pull gemma3         # can read images
   ollama pull qwen2.5-coder  # coding
   ```
3. Run `npm run dev`. The models appear under "Ollama · Local".
   No key, no limits, works offline. Speed depends on your PC (8 GB+ RAM; a GPU helps).

## Free cloud tiers (with daily limits)
Get keys from OpenRouter, Groq, Google AI Studio, Cerebras or Mistral (links are in `.env`).

## Production
```bash
npm run build && npm start   # http://localhost:3001
```
Never put API keys in the frontend; they stay in `.env` on the server.
