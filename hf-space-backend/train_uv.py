# /// script
# requires-python = ">=3.10"
# dependencies = ["unsloth", "trl>=0.9", "datasets", "huggingface_hub", "torch"]
# ///
# 🧠 Connect AI — 클라우드 학습(SFT) HF Jobs UV 스크립트. 데이터셋에 함께 올려 Job이 실행.
import os, sys
DATASET_REPO=os.environ.get("DATASET_REPO",""); DATASET_FILE=os.environ.get("DATASET_FILE","brain.jsonl")
BASE_MODEL=os.environ.get("BASE_MODEL","unsloth/llama-3.2-3b-instruct-bnb-4bit"); OUTPUT_REPO=os.environ.get("OUTPUT_REPO","")
HF_TOKEN=os.environ.get("HF_TOKEN",""); MAX_STEPS=int(os.environ.get("MAX_STEPS","120")); MAX_SEQ=2048
UPLOAD_TOKEN=os.environ.get("UPLOAD_TOKEN") or HF_TOKEN   # 결과 업로드 토큰(회원 연동 시 회원 계정으로 = 진짜 소유), 없으면 제공자
def main():
    if not (DATASET_REPO and OUTPUT_REPO and HF_TOKEN): print("env missing",file=sys.stderr); sys.exit(1)
    from huggingface_hub import hf_hub_download
    from unsloth import FastLanguageModel
    from unsloth.chat_templates import get_chat_template
    from datasets import load_dataset
    from trl import SFTTrainer, SFTConfig
    p=hf_hub_download(repo_id=DATASET_REPO,filename=DATASET_FILE,repo_type="dataset",token=HF_TOKEN)
    ds=load_dataset("json",data_files=p,split="train")
    if len(ds)>2000: ds=ds.select(range(2000))
    model,tok=FastLanguageModel.from_pretrained(model_name=BASE_MODEL,max_seq_length=MAX_SEQ,load_in_4bit=True)
    model=FastLanguageModel.get_peft_model(model,r=16,lora_alpha=16,lora_dropout=0,
        target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],use_gradient_checkpointing="unsloth")
    tok=get_chat_template(tok,chat_template="chatml")
    def to_text(r):
        if r.get("messages"): m=r["messages"]
        elif r.get("instruction") is not None: m=[{"role":"user","content":r.get("instruction","")},{"role":"assistant","content":r.get("output","")}]
        else: return {"text":r.get("text","")}
        return {"text":tok.apply_chat_template(m,tokenize=False,add_generation_prompt=False)}
    ds=ds.map(to_text).filter(lambda x:bool((x.get("text") or "").strip()))
    SFTTrainer(model=model,tokenizer=tok,train_dataset=ds,args=SFTConfig(dataset_text_field="text",max_seq_length=MAX_SEQ,
        per_device_train_batch_size=2,gradient_accumulation_steps=4,warmup_steps=5,max_steps=MAX_STEPS,learning_rate=2e-4,
        logging_steps=5,optim="adamw_8bit",weight_decay=0.01,lr_scheduler_type="linear",output_dir="outputs",report_to="none")).train()
    model.push_to_hub(OUTPUT_REPO,token=UPLOAD_TOKEN); tok.push_to_hub(OUTPUT_REPO,token=UPLOAD_TOKEN)
    try: model.push_to_hub_gguf(OUTPUT_REPO,tok,quantization_method="q4_k_m",token=UPLOAD_TOKEN)
    except Exception as e: print("gguf fail",e,file=sys.stderr)
    print("DONE",OUTPUT_REPO)
if __name__=="__main__": main()
