# %% [markdown]
# # Evolvix · Learn Code+ (High-Parameter 14B Pass · Kaggle Free GPU)
# Fine-tunes **Qwen3-14B** (Unsloth 4-bit QLoRA, r=32, 3 SFT epochs + 2 DPO epochs) on the answers *your* Learn model wrote and the app **verified**
# (`npm run self-train` + the build agent). Output: `learn-codeplus.Q4_K_M.gguf` (~9 GB) + a `Modelfile` for Ollama.
#
# **Before you press "Run all":**
# 1. On your PC run `npm run clean-data`, then take `data/training/` **train.jsonl** and **train-pairs.jsonl** (or lessons.jsonl + pairs.jsonl).
#    Kaggle → **Datasets → New Dataset** → upload both files (any dataset name) → Create.
# 2. In this notebook: right panel → **Add Input** → pick that dataset.
# 3. Right panel → **Session options → Accelerator → GPU T4 x2**, and **Internet → On**.
# 4. **Run all** (about 30–90 min, depending on how many lessons you have).
# 5. When it finishes: **Output** tab → download `learn-codeplus/learn-codeplus.Q4_K_M.gguf`, then on your PC run
#    `npm run import-model -- "C:\path\to\learn-codeplus.Q4_K_M.gguf"`.
#
# Only your own model's verified outputs are used. Never add answers from Claude, GPT, Gemini or other online AIs (their terms forbid it).

# %%
# ① Install (2–4 min)
%%capture
!pip install -q unsloth
!pip install -q --upgrade datasets

# %%
import json, os, re, glob, random, time, inspect
CFG = json.loads(r'''__CONFIG__''')
SYSTEM = json.loads(r'''__SYSTEM__''')        # the same system prompt as models/Modelfile.learn (with system.md)
MODELFILE = json.loads(r'''__MODELFILE__''')  # models/Modelfile.learn, filled in; FROM points at the exported .gguf
random.seed(42)
OUT = '/kaggle/working/learn-codeplus'
os.makedirs(OUT, exist_ok=True)
THINK = re.compile(r'<think(?:ing)?>[\s\S]*?(?:</think(?:ing)?>|$)', re.I)
clean = lambda t: THINK.sub('', str(t or '')).strip()

def find(name):
    hits = glob.glob(f'/kaggle/input/**/{name}', recursive=True)
    return hits[0] if hits else None
def read_jsonl(p):
    rows = []
    for line in open(p, encoding='utf-8') if p else []:
        try: rows.append(json.loads(line))
        except Exception: pass
    return rows

lessons = [r for r in read_jsonl(find('train.jsonl') or find('lessons.jsonl')) if r.get('verified') and r.get('messages')]  # train.jsonl = npm run clean-data
pairs = [r for r in read_jsonl(find('train-pairs.jsonl') or find('pairs.jsonl')) if r.get('prompt') and r.get('chosen') and r.get('rejected')]
assert lessons, 'No lessons.jsonl found — add your dataset with lessons.jsonl as input (right panel → Add Input).'
print(f'Verified lessons: {len(lessons)} · preference pairs: {len(pairs)}')

def convo(r):
    msgs = [{'role': 'system', 'content': SYSTEM}]
    for m in r['messages']:
        if m.get('role') in ('user', 'assistant'): msgs.append({'role': m['role'], 'content': clean(m['content'])})
    return msgs
rows = [convo(r) for r in lessons]
random.shuffle(rows)
n_val = max(1, round(len(rows) * CFG['val_split'])) if len(rows) >= 10 else (1 if len(rows) >= 2 else 0)
val, train = rows[:n_val], rows[n_val:]
print(f'Train {len(train)} · validation {len(val)}  ({100 - round(CFG["val_split"] * 100)}/{round(CFG["val_split"] * 100)} split)')

# %% [markdown]
# ## ② SFT — QLoRA on your verified lessons

# %%
from unsloth import FastLanguageModel, is_bfloat16_supported
from datasets import Dataset
from trl import SFTTrainer, SFTConfig

model, tokenizer = FastLanguageModel.from_pretrained(model_name=CFG['base_model'], max_seq_length=CFG['max_seq_length'], load_in_4bit=True, dtype=None)
model = FastLanguageModel.get_peft_model(model, r=CFG['lora_r'], lora_alpha=CFG['lora_alpha'], lora_dropout=0,
    target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'],
    bias='none', use_gradient_checkpointing='unsloth', random_state=42)

to_text = lambda msgs: tokenizer.apply_chat_template(msgs, tokenize=False)
ds_train = Dataset.from_list([{'text': to_text(m)} for m in train])
ds_val = Dataset.from_list([{'text': to_text(m)} for m in val]) if val else None

kw = dict(output_dir='/kaggle/working/checkpoints', per_device_train_batch_size=1, gradient_accumulation_steps=8,
          num_train_epochs=CFG['epochs'], learning_rate=CFG['learning_rate'], warmup_ratio=0.05, lr_scheduler_type='cosine',
          optim='adamw_8bit', weight_decay=0.01, logging_steps=5, save_strategy='no', report_to='none', seed=42,
          fp16=not is_bfloat16_supported(), bf16=is_bfloat16_supported(), dataset_text_field='text', packing=CFG.get('packing', True),
          per_device_eval_batch_size=1)
sig = inspect.signature(SFTConfig.__init__).parameters   # TRL renamed some options between versions
kw['max_seq_length' if 'max_seq_length' in sig else 'max_length'] = CFG['max_seq_length']
kw['eval_strategy' if 'eval_strategy' in sig else 'evaluation_strategy'] = 'epoch' if ds_val else 'no'
tok_arg = 'processing_class' if 'processing_class' in inspect.signature(SFTTrainer.__init__).parameters else 'tokenizer'
trainer = SFTTrainer(model=model, train_dataset=ds_train, eval_dataset=ds_val, args=SFTConfig(**kw), **{tok_arg: tokenizer})
t0 = time.time()
trainer.train()
print(f'SFT done in {(time.time() - t0) / 60:.0f} min')
if ds_val: print('Validation loss:', round(trainer.evaluate()['eval_loss'], 4))

# %% [markdown]
# ## ③ DPO — only when you have 50+ broken→fixed pairs (prefers the fixed answer)

# %%
if len(pairs) >= CFG['dpo_min_pairs']:
    from unsloth import PatchDPOTrainer
    PatchDPOTrainer()
    from trl import DPOTrainer, DPOConfig
    prompt_of = lambda p: tokenizer.apply_chat_template([{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': p}],
                                                        tokenize=False, add_generation_prompt=True)
    dpo_rows = [{'prompt': prompt_of(r['prompt']), 'chosen': clean(r['chosen']) + tokenizer.eos_token,
                 'rejected': clean(r['rejected']) + tokenizer.eos_token} for r in pairs if clean(r['chosen']) != clean(r['rejected'])]
    dkw = dict(output_dir='/kaggle/working/dpo', per_device_train_batch_size=1, gradient_accumulation_steps=8,
               num_train_epochs=CFG['dpo_epochs'], learning_rate=CFG['dpo_learning_rate'], beta=CFG['dpo_beta'],
               logging_steps=5, save_strategy='no', report_to='none', optim='adamw_8bit', seed=42,
               fp16=not is_bfloat16_supported(), bf16=is_bfloat16_supported(),
               max_length=CFG['max_seq_length'], max_prompt_length=2048)
    dsig = inspect.signature(DPOConfig.__init__).parameters
    dkw = {k: v for k, v in dkw.items() if k in dsig}
    dtok = 'processing_class' if 'processing_class' in inspect.signature(DPOTrainer.__init__).parameters else 'tokenizer'
    dpo = DPOTrainer(model=model, ref_model=None, args=DPOConfig(**dkw), train_dataset=Dataset.from_list(dpo_rows), **{dtok: tokenizer})
    dpo.train()
    print(f'DPO done on {len(dpo_rows)} pairs')
    if ds_val: print('Validation loss after DPO:', round(trainer.evaluate()['eval_loss'], 4))
else:
    print(f'DPO skipped: {len(pairs)} pairs (needs {CFG["dpo_min_pairs"]}+). Keep running npm run self-train to collect more.')

# %% [markdown]
# ## ④ Export for Ollama — `.gguf` (Q4_K_M, ~9 GB for 14B) + Modelfile

# %%
import gc, torch
gc.collect()
if torch.cuda.is_available(): torch.cuda.empty_cache()
FastLanguageModel.for_inference(model)
model.save_pretrained_gguf(f'{OUT}/gguf', tokenizer, quantization_method=CFG['quantization'])
gguf = sorted(glob.glob(f'{OUT}/gguf/*.gguf') + glob.glob(f'{OUT}/*.gguf') + glob.glob('/kaggle/working/*.gguf'), key=os.path.getsize)[-1]
final = f'{OUT}/learn-codeplus.Q4_K_M.gguf'
os.replace(gguf, final)
open(f'{OUT}/Modelfile', 'w', encoding='utf-8').write(MODELFILE)
print(f'✔ {final}  ({os.path.getsize(final) / 1e9:.1f} GB)\n✔ {OUT}/Modelfile')
print('\nDownload the .gguf (Output tab), then in the Evolvix folder run:\n  npm run import-model -- "C:\\path\\to\\learn-codeplus.Q4_K_M.gguf"')
