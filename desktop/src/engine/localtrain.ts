// 💻 내 컴퓨터에서 직접 학습 (Colab/서버 없이) — Windows(CUDA)·Mac(MPS)·CPU 자동.
//   transformers+peft+trl 로 LoRA 파인튜닝 → fp16 베이스에 병합 → llama.cpp 로 GGUF 변환
//   → 앱 모델 폴더에 바로 저장 → 🤖 내 AI 에서 즉시 로드. 전 과정은 앱 내장 터미널에 출력(실패는 시끄럽게).
import type { TrainOpts } from './train';

// 로컬에선 멀티모달·대형 베이스가 (특히 Mac/CPU) 너무 무거움 → 가벼운 텍스트 모델로 자동 다운시프트.
export function localBase(base: string): string {
  const b = (base || '').toLowerCase();
  if (b.includes('gemma-4') || b.includes('gemma4')) return 'unsloth/gemma-2-2b-it';   // 멀티모달 4 → 가벼운 텍스트 gemma
  if (b.includes('gemma-2') || b.includes('gemma2')) return 'unsloth/gemma-2-2b-it';
  if (b.includes('llama')) return 'unsloth/Llama-3.2-3B-Instruct';
  if (b.includes('qwen')) return 'unsloth/Qwen2.5-1.5B-Instruct';
  return 'unsloth/Llama-3.2-1B-Instruct';   // 안전 기본(초경량)
}

const fwd = (p: string) => (p || '').replace(/\\/g, '/');   // 윈도우 경로 → 파이썬에서 안전한 forward slash

export interface LocalTrainPaths { dataJsonl: string; outGguf: string; workDir: string; }

// 학습 스크립트(.py) 문자열 생성 — 값들은 위치에 직접 주입.
export function buildLocalTrainScript(base: string, paths: LocalTrainPaths, opts: TrainOpts = {}, dataCount = 30): string {
  const rank = opts.rank || 16;
  const alpha = opts.alpha || rank * 2;
  const dropout = opts.dropout ?? 0;
  const lr = opts.learningRate || 2e-4;
  const epochs = opts.epochs || 8;
  const warmup = opts.warmup ?? 5;
  const maxSeq = opts.maxSeq || 1024;
  const quant = (opts.quant && /^q8_0$|^f16$|^q4_k_m$/i.test(opts.quant)) ? opts.quant.toLowerCase() : 'q8_0';
  // 로컬(특히 CPU)은 느리니 step을 보수적으로 클램프
  const maxSteps = opts.maxSteps || Math.max(30, Math.min(150, Math.round((dataCount / 4) * epochs)));
  const DATA = fwd(paths.dataJsonl), OUT = fwd(paths.outGguf), WORK = fwd(paths.workDir);
  return `# -*- coding: utf-8 -*-
# 💻 Connect AI — 내 컴퓨터에서 직접 학습 (자동 생성)
import sys, os, subprocess, shutil

BASE   = "${base}"
DATA   = "${DATA}"
OUT    = "${OUT}"
WORK   = "${WORK}"
RANK, ALPHA, DROPOUT = ${rank}, ${alpha}, ${dropout}
LR, EPOCHS, WARMUP, MAXSEQ, MAXSTEPS = ${lr}, ${epochs}, ${warmup}, ${maxSeq}, ${maxSteps}
QUANT  = "${quant}"
os.makedirs(WORK, exist_ok=True)
os.makedirs(os.path.dirname(OUT), exist_ok=True)

def run(*a):
    print("  $", " ".join(str(x) for x in a), flush=True)
    subprocess.check_call(list(a))
def pip(*pkgs, extra=None):
    a = [sys.executable, "-m", "pip", "install", "-q", "--upgrade", *pkgs]
    if extra: a += extra
    run(*a)

print("============================================================", flush=True)
print("💻 내 컴퓨터에서 학습 시작 — 베이스:", BASE, flush=True)
print("============================================================", flush=True)

# ── 1/6 파이토치 설치 (NVIDIA면 CUDA판, 아니면 기본). 처음엔 수 분 걸려요 ──
print("📦 1/6 파이토치 설치...", flush=True)
has_nvidia = shutil.which("nvidia-smi") is not None and sys.platform.startswith("win")
try:
    import torch  # 이미 있으면 재설치 안 함
    print("  torch 이미 설치됨:", torch.__version__, flush=True)
except Exception:
    if has_nvidia:
        try: pip("torch", extra=["--index-url", "https://download.pytorch.org/whl/cu121"])
        except Exception as e:
            print("  ⚠️ CUDA 토치 실패 → CPU 토치로:", e, flush=True); pip("torch")
    else:
        pip("torch")
    import torch

# ── 2/6 학습 라이브러리 ──
print("📦 2/6 학습 라이브러리 설치...", flush=True)
pip("transformers", "peft", "trl", "datasets", "accelerate", "sentencepiece", "protobuf", "gguf")
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training, PeftModel

has_cuda = torch.cuda.is_available()
has_mps  = bool(getattr(torch.backends, "mps", None)) and torch.backends.mps.is_available()
device   = "cuda" if has_cuda else ("mps" if has_mps else "cpu")
dtype    = torch.float16 if (has_cuda or has_mps) else torch.float32
print(f"🖥️  장치: {device}  ({'NVIDIA GPU' if has_cuda else 'Apple GPU(MPS)' if has_mps else 'CPU(느림)'})", flush=True)
if device == "cpu":
    print("  ⚠️ GPU가 없어 CPU로 학습합니다 — 느려요. 작은 모델·적은 데이터로 테스트하세요.", flush=True)

# ── 3/6 베이스 모델 로드 ──
print("📥 3/6 베이스 모델 로드:", BASE, flush=True)
load_kw = dict(torch_dtype=dtype)
use_4bit = False
if has_cuda:
    try:
        from transformers import BitsAndBytesConfig
        pip("bitsandbytes")
        load_kw.update(quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.float16, bnb_4bit_quant_type="nf4"), device_map="auto")
        use_4bit = True
    except Exception as e:
        print("  bitsandbytes 미사용(전체정밀도로):", e, flush=True)
model = AutoModelForCausalLM.from_pretrained(BASE, **load_kw)
if not use_4bit:
    model = model.to(device)
tok = AutoTokenizer.from_pretrained(BASE)
if tok.pad_token is None: tok.pad_token = tok.eos_token

# ── 4/6 데이터 준비 (conversations Q&A) ──
print("📚 4/6 데이터 준비:", DATA, flush=True)
ds = load_dataset("json", data_files=DATA, split="train")
def fmt(ex):
    return {"text": [tok.apply_chat_template(c, tokenize=False) for c in ex["conversations"]]}
ds = ds.map(fmt, batched=True, remove_columns=ds.column_names)
print("  데이터 개수:", len(ds), flush=True)

# ── 5/6 LoRA 학습 ──
print("🧠 5/6 학습 시작 (LoRA, steps=%d)..." % MAXSTEPS, flush=True)
if use_4bit: model = prepare_model_for_kbit_training(model)
lconf = LoraConfig(r=RANK, lora_alpha=ALPHA, lora_dropout=DROPOUT, bias="none", task_type="CAUSAL_LM",
                   target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"])
model = get_peft_model(model, lconf)
from trl import SFTTrainer, SFTConfig
cfg = SFTConfig(output_dir=os.path.join(WORK, "out"), dataset_text_field="text",
                per_device_train_batch_size=1, gradient_accumulation_steps=4,
                warmup_steps=WARMUP, max_steps=MAXSTEPS, learning_rate=LR,
                logging_steps=1, optim="adamw_torch", weight_decay=0.001,
                lr_scheduler_type="linear", seed=3407, report_to="none", max_seq_length=MAXSEQ,
                fp16=has_cuda, bf16=False)
trainer = SFTTrainer(model=model, train_dataset=ds, args=cfg)
stats = trainer.train()
print("🎉 학습 완료! loss:", round(float(stats.training_loss), 4), flush=True)

# ── 6/6 어댑터 저장 → fp16 베이스에 병합 → GGUF 변환 ──
print("💾 6/6 병합 + GGUF 변환...", flush=True)
ADAPTER = os.path.join(WORK, "adapter")
model.save_pretrained(ADAPTER)
del model, trainer
try:
    import gc; gc.collect()
    if has_cuda: torch.cuda.empty_cache()
except Exception: pass
# 깨끗한 fp16 베이스에 어댑터를 얹어 병합(4bit 병합 품질 문제 회피)
base_fp = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.float16)
merged  = PeftModel.from_pretrained(base_fp, ADAPTER).merge_and_unload()
MERGED  = os.path.join(WORK, "merged")
if os.path.isdir(MERGED): shutil.rmtree(MERGED, ignore_errors=True)
merged.save_pretrained(MERGED, safe_serialization=True)
tok.save_pretrained(MERGED)

# llama.cpp 변환 스크립트만 받아 GGUF 생성
LL = os.path.join(WORK, "llamacpp")
if not os.path.exists(os.path.join(LL, "convert_hf_to_gguf.py")):
    if shutil.which("git") is None:
        print("❌ git이 없어 GGUF 변환을 못 해요. https://git-scm.com 에서 git 설치 후 다시 시도하세요.", flush=True); sys.exit(1)
    run("git", "clone", "--depth", "1", "https://github.com/ggml-org/llama.cpp", LL)
run(sys.executable, os.path.join(LL, "convert_hf_to_gguf.py"), MERGED, "--outfile", OUT, "--outtype", QUANT)

print("============================================================", flush=True)
print("✅ 끝! 새 모델:", OUT, flush=True)
print("👉 Connect AI 앱 🤖 내 AI 에서 바로 보이고 로드됩니다.", flush=True)
print("============================================================", flush=True)
`;
}
