# %% [markdown]
# # Evolvix · Learn Code+ training (Kaggle)
# Fine-tunes **Qwen2.5-Coder-7B** into **Learn Code+** with QLoRA, using only licence-checked coding data.
#
# **Before you press "Run all":**
# 1. Right panel → **Session options → Accelerator → GPU T4 x2**.
# 2. Right panel → **Internet → On** (needs a phone-verified Kaggle account).
# 3. *(Optional)* **Add Input** → your uploaded dataset with `evolvix-training-*.jsonl` (exported from the app) — they are added to training.
#
# Steps: ① licence-checked data → ② training (~3–5 h) → ③ coding test with real unit tests → ④ export `.gguf` for Ollama.
# When it finishes: **Output** tab → download `learn-codeplus/gguf/*.gguf` and run `npm run import-model -- <file>` in the app folder.

# %%
# ① Install (2–4 min)
%%capture
!pip install -q unsloth
!pip install -q --upgrade datasets huggingface_hub

# %%
import json, os, re, glob, random, hashlib, ast, subprocess, sys, time, tempfile
CFG = json.loads(r'''__CONFIG__''')
P, T = CFG['preprocessing'], CFG['training']
random.seed(P['seed'])
WORK = '/kaggle/working'
DATA, CKPT, OUT = f'{WORK}/data', f'{WORK}/checkpoints', f"{WORK}/{CFG['ollama_name']}"
for d in (DATA, CKPT, OUT): os.makedirs(d, exist_ok=True)
SYSTEM = ('You are Learn Code, the coding specialist of the Evolvix AI family. Give complete, correct, runnable code with all '
          'imports, follow the request exactly, explain briefly, and never invent APIs.')
print('Base model:', CFG['base_model'], '| target examples:', CFG['total_examples'])

# %% [markdown]
# ## ① Build the dataset (licence check · de-duplicate · filter · validate · split)

# %%
from datasets import load_dataset
from huggingface_hub import HfApi
api = HfApi()

def license_of(ds_id):
    info = api.dataset_info(ds_id)
    lic = None
    cd = info.card_data
    if cd is not None:
        lic = cd.get('license') if hasattr(cd, 'get') else getattr(cd, 'license', None)
    if not lic:
        lic = next((t.split(':', 1)[1] for t in (info.tags or []) if t.startswith('license:')), None)
    if isinstance(lic, list): lic = lic[0] if lic else None
    return (lic or 'unknown').lower()

# Which skill does an instruction ask for? (first match wins, order matters)
CATEGORIES = [
    ('security_and_best_practices', r'\b(secur\w*|vulnerab\w*|sanitiz\w*|sql injection|xss|csrf|encrypt\w*|hash(ing)? password|best practice\w*|owasp)\b'),
    ('unit_testing', r'\b(unit tests?|test cases?|pytest|unittest|jest|mocha|junit|write tests?|test suite)\b'),
    ('debugging', r'\b(bug\w*|fix\w*|error\w*|exception|traceback|debug\w*|not working|doesn.?t work|wrong output|crash\w*)\b'),
    ('code_refactoring', r'\b(refactor\w*|clean ?up|improve (the )?(code|readability)|optimi[sz]e|rewrite|simplif\w*|more efficient|pythonic|idiomatic)\b'),
    ('software_architecture', r'\b(architect\w*|design pattern|system design|microservice\w*|scalab\w*|class diagram|api design|schema design|singleton|factory pattern|mvc|layered)\b'),
    ('algorithms_and_dsa', r'\b(algorithm\w*|time complexity|big.?o|binary search|dynamic programming|graph|tree|linked list|heap|stack|queue|sort\w*|recursion|dfs|bfs|shortest path|subsequence|subarray)\b'),
    ('code_explanation', r'\b(explain\w*|what does (this|the) code|how does (this|the) code|walk me through|describe what)\b'),
    ('code_reasoning', r'\b(what (is|will be) the output|predict the output|trace|step by step|reason|why does|determine whether|prove)\b'),
]
CAT_RE = [(c, re.compile(p, re.I)) for c, p in CATEGORIES]
def classify(prompt): return next((c for c, r in CAT_RE if r.search(prompt[:1500])), 'code_generation')

PLACEHOLDER = re.compile(r'(\bTODO\b|\bFIXME\b|your code here|rest of (the )?code|implement (this|me)\b|lorem ipsum|\.\.\.\s*$|pass\s*#\s*todo)', re.I | re.M)
PY_BLOCK = re.compile(r'```(?:python|py)\s*\n(.*?)```', re.S)
def code_ok(answer):
    """Python code blocks must parse; other languages are kept as-is."""
    for block in PY_BLOCK.findall(answer):
        try: ast.parse(block)
        except Exception: return False
    return True
def key(s): return hashlib.sha1(re.sub(r'\W+', ' ', s.lower()).strip().encode()).hexdigest()
approx_tokens = lambda s: len(s) // 3.5

need = {c: round(CFG['total_examples'] * pct / 100) for c, pct in CFG['dataset_mix'].items() if not c.startswith('_')}
buckets = {c: [] for c in need}
seen_exact, seen_near = set(), set()
eval_problems = []   # held-out problems WITH unit tests, never trained on
stats = {}

def add(cat, prompt, answer, meta):
    if cat not in buckets or len(buckets[cat]) >= need[cat] * 3: return False
    buckets[cat].append({'messages': [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': prompt.strip()},
                                      {'role': 'assistant', 'content': answer.strip()}], 'category': cat, **meta})
    return True

def parse_tests(raw):
    if raw is None: return []
    if isinstance(raw, str):
        try: raw = json.loads(raw)
        except Exception: return [raw]
    return [t for t in raw if isinstance(t, str)]

for src in CFG['sources']:
    sid = src['id']
    if CFG['use_only_clean_sources'] and not src.get('clean'):
        print(f'⏭  {sid}: skipped (made by {src["made_by"]})'); continue
    lic = license_of(sid)
    if P['verify_license'] and lic not in CFG['license_allowlist']:
        print(f'⛔ {sid}: licence "{lic}" not in allowlist — skipped'); continue
    print(f'⬇  {sid}  (licence: {lic})')
    ds = load_dataset(sid, src.get('config'), split='train', streaming=True)
    kept = dropped = 0
    for i, row in enumerate(ds):
        fills = [src['category']] if src.get('category') else [c for c in need if c != 'general_reasoning']
        if i >= src.get('scan_limit', 200_000) or all(len(buckets[c]) >= need[c] * 3 for c in fills): break
        p, a = str(row.get(src['prompt']) or ''), str(row.get(src['answer']) or '')
        if src.get('gsm8k_cleanup'):  # "<<48/2=24>>" calculator notes and "#### 72" → clean worked answer
            a = re.sub(r'####\s*', 'Final answer: ', re.sub(r'<<[^<>]*>>', '', a))
        if src.get('min_test_score') is not None and float(row.get('average_test_score') or 0) < src['min_test_score']: dropped += 1; continue
        if P['remove_empty_answers'] and len(a.strip()) < P['min_answer_chars']: dropped += 1; continue
        if P['remove_placeholder_content'] and PLACEHOLDER.search(a): dropped += 1; continue
        if approx_tokens(p + a) > P['max_tokens_per_example']: dropped += 1; continue
        if P['validate_code_examples'] and not code_ok(a): dropped += 1; continue
        ek, nk = key(p + '\x00' + a), key(p)
        if (P['remove_exact_duplicates'] and ek in seen_exact) or (P['remove_near_duplicates'] and nk in seen_near): dropped += 1; continue
        seen_exact.add(ek); seen_near.add(nk)
        tests = parse_tests(row.get(src['unit_tests_column'])) if src.get('unit_tests_column') else []
        # Keep some problems with real unit tests aside for the final coding test (never trained on)
        if tests and len(eval_problems) < CFG['coding_evaluation']['held_out_problems'] and random.random() < 0.02:
            eval_problems.append({'prompt': p, 'tests': tests}); continue
        meta = {'source': sid, 'license': lic, 'made_by': src['made_by']}
        if add(src.get('category') or classify(p), p, a, meta): kept += 1
        # Unit-testing skill from real tests: "write tests for this code" → the dataset's own tests
        if tests and len(buckets['unit_testing']) < need['unit_testing'] * 3 and random.random() < 0.15:
            code = PY_BLOCK.findall(a) or ([a] if re.search(r'^\s*def \w+\(', a, re.M) and '```' not in a else [])
            if code and code_ok(f'```python\n{code[0]}\n```'):
                add('unit_testing', f'Write unit tests (plain assert statements) for this function:\n```python\n{code[0].strip()}\n```',
                    '```python\n' + '\n'.join(tests[:12]) + '\n```', meta)
    stats[sid] = (kept, dropped)
    print(f'   kept {kept:,} · filtered out {dropped:,}')

# Your own examples (exported from the app) — always included
mine = []
for f in glob.glob('/kaggle/input/**/evolvix-training-*.jsonl', recursive=True):
    if 'pairs' in f: continue
    for line in open(f, encoding='utf-8'):
        try:
            ex = json.loads(line)
            if ex.get('messages'): mine.append({**ex, 'category': 'my_examples', 'source': os.path.basename(f), 'license': 'own'})
        except Exception: pass
print(f'Your own examples: {len(mine)}')

# Fill each category to its share; any shortfall goes to code generation
final = []
short = 0
for c, n in need.items():
    random.shuffle(buckets[c]); take = buckets[c][:n]; short += n - len(take); final += take
extra = [x for x in buckets['code_generation'][need['code_generation']:]][:short]
final += extra + mine
random.shuffle(final)

n = len(final); a, b = P['train_validation_test_split'][:2]
splits = {'train': final[:int(n * a)], 'validation': final[int(n * a):int(n * (a + b))], 'test': final[int(n * (a + b)):]}
for name, rows in splits.items():
    with open(f'{DATA}/{name}.jsonl', 'w', encoding='utf-8') as fh:
        for r in rows: fh.write(json.dumps(r, ensure_ascii=False) + '\n')
json.dump(eval_problems, open(f'{DATA}/coding_eval.json', 'w'))
print('\nCategory mix:')
for c in need: print(f'  {c:30s} {sum(1 for r in final if r["category"] == c):6,}  (target {need[c]:,})')
print({k: len(v) for k, v in splits.items()}, '| held-out coding problems:', len(eval_problems))

# %% [markdown]
# ## ② Train (QLoRA SFT) — about 3–5 hours on a T4
# Checkpoints are saved every few hundred steps. If the session stops, click **Save Version** first, then start a new
# session with that version's output added as input — training resumes from the last checkpoint.

# %%
from unsloth import FastLanguageModel
import torch, inspect, shutil
from datasets import load_dataset as load_local
from trl import SFTTrainer, SFTConfig

model, tokenizer = FastLanguageModel.from_pretrained(model_name=CFG['base_model'], max_seq_length=T['max_sequence_length'], load_in_4bit=True, dtype=None)
L = CFG['lora']
model = FastLanguageModel.get_peft_model(model, r=L['rank'], lora_alpha=L['alpha'], lora_dropout=L['dropout'], target_modules=L['target_modules'],
                                         bias='none', use_gradient_checkpointing='unsloth', random_state=P['seed'])

ds = load_local('json', data_files={'train': f'{DATA}/train.jsonl', 'validation': f'{DATA}/validation.jsonl'})
ds = ds.map(lambda b: {'text': [tokenizer.apply_chat_template(m, tokenize=False) for m in b['messages']]}, batched=True,
            remove_columns=[c for c in ds['train'].column_names if c != 'text'])

bf16 = torch.cuda.is_bf16_supported()
kw = dict(output_dir=CKPT, per_device_train_batch_size=T['batch_size'], gradient_accumulation_steps=T['gradient_accumulation_steps'],
          num_train_epochs=T['epochs'], learning_rate=T['learning_rate'], warmup_ratio=T['warmup_ratio'], weight_decay=T['weight_decay'],
          lr_scheduler_type=T['lr_scheduler'], optim=T['optimizer'], max_grad_norm=T['max_grad_norm'], logging_steps=T['logging_steps'],
          save_steps=T['save_steps'], save_total_limit=T['save_total_limit'], eval_steps=T['save_steps'], per_device_eval_batch_size=2,
          fp16=not bf16, bf16=bf16, report_to='none', seed=P['seed'], dataset_text_field='text', packing=T['packing'])
sig = inspect.signature(SFTConfig.__init__).parameters   # TRL renamed some options between versions
kw['max_seq_length' if 'max_seq_length' in sig else 'max_length'] = T['max_sequence_length']
kw['eval_strategy' if 'eval_strategy' in sig else 'evaluation_strategy'] = 'steps'
tok_arg = 'processing_class' if 'processing_class' in inspect.signature(SFTTrainer.__init__).parameters else 'tokenizer'
trainer = SFTTrainer(model=model, train_dataset=ds['train'], eval_dataset=ds['validation'], args=SFTConfig(**kw), **{tok_arg: tokenizer})

# Resume from an earlier session's checkpoint if one was added as input
prev = sorted(glob.glob('/kaggle/input/**/checkpoints/checkpoint-*', recursive=True), key=lambda p: int(p.rsplit('-', 1)[1]))
if prev and not glob.glob(f'{CKPT}/checkpoint-*'):
    shutil.copytree(prev[-1], f'{CKPT}/{os.path.basename(prev[-1])}')
resume = sorted(glob.glob(f'{CKPT}/checkpoint-*'), key=lambda p: int(p.rsplit('-', 1)[1]))
t0 = time.time()
trainer.train(resume_from_checkpoint=resume[-1] if resume else None)
print(f'Training done in {(time.time() - t0) / 3600:.1f} h')
model.save_pretrained(f'{OUT}/lora'); tokenizer.save_pretrained(f'{OUT}/lora')

# %% [markdown]
# ## ③ Coding test — held-out problems, checked by running their real unit tests

# %%
FastLanguageModel.for_inference(model)
probs = json.load(open(f'{DATA}/coding_eval.json'))
passed, results = 0, []
for i, pr in enumerate(probs):
    msgs = [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': pr['prompt']}]
    ids = tokenizer.apply_chat_template(msgs, add_generation_prompt=True, return_tensors='pt').to('cuda')
    out = model.generate(input_ids=ids, max_new_tokens=768, do_sample=False)
    ans = tokenizer.decode(out[0][ids.shape[1]:], skip_special_tokens=True)
    code = '\n'.join(PY_BLOCK.findall(ans)) or ans
    with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False) as f: f.write(code + '\n\n' + '\n'.join(pr['tests']))
    try: ok = subprocess.run([sys.executable, f.name], capture_output=True, timeout=CFG['coding_evaluation']['timeout_seconds']).returncode == 0
    except subprocess.TimeoutExpired: ok = False
    passed += ok; results.append({'prompt': pr['prompt'][:300], 'pass': ok})
    print(f'{i + 1:3d}/{len(probs)} {"✔" if ok else "✘"}', end='  ' if (i + 1) % 6 else '\n')
score = round(100 * passed / max(1, len(probs)))
json.dump({'pass_at_1': score, 'results': results}, open(f'{OUT}/coding_eval.json', 'w'), indent=1)
print(f'\n\nLearn Code+ passes {passed}/{len(probs)} unseen problems ({score}%) — real unit tests, no guessing.')

# %% [markdown]
# ## ④ Export for Ollama (`.gguf`, ~4.7 GB) — then download it from the Output tab

# %%
model.save_pretrained_gguf(f'{OUT}/gguf', tokenizer, quantization_method=CFG['export']['gguf_quantization'])
for f in glob.glob(f'{OUT}/gguf/*.gguf') + glob.glob(f'{OUT}/*.gguf'):
    print(f'✔ {f}  ({os.path.getsize(f) / 1e9:.1f} GB)')
print('\nDownload the .gguf (Output tab), then in the Evolvix folder run:\n  npm run import-model -- "C:\\path\\to\\downloaded.gguf"')
