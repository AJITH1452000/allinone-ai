"""
train_learn_master.py — fine-tune Qwen2.5-Coder-1.5B into "Learn Master" (full-stack coding: React, JavaScript, TypeScript,
HTML, CSS, Tailwind CSS, Python, PHP + npm / pip / composer package answers) and export GGUF + an Ollama Modelfile.

Runs on Windows through WSL2 (Ubuntu) with an NVIDIA GPU (tested settings for RTX 3050 4 GB + 16 GB RAM), or on Kaggle.

  # one-time, inside WSL2 (Ubuntu):
  pip install "unsloth" "trl" "datasets" "transformers" "accelerate"

  python train_learn_master.py --mode legal      # A: human-written data + your own data only (default)
  python train_learn_master.py --mode full       # B: also the GPT-4 / AI-generated instruction datasets (see note)
  python train_learn_master.py --mode legal --max-steps 50     # quick test run

Data
  A (legal) — bigcode/commitpackft: real GitHub commits (human-written, permissive licences) in JavaScript, TypeScript,
      Python, PHP, HTML, CSS; plus your own data from Evolvix if present (data/training/train.jsonl from npm run clean-data:
      your 👍 / ✏️ answers, Learn's verified answers, your code, MIT open-source code).
  B (full) — A plus: m-a-p/CodeFeedback-Filtered-Instruction, ise-uiuc/Magicoder-Evol-Instruct-110K,
      cfahlgren1/react-code-instructions, OpenCoder-LLM/opc-sft-stage2.
      ⚠ These were largely written by AI models (CodeFeedback and Magicoder by GPT-4). OpenAI's terms forbid using
        its output to develop competing models. Choosing --mode full is your decision and responsibility.

Output (never overwrites your main "learn" model):
  learn_master_gguf/*.gguf + learn_master_gguf/Modelfile →  ollama create learn-master -f learn_master_gguf/Modelfile
"""
import argparse, glob, json, os, random, re, shutil

ap = argparse.ArgumentParser()
ap.add_argument("--mode", choices=["legal", "full"], default="legal")
ap.add_argument("--max-steps", type=int, default=400)
ap.add_argument("--own-data", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "training", "train.jsonl"))
ap.add_argument("--out", default="learn_master_gguf")
args = ap.parse_args()
random.seed(42)

SYSTEM = ("You are Learn, an elite coding and technical assistant. Start immediately with the exact code or answer in the "
          "first sentence without greetings or filler. When asked for packages or libraries (e.g., npm, pip, composer), output "
          "a categorized Markdown Table of modern, actively maintained packages with their use cases, followed by exact "
          "installation commands. Never suggest deprecated packages. Output complete, clean, production-ready code when requested.")

# ---------- filters ----------
BAD_PATTERNS = ("require('request')", 'require("request")', "var ", "React.createClass")
STACK = re.compile(r"\b(react|jsx|tsx|javascript|typescript|node|npm|yarn|pnpm|vite|next\.?js|html|css|tailwind|python|pip|django|flask|"
                   r"fastapi|pandas|php|composer|laravel|mysql|sql|express|api|frontend|backend|web)\b", re.I)
def keep(user, answer):
    if not user or not answer: return False
    if len(answer) >= 3000 or len(user) >= 4000: return False
    if any(p in answer for p in BAD_PATTERNS): return False
    return True
def chat(user, answer, source):
    return {"messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user.strip()},
                         {"role": "assistant", "content": answer.strip()}], "source": source}

from datasets import load_dataset, Dataset
rows = []

def add_hf(name, split, user_key, answer_key, config=None, stack_only=True, limit=None):
    """Load a Hugging Face dataset, keep rows about our stack, normalise to ChatML."""
    try:
        ds = load_dataset(name, config, split=split) if config else load_dataset(name, split=split)
    except Exception as e:
        print(f"  ✘ {name}{'/' + config if config else ''}: {e}"); return
    n = 0
    for r in ds:
        if "messages" in r and r["messages"]:                    # already a conversation
            msgs = r["messages"]
            u = next((m["content"] for m in msgs if m.get("role") == "user"), "")
            a = next((m["content"] for m in reversed(msgs) if m.get("role") == "assistant"), "")
        else:
            u, a = str(r.get(user_key) or ""), str(r.get(answer_key) or "")
        if stack_only and not STACK.search(u + " " + a): continue
        if not keep(u, a): continue
        rows.append(chat(u, a, name)); n += 1
        if limit and n >= limit: break
    print(f"  ✔ {name}{'/' + config if config else ''}: {n} examples")

# ---------- A: human-written bug fixes (commitpackft) ----------
print("A · human-written commits (bigcode/commitpackft)")
FIX = re.compile(r"\b(fix|bug|error|crash|broken|wrong|issue|handle|support|add|update|refactor)\b", re.I)
for lang, lim in [("javascript", 3000), ("typescript", 2000), ("python", 3000), ("php", 2000), ("html", 800), ("css", 800)]:
    try:
        ds = load_dataset("json", data_files=f"hf://datasets/bigcode/commitpackft/data/{lang}/data.jsonl", split="train")
    except Exception as e:
        print(f"  ✘ commitpackft/{lang}: {e}"); continue
    n = 0
    for r in ds:
        old, new, msg = r.get("old_contents") or "", r.get("new_contents") or "", (r.get("subject") or "").strip()
        if not old or not new or old == new or not FIX.search(msg) or len(old) > 2500 or len(new) > 2800: continue
        if str(r.get("license", "")).lower() not in ("mit", "apache-2.0", "bsd-3-clause", "bsd-2-clause", "isc", "unlicense"): continue
        fence = {"javascript": "js", "typescript": "ts", "python": "python", "php": "php", "html": "html", "css": "css"}[lang]
        u = f"{msg}\n\n```{fence}\n{old.rstrip()}\n```"
        a = f"```{fence}\n{new.rstrip()}\n```"
        if keep(u, a): rows.append(chat(u, a, f"commitpackft/{lang}")); n += 1
        if n >= lim: break
    print(f"  ✔ commitpackft/{lang}: {n} examples")

# ---------- your own data from Evolvix (npm run clean-data) ----------
if os.path.exists(args.own_data):
    n = 0
    for line in open(args.own_data, encoding="utf-8"):
        try: ex = json.loads(line)
        except Exception: continue
        msgs = [m for m in ex.get("messages", []) if m.get("role") in ("user", "assistant")]
        if len(msgs) >= 2 and msgs[-1]["role"] == "assistant":
            rows.append({"messages": [{"role": "system", "content": SYSTEM}] + msgs, "source": ex.get("source", "own")}); n += 1
    print(f"  ✔ your own Evolvix data: {n} examples")
else:
    print("  · no data/training/train.jsonl yet (run: npm run clean-data) — continuing without it")

# ---------- B: the AI-generated instruction datasets (only with --mode full) ----------
if args.mode == "full":
    print("B · AI-generated instruction datasets (your choice — see the note at the top)")
    add_hf("m-a-p/CodeFeedback-Filtered-Instruction", "train[:25000]", "query", "answer")
    add_hf("ise-uiuc/Magicoder-Evol-Instruct-110K", "train[:20000]", "instruction", "response")
    add_hf("cfahlgren1/react-code-instructions", "train[:5000]", "instruction", "output", stack_only=False)
    for cfg in ("package_instruct", "educational_instruct", "evol_instruct"):
        add_hf("OpenCoder-LLM/opc-sft-stage2", "train[:5000]", "instruction", "output", config=cfg)

# ---------- dedupe + shuffle ----------
seen, data = set(), []
for r in rows:
    k = (r["messages"][-2]["content"][:300], r["messages"][-1]["content"][:300])
    if k in seen: continue
    seen.add(k); data.append(r)
random.shuffle(data)
print(f"\nTotal: {len(data)} examples ({args.mode} mode)")
if not data: raise SystemExit("No training data — check your internet connection / Hugging Face access.")

# ---------- train (memory-safe for a 4 GB GPU) ----------
from unsloth import FastLanguageModel
from trl import SFTTrainer, SFTConfig
import inspect, torch

model, tokenizer = FastLanguageModel.from_pretrained("unsloth/Qwen2.5-Coder-1.5B-Instruct", max_seq_length=1024, load_in_4bit=True, dtype=None)
model = FastLanguageModel.get_peft_model(model, r=8, lora_alpha=16, lora_dropout=0, bias="none",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth", random_state=42)
ds = Dataset.from_list([{"text": tokenizer.apply_chat_template(r["messages"], tokenize=False)} for r in data])

bf16 = torch.cuda.is_bf16_supported()
kw = dict(output_dir="learn_master_checkpoints", per_device_train_batch_size=1, gradient_accumulation_steps=8,
          max_steps=args.max_steps, learning_rate=2e-4, optim="adamw_8bit", warmup_steps=10, logging_steps=10,
          lr_scheduler_type="cosine", weight_decay=0.01, fp16=not bf16, bf16=bf16, seed=42, report_to="none",
          dataset_text_field="text", packing=False, dataset_num_proc=1, save_strategy="no")
sig = inspect.signature(SFTConfig.__init__).parameters      # TRL renamed options between versions
kw["max_seq_length" if "max_seq_length" in sig else "max_length"] = 1024
kw = {k: v for k, v in kw.items() if k in sig or k in ("max_seq_length", "max_length")}
tok_arg = "processing_class" if "processing_class" in inspect.signature(SFTTrainer.__init__).parameters else "tokenizer"
trainer = SFTTrainer(model=model, train_dataset=ds, args=SFTConfig(**kw), **{tok_arg: tokenizer})
trainer.train()

# ---------- export GGUF q4_k_m + Ollama Modelfile ----------
model.save_pretrained_gguf(args.out, tokenizer, quantization_method="q4_k_m")
ggufs = sorted(glob.glob(f"{args.out}/**/*.gguf", recursive=True) + glob.glob("*.gguf"), key=os.path.getsize)
if not ggufs: raise SystemExit("GGUF export failed — no .gguf file was written.")
final = os.path.join(args.out, "learn-master.Q4_K_M.gguf")
if os.path.abspath(ggufs[-1]) != os.path.abspath(final): shutil.move(ggufs[-1], final)
with open(os.path.join(args.out, "Modelfile"), "w", encoding="utf-8") as f:
    f.write(f'FROM ./learn-master.Q4_K_M.gguf\n\nPARAMETER temperature 0.2\nPARAMETER top_p 0.9\nPARAMETER repeat_penalty 1.1\n'
            f'PARAMETER num_ctx 8192\n\nSYSTEM """\n{SYSTEM}\n"""\n')
print(f"\n✔ {final}\n✔ {args.out}/Modelfile\n\nCreate it in Ollama (separate from your main model):\n"
      f"  cd {args.out} && ollama create learn-master -f Modelfile\n"
      "Then test it against Learn on your exam:  npm run eval -- learn-master --suite mywork --sample 2")
