# All-in-One AI ✨

A Claude-style chat app that brings every AI model into one place.
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
