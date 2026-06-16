// 🎓 AI 학습 방법론 — 배움용. SFT·DPO 를 선택 → 각 방식별 교육 Colab 노트북 생성.
//   비개발자가 "각 방법이 뭐고·언제 쓰고·데이터가 어떻게 생겼나"를 직접 돌려보며 배우게 한다.
import { buildNotebook, TrainOpts } from './train';

export interface MethodMeta {
  id: string; label: string; emoji: string; level: '기본' | '중급' | '고급';
  what: string;        // 한 줄 정의
  when: string;        // 언제 쓰나
  data: string;        // 필요한 데이터 형태
  note?: string;       // 주의/팁
}

export const METHODS: MethodMeta[] = [
  { id: 'sft', label: 'SFT', emoji: '📝', level: '기본',
    what: '질문→모범답안 "정답지"로 학습', when: '정체성·페르소나·핵심 지식 주입', data: '질문-답변 쌍 (🔬증강으로 다양하게)', note: '가장 기본. 여기서 시작.' },
  { id: 'dpo', label: 'AI 자동 피드백', emoji: '⚖️', level: '중급',
    what: 'AI가 좋은답/나쁜답을 스스로 만들어 품질 학습', when: '답변 품질·톤 다듬기 (SFT 다음 단계)', data: 'AI 자동 생성 (RLAIF·DPO · 사람 클릭 0)', note: '검증된 사람이 가끔 보강하면 더 좋음.' },
];

const md = (lines: string[]) => ({ cell_type: 'markdown', metadata: {}, source: lines });
const code = (lines: string[]) => ({ cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: lines });

// ── 공통 셀(설치·로딩·LoRA·템플릿·저장) ──────────────────────
const cInstall = () => code(['%%capture\n', '!pip install unsloth\n', '!pip install --no-deps "xformers<0.0.30" trl peft accelerate bitsandbytes datasets\n']);
const cLoad = (base: string) => code(['from unsloth import FastModel\n', 'import torch\n', 'model, tokenizer = FastModel.from_pretrained(model_name="' + base + '", dtype=None, max_seq_length=1024, load_in_4bit=True, full_finetuning=False)\n', 'print("✅ 베이스 모델 로딩")\n']);
const cLora = (rank: number) => code(['model = FastModel.get_peft_model(model, r=' + rank + ', lora_alpha=' + (rank * 2) + ', lora_dropout=0, bias="none", random_state=3407,\n', '    finetune_language_layers=True, finetune_attention_modules=True, finetune_mlp_modules=True, finetune_vision_layers=False)\n']);
const cTemplate = () => code(['from unsloth.chat_templates import get_chat_template\n', 'tokenizer = get_chat_template(tokenizer, chat_template="gemma-4")\n']);
const cSave = (out: string, quant: string) => [
  md(['## 💾 저장 → HuggingFace\n', 'write 토큰을 붙여넣으세요. **safetensors(AI 합성용) + GGUF(LM Studio 실행용)** 둘 다 올라가요.\n']),
  code(['from huggingface_hub import notebook_login\n', 'notebook_login()\n']),
  // ① 합성용 safetensors(풀 병합 16bit) — AI 합성소에서 능력 더하기/빼기·합치기 가능 (이게 없으면 합성 불가)
  code(['# ① 합성용 safetensors (AI 합성소에서 다시 합칠 수 있어요)\n',
        'try:\n',
        '    model.push_to_hub_merged("' + out + '", tokenizer, save_method="merged_16bit", token=True)\n',
        '    print("✅ safetensors 업로드 — AI 합성소에서 합치기 가능")\n',
        'except Exception as e:\n',
        '    print("⚠️ 병합 업로드 실패(어댑터로 폴백):", e)\n',
        '    model.push_to_hub("' + out + '", token=True); tokenizer.push_to_hub("' + out + '", token=True)\n']),
  // ② 앱 실행용 GGUF
  code(['# ② 앱 실행용 GGUF (LM Studio·Connect AI 내장 엔진)\n',
        'model.push_to_hub_gguf("' + out + '", tokenizer, quantization_method="' + quant + '", token=True)\n',
        'print("✅ huggingface.co/' + out + ' → safetensors + GGUF 둘 다 완료")\n']),
];
const wrap = (cells: any[]) => JSON.stringify({ nbformat: 4, nbformat_minor: 0, metadata: { accelerator: 'GPU', colab: { provenance: [], gpuType: 'T4' }, kernelspec: { name: 'python3', display_name: 'Python 3' }, language_info: { name: 'python' } }, cells }, null, 1);

// ── DPO: 선호 쌍으로 품질 학습 ─────────────────────────────
function nbDPO(datasetRepo: string, base: string, out: string, rank: number, quant: string): string {
  const hasData = datasetRepo.includes('/');
  return wrap([
    md(['# ⚖️ DPO — 선호 학습으로 답변 품질 높이기\n', '"A답이 B답보다 낫다"는 **선호 쌍**으로 학습합니다. RLHF의 쉽고 안정적인 대체재.\n', '> 💡 SFT가 "무엇을 답할지"라면, DPO는 "어떻게 더 잘 답할지"를 가르칩니다.\n']),
    cInstall(),
    md(['## 🔑 HuggingFace 로그인 (맨 먼저!)\n', 'write 토큰을 붙여넣으세요. 비공개 데이터셋 로드 + 모델 업로드에 필요해요.\n']),
    code(['from huggingface_hub import notebook_login\n', 'notebook_login()\n']),
    cLoad(base), cLora(rank), cTemplate(),
    md(['## 📦 내 선호 데이터 (👍 chosen vs 👎 rejected)\n', 'Connect AI에서 답변에 누른 **👍/👎로 만든 내 데이터**입니다.\n']),
    hasData
      ? code(['from datasets import load_dataset\n', 'ds = load_dataset("' + datasetRepo + '", data_files="connect-ai-dpo.jsonl", split="train", token=True)\n', 'print("내 선호 쌍:", len(ds)); print(ds[0])\n'])
      : code(['from datasets import Dataset\n', '# ⚠️ HF 데이터셋 미연결 — 예시. 앱에서 ②업로드하면 자동으로 내 데이터가 들어옵니다.\n', 'ds = Dataset.from_list([{"prompt":"1인 기업 어떻게 시작해?","chosen":"강점·문제·첫 고객부터 정리하세요.","rejected":"검색해보세요."}])\n', 'print("선호 쌍:", len(ds))\n']),
    md(['## 🎯 DPO 학습\n', '`beta`(0.1)는 원래 모델에서 얼마나 벗어날지. 작을수록 보수적.\n']),
    code([
      'from trl import DPOTrainer, DPOConfig\n',
      'trainer = DPOTrainer(model=model, ref_model=None, tokenizer=tokenizer, train_dataset=ds,\n',
      '    args=DPOConfig(per_device_train_batch_size=1, gradient_accumulation_steps=4, warmup_steps=5,\n',
      '        max_steps=30, learning_rate=5e-5, beta=0.1, logging_steps=1, optim="adamw_8bit",\n',
      '        lr_scheduler_type="linear", seed=3407, report_to="none"))\n',
      'trainer.train()\n', 'print("🎉 DPO 학습 완료 — 답변이 chosen 쪽으로 정렬됩니다")\n',
    ]),
    ...cSave(out, quant),
  ]);
}

// 방법론 id → 노트북 생성. sft 는 기존 정식 노트북(buildNotebook) 사용.
export function buildMethodNotebook(method: string, datasetRepo: string, base: string, outRepo: string, dataCount: number, opts: TrainOpts): string {
  const rank = opts.rank || 16, quant = opts.quant || 'q4_k_m';
  switch (method) {
    case 'dpo': return nbDPO(datasetRepo, base, outRepo, rank, quant);
    case 'sft':
    default: return buildNotebook(datasetRepo, base, outRepo, dataCount, opts);
  }
}
