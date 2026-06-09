# /// script
# requires-python = ">=3.10"
# dependencies = ["unsloth", "trl>=0.9", "datasets", "huggingface_hub", "torch"]
# ///
# 🧬 Connect AI — "내 AI 키우기" 클라우드 학습 (HF Jobs UV 스크립트)
#
# HF Jobs에서 코랩 없이 한 줄로 실행:
#   hf jobs uv run --flavor l4x1 --timeout 1h --secrets HF_TOKEN \
#     -e DATASET_REPO=<user>/connect-ai-brain \
#     -e OUTPUT_REPO=<user>/my-connect-ai-model \
#     https://huggingface.co/datasets/<user>/connect-ai-brain/resolve/main/train_qlora_uv.py
#
# 비용 가드(무료 월 1회 정책과 맞물림): 모델 ≤8B, MAX_EXAMPLES, MAX_STEPS, L4/T4.
import os, sys

DATASET_REPO = os.environ.get("DATASET_REPO", "")          # 두뇌 JSONL 데이터셋 repo (datasets/<user>/connect-ai-brain)
DATASET_FILE = os.environ.get("DATASET_FILE", "connect-ai-brain.jsonl")
BASE_MODEL   = os.environ.get("BASE_MODEL", "unsloth/llama-3.2-3b-instruct-bnb-4bit")
OUTPUT_REPO  = os.environ.get("OUTPUT_REPO", "")           # 결과 모델 repo
HF_TOKEN     = os.environ.get("HF_TOKEN", "")
MAX_EXAMPLES = int(os.environ.get("MAX_EXAMPLES", "2000"))
MAX_STEPS    = int(os.environ.get("MAX_STEPS", "120"))
MAX_SEQ_LEN  = int(os.environ.get("MAX_SEQ_LEN", "2048"))
GGUF_QUANT   = os.environ.get("GGUF_QUANT", "q4_k_m")
EXPORT_GGUF  = os.environ.get("EXPORT_GGUF", "1") == "1"

def main():
    if not DATASET_REPO or not OUTPUT_REPO or not HF_TOKEN:
        print("DATASET_REPO, OUTPUT_REPO, HF_TOKEN(secret) 이 필요합니다.", file=sys.stderr); sys.exit(1)

    from huggingface_hub import hf_hub_download
    from unsloth import FastLanguageModel
    from unsloth.chat_templates import get_chat_template
    from datasets import load_dataset

    # 1) 데이터셋 내려받기(앱이 업로드한 두뇌 JSONL)
    path = hf_hub_download(repo_id=DATASET_REPO, filename=DATASET_FILE, repo_type="dataset", token=HF_TOKEN)
    ds = load_dataset("json", data_files=path, split="train")
    if len(ds) > MAX_EXAMPLES:
        ds = ds.select(range(MAX_EXAMPLES))
    print(f"학습 예시 {len(ds)}개 · 모델 {BASE_MODEL}")

    # 2) 모델 + QLoRA
    model, tokenizer = FastLanguageModel.from_pretrained(model_name=BASE_MODEL, max_seq_length=MAX_SEQ_LEN, load_in_4bit=True)
    model = FastLanguageModel.get_peft_model(
        model, r=16, lora_alpha=16, lora_dropout=0,
        target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
        use_gradient_checkpointing="unsloth")
    tokenizer = get_chat_template(tokenizer, chat_template="chatml")

    # JSONL: {conversations:[...]} | {messages:[...]} | {instruction,output} | {text}
    def to_text(r):
        if r.get("conversations"):
            msgs = [{"role": ("user" if m.get("from") in ("human","user") else "assistant"), "content": m.get("value", m.get("content",""))} for m in r["conversations"]]
        elif r.get("messages"):
            msgs = r["messages"]
        elif r.get("instruction") is not None:
            msgs = [{"role":"user","content":r.get("instruction","")},{"role":"assistant","content":r.get("output", r.get("response",""))}]
        else:
            return {"text": r.get("text","")}
        return {"text": tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)}

    ds = ds.map(to_text).filter(lambda x: bool((x.get("text") or "").strip()))

    from trl import SFTTrainer, SFTConfig
    trainer = SFTTrainer(model=model, tokenizer=tokenizer, train_dataset=ds, args=SFTConfig(
        dataset_text_field="text", max_seq_length=MAX_SEQ_LEN,
        per_device_train_batch_size=2, gradient_accumulation_steps=4,
        warmup_steps=5, max_steps=MAX_STEPS, learning_rate=2e-4,
        logging_steps=5, optim="adamw_8bit", weight_decay=0.01,
        lr_scheduler_type="linear", output_dir="outputs", report_to="none"))
    trainer.train()

    # 3) 업로드 — LoRA + (앱 내장 엔진용) GGUF
    model.push_to_hub(OUTPUT_REPO, token=HF_TOKEN)
    tokenizer.push_to_hub(OUTPUT_REPO, token=HF_TOKEN)
    if EXPORT_GGUF:
        try:
            model.push_to_hub_gguf(OUTPUT_REPO, tokenizer, quantization_method=GGUF_QUANT, token=HF_TOKEN)
            print(f"✅ GGUF({GGUF_QUANT}) 업로드 → {OUTPUT_REPO}")
        except Exception as e:
            print(f"⚠️ GGUF 변환 실패(어댑터는 업로드됨): {e}", file=sys.stderr)
    print(f"✅ 학습 완료 → https://huggingface.co/{OUTPUT_REPO}")

if __name__ == "__main__":
    main()
