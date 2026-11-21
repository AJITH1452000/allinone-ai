# Training Learn (free, on Kaggle)

Learn improves by training only on legal data: its own verified answers, your 👍 / ✏️, your own code, and permissively licensed open-source code (MIT, Apache-2.0, BSD, ISC). It never trains on answers from Claude, GPT, Gemini or any other online AI.

## Once

```bash
npm run add-my-code -- "E:\my-project"   # your own code → Learn's style
npm run fetch-open-code                  # MUI / Recharts / Vite examples (licences checked)
npm run get-datasets                     # commitpackft bug-fix commits + MUI + Recharts
npm run load-docs                        # React / MUI / Vite / Recharts docs for code answers
```

## Every day

Use Evolvix normally and press 👍 / 👎 / ✏️ under Learn's answers. Your corrections count twice.

## At night

```bash
npm run dev          # keep the app running
npm run self-train   # Learn practises; only verified answers are kept (resumable)
```

## Weekly

```bash
npm run clean-data      # → data/training/train.jsonl + train-pairs.jsonl
npm run make-notebook   # → training/kaggle/learn_selftrain.ipynb
```

1. On Kaggle, upload `train.jsonl` and `train-pairs.jsonl` as a new dataset.
2. Import the notebook, add that dataset as input, and set the accelerator to **GPU T4 x2**.
3. Press **Run all**, then download `learn-codeplus.Q4_K_M.gguf` from the Output tab.
4. Back on your PC:

   ```bash
   npm run import-model -- "C:\Downloads\learn-codeplus.Q4_K_M.gguf"
   ```

   This runs the exam automatically. Learn Code+ becomes your default model only if it scores higher than Learn.

## Files

| File | What it is |
|---|---|
| `kaggle/learn_selftrain.py` | The training code. It runs on Kaggle (Python is installed there); you don't need Python on your PC. |
| `config.json` | Training settings: base model, LoRA, epochs, DPO |
| `tasks.json` | Practice tasks for self-train. The 40 exam tasks in `eval/mywork` are never used for training. |
| `sources.json` | Open-source repositories to learn from (each one's licence is checked) |
| `old/` | The earlier public-dataset notebook (archived) |
