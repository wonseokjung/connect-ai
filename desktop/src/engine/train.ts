// 🚀 장기 기억 학습 — 검증된 레시피로 Unsloth 파인튜닝 Colab 노트북(.ipynb) 생성.
//   conversations Q&A + gemma-4 템플릿 + train_on_responses_only(응답만 학습) + sweet-spot 설정.
//   데이터셋(HF) → Colab(무료 T4) 원클릭 → 내 모델 위에 누적 학습 → GGUF 새 버전 → Connect AI 내장 엔진.

const md = (lines: string[]) => ({ cell_type: 'markdown', metadata: {}, source: lines });
const code = (lines: string[]) => ({ cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: lines });

export interface TrainOpts { rank?: number; alpha?: number; dropout?: number; learningRate?: number; maxSteps?: number; epochs?: number; warmup?: number; maxSeq?: number; scheduler?: string; quant?: string; }
export function buildNotebook(datasetRepo: string, baseModel: string, outModelRepo: string, dataCount = 30, opts: TrainOpts = {}, inlineJsonl = ''): string {
  // inlineJsonl 있으면 데이터를 노트북에 직접 심는다(HF 업로드 불필요) — 🆓 무료 = 바로 코랩
  const b64 = inlineJsonl ? Buffer.from(inlineJsonl, 'utf8').toString('base64') : '';
  const base = baseModel || 'unsloth/llama-3.2-3b-instruct-bnb-4bit';   // 검증된 기본(존재·로딩 확인). gemma-4 등은 사용자가 명시할 때만
  const rank = opts.rank || 16;
  const alpha = opts.alpha || rank * 2;
  const dropout = opts.dropout ?? 0;
  const lr = opts.learningRate || 3e-4;
  const quant = opts.quant || 'q4_k_m';
  const epochs = opts.epochs || 8;
  const warmup = opts.warmup ?? 5;
  const maxSeq = opts.maxSeq || 1024;
  const scheduler = opts.scheduler || 'linear';
  // max_steps = 직접 지정값 또는 ≈epochs (데이터수/배치4 × epochs), 과적합 방지 위해 40~300 클램프
  const maxSteps = opts.maxSteps || Math.max(40, Math.min(300, Math.round((dataCount / 4) * epochs)));
  const nb = {
    nbformat: 4, nbformat_minor: 0,
    metadata: { accelerator: 'GPU', colab: { provenance: [], gpuType: 'T4' }, kernelspec: { name: 'python3', display_name: 'Python 3' }, language_info: { name: 'python' } },
    cells: [
      md([
        '# 🧬 Connect AI — 장기 기억 학습 (Unsloth)\n',
        '내 1인 기업 지식을 모델 **가중치에 체득**시킵니다. 위 메뉴 **런타임 → 모두 실행**만 누르면 됩니다 (무료 T4 GPU).\n',
        '- 데이터셋: `' + datasetRepo + '` (단기 지식 → conversations Q&A)\n',
        '- 베이스 모델: `' + base + '`  ← *내가 쓰는 모델로 바꿔도 됩니다 (누적 학습)*\n',
        '- 결과 모델: `' + outModelRepo + '` (GGUF — Connect AI 내장 엔진에 바로 로드, LM Studio 불필요)\n',
        '- 설정: rank ' + rank + '/alpha ' + alpha + ' · dropout ' + dropout + ' · lr ' + lr + ' · steps ' + maxSteps + ' · seq ' + maxSeq + ' · ' + scheduler + ' · 양자화 ' + quant + ' (데이터 ' + dataCount + '개)\n',
      ]),
      code([
        '%%capture\n',
        '# 버전을 직접 고정하지 않는다 — Unsloth가 현재 Colab torch에 맞는 의존성(torchao·transformers 등)을 알아서 설치.\n',
        '# (고정 레시피는 Colab torch가 바뀌면 register_constant/recompile_limit 같은 충돌이 연쇄로 난다)\n',
        '!pip install --upgrade --no-cache-dir unsloth unsloth_zoo\n',
      ]),
      md(['## 🔑 HuggingFace 로그인 (맨 먼저!)\n', '아래 칸에 **write 토큰**을 붙여넣으세요. *비공개 데이터셋을 불러오고*, 학습된 모델을 *업로드*하는 데 둘 다 필요해요.\n']),
      code(['from huggingface_hub import notebook_login\n', 'notebook_login()\n']),
      code([
        'from unsloth import FastModel\n', 'import torch\n',
        'model, tokenizer = FastModel.from_pretrained(\n',
        '    model_name = "' + base + '",\n',
        '    dtype = None, max_seq_length = ' + maxSeq + ',\n',
        '    load_in_4bit = True, full_finetuning = False,\n', ')\n',
        'print("✅ 베이스 모델 로딩 완료")\n',
      ]),
      code([
        '# LoRA — 전체의 1% 미만만 학습(메모리↓, 페르소나·핵심지식엔 충분)\n',
        'model = FastModel.get_peft_model(\n',
        '    model, finetune_language_layers=True, finetune_attention_modules=True,\n',
        '    finetune_mlp_modules=True, finetune_vision_layers=False,\n',
        '    r = ' + rank + ', lora_alpha = ' + alpha + ', lora_dropout = ' + dropout + ', bias = "none", random_state = 3407,\n', ')\n',
      ]),
      md(['## 📦 단기 지식 데이터셋 (conversations Q&A)\n', b64 ? '내 지식이 **이 노트북에 직접 포함**돼 있어요 (업로드 불필요). 각 행 = `{conversations:[{user},{assistant}]}`\n' : 'Connect AI 앱이 업로드한 데이터셋. 각 행 = `{conversations:[{user},{assistant}]}`\n']),
      code(b64 ? [
        'import base64\n',
        'from datasets import load_dataset\n',
        'from unsloth.chat_templates import get_chat_template\n',
        '# 내 지식(노트북에 포함) — base64로 안전하게 심어둠\n',
        '_B64 = "' + b64 + '"\n',
        'open("brain.jsonl", "w").write(base64.b64decode(_B64).decode("utf-8"))\n',
        'ds = load_dataset("json", data_files="brain.jsonl", split="train")\n',
        'tokenizer = get_chat_template(tokenizer, chat_template="gemma-4")\n',
        'def fmt(ex):\n',
        '    texts = [tokenizer.apply_chat_template(c, tokenize=False, add_generation_prompt=False).removeprefix("<bos>") for c in ex["conversations"]]\n',
        '    return {"text": texts}\n',
        'ds = ds.map(fmt, batched=True)\n',
        'print("데이터 개수:", len(ds)); print(ds[0]["text"][:400])\n',
      ] : [
        'from datasets import load_dataset\n',
        'from unsloth.chat_templates import get_chat_template\n',
        'ds = load_dataset("' + datasetRepo + '", data_files="connect-ai-brain.jsonl", split="train", token=True)\n',
        'tokenizer = get_chat_template(tokenizer, chat_template="gemma-4")\n',
        'def fmt(ex):\n',
        '    texts = [tokenizer.apply_chat_template(c, tokenize=False, add_generation_prompt=False).removeprefix("<bos>") for c in ex["conversations"]]\n',
        '    return {"text": texts}\n',
        'ds = ds.map(fmt, batched=True)\n',
        'print("데이터 개수:", len(ds)); print(ds[0]["text"][:400])\n',
      ]),
      code([
        'from trl import SFTTrainer, SFTConfig\n',
        'trainer = SFTTrainer(\n',
        '    model = model, tokenizer = tokenizer, train_dataset = ds,\n',
        '    args = SFTConfig(\n',
        '        dataset_text_field = "text",\n',
        '        per_device_train_batch_size = 1, gradient_accumulation_steps = 4,\n',
        '        warmup_steps = ' + warmup + ', max_steps = ' + maxSteps + ', learning_rate = ' + lr + ',\n',
        '        logging_steps = 1, optim = "adamw_8bit", weight_decay = 0.001,\n',
        '        lr_scheduler_type = "' + scheduler + '", seed = 3407, report_to = "none",\n',
        '    ),\n', ')\n',
      ]),
      code([
        '# 🎭 응답(assistant)만 학습 — 질문 패턴은 마스킹(효율↑·품질↑)\n',
        '# ⚠️ 마커는 모델/버전마다 다름(<|turn> vs <start_of_turn>) → 실제 텍스트에서 자동 감지\n',
        'from unsloth.chat_templates import train_on_responses_only\n',
        '_t = ds[0]["text"]\n',
        '_im = "<|turn>user\\n" if "<|turn>user" in _t else "<start_of_turn>user\\n"\n',
        '_rm = "<|turn>model\\n" if "<|turn>model" in _t else "<start_of_turn>model\\n"\n',
        'trainer = train_on_responses_only(trainer, instruction_part=_im, response_part=_rm)\n',
        'print(f"✅ 마스킹 마커 자동감지: {_rm.strip()} — 학습 준비 완료")\n',
      ]),
      code(['trainer_stats = trainer.train()\n', 'print("🎉 학습 완료! 최종 loss:", round(trainer_stats.training_loss, 4))\n', 'print("💡 loss 0.2~0.4면 sweet spot. 너무 낮으면(<0.1) 과적합 — max_steps 줄이세요.")\n']),
      md(['## 🧪 학습된 모델 테스트 (업로드 전에 확인!)\n', '내가 가르친 지식을 직접 물어보세요. 답에 그 내용이 나오면 학습 성공이에요. 질문은 자유롭게 바꿔도 됩니다.\n']),
      code([
        'from unsloth import FastModel\n', 'FastModel.for_inference(model)\n',
        'def chat(prompt, max_tokens=220):\n',
        '    msg = [{"role":"user","content":[{"type":"text","text":prompt}]}]\n',
        '    inp = tokenizer.apply_chat_template(msg, add_generation_prompt=True, tokenize=True, return_dict=True, return_tensors="pt").to("cuda")\n',
        '    if inp["input_ids"][0,0].item() == tokenizer.bos_token_id:\n',
        '        inp["input_ids"] = inp["input_ids"][:,1:]; inp["attention_mask"] = inp["attention_mask"][:,1:]\n',
        '    out = model.generate(**inp, max_new_tokens=max_tokens, do_sample=False, pad_token_id=tokenizer.eos_token_id)\n',
        '    ans = tokenizer.decode(out[0][inp["input_ids"].shape[1]:], skip_special_tokens=True)\n',
        '    print(f"\\u2753 {prompt}\\n\\U0001F4AC {ans}\\n" + "\\u2500"*58)\n',
        '\n',
        '# 👇 내가 가르친 지식에 대해 물어보세요 (자유롭게 수정)\n',
        'chat("내 사업/지식에 대해 아는 걸 알려줘")\n',
        'chat("너는 무엇을 도와줄 수 있어?")\n',
      ]),
      md(['## 💾 저장 → HuggingFace\n', '**safetensors(AI 진화·합성용) + GGUF(앱 실행용)** 둘 다 올라가요. (맨 앞에서 로그인했으니 바로 됩니다)\n']),
      code([
        '# 메모리 정리(OOM 방지) — 학습기 메모리 해제 후 변환\n',
        'import gc, torch\n',
        'try:\n', '    del trainer\n', 'except Exception:\n', '    pass\n',
        'gc.collect(); torch.cuda.empty_cache()\n',
        '# ① 합성용 safetensors (AI 진화소에서 다시 합칠 수 있어요 — 이게 없으면 합성 불가!)\n',
        'try:\n',
        '    model.push_to_hub_merged("' + outModelRepo + '", tokenizer, save_method="merged_16bit", token=True)\n',
        '    print("✅ safetensors 업로드 — AI 진화소에서 합치기 가능")\n',
        'except Exception as e:\n',
        '    print("⚠️ 병합 업로드 실패 → 어댑터(LoRA)로 폴백:", e)\n',
        '    model.push_to_hub("' + outModelRepo + '", token=True); tokenizer.push_to_hub("' + outModelRepo + '", token=True)\n',
        '# ② 앱 실행용 GGUF\n',
        'model.push_to_hub_gguf("' + outModelRepo + '", tokenizer, quantization_method="' + quant + '", token=True)\n',
        'print("✅ 완료! safetensors(합성용)+GGUF(실행용) 둘 다 → Connect AI 앱 🤖 내 AI 에서 \\"' + outModelRepo + '\\" 받기")\n',
      ]),
    ],
  };
  return JSON.stringify(nb, null, 1);
}
