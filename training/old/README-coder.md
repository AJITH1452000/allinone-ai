# Train Learn Code+ (your own fine-tuned coder)

Fine-tunes **Qwen2.5-Coder-7B** (the base of Learn Code) on licence-checked coding data, on a **free Kaggle GPU**,
then brings it back into Evolvix as **Learn Code+**. Your laptop's 4 GB GPU can't train a 7B model; Kaggle's T4 (16 GB) can.

## 1 · One-time setup
1. Make a free account at **kaggle.com** and verify your phone number (needed for GPU + internet).
2. Pick where trained models are archived (your external disk when you have it):
   ```bash
   npm run storage -- E:        # → E:\EvolvixAI\{datasets,checkpoints,models,eval,my-data}
   ```
   Until then it uses `D:\EvolvixAI`.

## 2 · (Optional) add your own examples
In the app, rate good answers from Learn models with 👍, then **Settings → Data → Export training data**.
On Kaggle: **Datasets → New Dataset** → upload the `evolvix-training-….jsonl` file.

## 3 · Train on Kaggle (~4–6 h, mostly waiting)
1. `npm run make-notebook` → creates `training/kaggle/evolvix_coder.ipynb`.
2. kaggle.com → **Create → New Notebook → File → Import Notebook** → choose that file.
3. Right panel: **Accelerator → GPU T4 x2**, **Internet → On**. *(Optional: **Add Input** → your dataset from step 2.)*
4. **Save Version → Save & Run All (Commit)**. This runs in the background, even if you close the browser.
5. When it's done, open the version → **Output** → download `learn-codeplus/gguf/…Q4_K_M.gguf` (~4.7 GB).
   The output also shows the **coding test score** (unseen problems checked by their real unit tests).

If a session is cut off: the version's output keeps the `checkpoints/` folder — start a new version with that output
added as input and training continues from the last checkpoint.

## 4 · Bring it home
```bash
npm run import-model -- "C:\Users\you\Downloads\unsloth.Q4_K_M.gguf"
```
Copies the file to your storage disk, builds **learn-codeplus** in Ollama, and it appears in the model picker as **Learn Code+**.

## 5 · Prove it's better
```bash
npm run eval -- learn-codeplus --only programming,tool_usage,instruction_following
npm run eval -- learn-codeplus --only programming,tool_usage,instruction_following
```
Keep Learn Code+ only if it scores higher.

## What it trains on (`config.json`)
| Source | Licence | Made by | Used |
|---|---|---|---|
| bigcode/self-oss-instruct-sc2-exec-filter-50k | ODC-By | StarCoder2 (open) | ✅ |
| nvidia/OpenCodeInstruct (only solutions that pass 100 % of their unit tests) | CC-BY-4.0 | Qwen2.5 (open) | ✅ |
| openai/gsm8k (maths reasoning) | MIT | humans | ✅ |
| Magicoder-Evol / Magicoder-OSS / CodeFeedback | MIT / Apache-2.0 | GPT-3.5 / GPT-4 | ⏭ off — set `"use_only_clean_sources": false` to include (OpenAI's terms then apply) |

Pipeline: licence check against an allow-list → remove empty / placeholder / over-long answers → Python code must parse →
exact + near-duplicate removal → sort into your 10 categories (20 % generation, 15 % debugging …) → 96 / 2 / 2 split →
QLoRA (rank 16, all attention + MLP layers) → unseen-problem unit-test score → GGUF Q4_K_M export.

**Size:** ~24 000 examples (≈ 50 MB of text). For fine-tuning, quality beats quantity — 200 GB is pre-training scale
(training a model from scratch on hundreds of GPUs). Raise `total_examples` in `config.json` if a session has time left.
