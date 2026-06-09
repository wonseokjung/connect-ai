# 🧬 Connect AI — 내 두뇌로 모델 학습 (QLoRA, HF Jobs/Modal에서 실행)
#
# 사용자는 코랩·GPU 필요 없음. 앱이 두뇌를 JSONL로 내보내고 이 스크립트를
# HF Jobs(작업당 과금, T4/L4)에서 돌리면 → QLoRA 학습 → GGUF 변환 → HF 업로드.
# 앱이 결과 GGUF를 받아 내장 llama.cpp 엔진에 "내 모델"로 로드.
#
# 비용 가드(무료 월 1회 정책과 맞물림):
#   MODEL ≤ 8B, 예시 수 상한, T4/L4, MAX_STEPS/시간 상한.
#
# HF Jobs 실행 예:
#   hf jobs run --flavor l4x1 --secrets HF_TOKEN \
#     -e BASE_MODEL=unsloth/llama-3.2-3b-instruct-bnb-4bit \
#     -e DATASET_URL=https://.../brain.jsonl \
#     -e OUTPUT_REPO=<user>/connect-ai-brain-model \
#     python train_qlora.py
#
# 의존성: pip install unsloth datasets trl  (HF Jobs 이미지에 대부분 포함)

import os, json, urllib.request, subprocess, sys

BASE_MODEL  = os.environ.get("BASE_MODEL", "unsloth/llama-3.2-3b-instruct-bnb-4bit")
DATASET_URL = os.environ.get("DATASET_URL", "")          # 앱이 올린 brain.jsonl 의 URL(공개/서명 URL)
DATASET_PATH= os.environ.get("DATASET_PATH", "brain.jsonl")
OUTPUT_REPO = os.environ.get("OUTPUT_REPO", "")          # 결과 모델을 올릴 HF repo (예: user/connect-ai-brain-model)
HF_TOKEN    = os.environ.get("HF_TOKEN", "")
MAX_EXAMPLES= int(os.environ.get("MAX_EXAMPLES", "2000"))  # 비용 가드
MAX_STEPS   = int(os.environ.get("MAX_STEPS", "120"))      # 비용 가드(시간 상한)
MAX_SEQ_LEN = int(os.environ.get("MAX_SEQ_LEN", "2048"))
EXPORT_GGUF = os.environ.get("EXPORT_GGUF", "1") == "1"
GGUF_QUANT  = os.environ.get("GGUF_QUANT", "q4_k_m")

def load_examples():
    if DATASET_URL:
        urllib.request.urlretrieve(DATASET_URL, DATASET_PATH)
    rows = []
    with open(DATASET_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    return rows[:MAX_EXAMPLES]

def main():
    if not OUTPUT_REPO or not HF_TOKEN:
        print("OUTPUT_REPO 와 HF_TOKEN(시크릿)이 필요합니다.", file=sys.stderr); sys.exit(1)

    from unsloth import FastLanguageModel
    from unsloth.chat_templates import get_chat_template
    from datasets import Dataset
    from trl import SFTTrainer, SFTConfig

    rows = load_examples()
    print(f"학습 예시 {len(rows)}개 · 모델 {BASE_MODEL}")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=BASE_MODEL, max_seq_length=MAX_SEQ_LEN, load_in_4bit=True,
    )
    model = FastLanguageModel.get_peft_model(
        model, r=16, lora_alpha=16, lora_dropout=0,
        target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
        use_gradient_checkpointing="unsloth",
    )
    tokenizer = get_chat_template(tokenizer, chat_template="chatml")

    # JSONL 형식 지원: {instruction,output} 또는 {messages:[...]} 또는 {text}
    def to_text(r):
        if "messages" in r:
            msgs = r["messages"]
        elif "instruction" in r:
            msgs = [{"role":"user","content":r.get("instruction","")},
                    {"role":"assistant","content":r.get("output", r.get("response",""))}]
        else:
            return {"text": r.get("text","")}
        return {"text": tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)}

    ds = Dataset.from_list([to_text(r) for r in rows]).filter(lambda x: bool(x["text"].strip()))

    trainer = SFTTrainer(
        model=model, tokenizer=tokenizer, train_dataset=ds,
        args=SFTConfig(
            dataset_text_field="text", max_seq_length=MAX_SEQ_LEN,
            per_device_train_batch_size=2, gradient_accumulation_steps=4,
            warmup_steps=5, max_steps=MAX_STEPS, learning_rate=2e-4,
            logging_steps=5, optim="adamw_8bit", weight_decay=0.01,
            lr_scheduler_type="linear", output_dir="outputs", report_to="none",
        ),
    )
    trainer.train()

    # 1) LoRA 어댑터 업로드 (작고 빠름)
    model.push_to_hub(OUTPUT_REPO, token=HF_TOKEN)
    tokenizer.push_to_hub(OUTPUT_REPO, token=HF_TOKEN)

    # 2) GGUF(병합·양자화) 업로드 → 앱 내장 llama.cpp가 바로 로드
    if EXPORT_GGUF:
        try:
            model.push_to_hub_gguf(OUTPUT_REPO, tokenizer, quantization_method=GGUF_QUANT, token=HF_TOKEN)
            print(f"✅ GGUF({GGUF_QUANT}) 업로드 완료 → {OUTPUT_REPO}")
        except Exception as e:
            print(f"⚠️ GGUF 변환 실패(어댑터는 업로드됨): {e}", file=sys.stderr)

    print(f"✅ 학습 완료 → https://huggingface.co/{OUTPUT_REPO}")

if __name__ == "__main__":
    main()
