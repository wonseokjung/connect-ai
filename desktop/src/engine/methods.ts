// 🎓 AI 학습 방법론 — 배움용. SFT·DPO 를 선택 → 각 방식별 교육 Colab 노트북 생성.
//   비개발자가 "각 방법이 뭐고·언제 쓰고·데이터가 어떻게 생겼나"를 직접 돌려보며 배우게 한다.
import { buildNotebook, TrainOpts } from './train';

export interface MethodMeta {
  id: string; label: string; emoji: string; level: '기본' | '중급' | '고급';
  tag: string;         // 비개발자용 쉬운 한 줄 (연구이름 대신 '무엇')
  full: string;        // 연구(이론) 풀네임
  paper?: string;      // arXiv 등 (표기용)
  arxiv?: string;      // arXiv ID — 클릭 시 논문 열기 (합성소와 동일 방식)
  what: string;        // 한 줄 정의(한국어 뜻)
  when: string;        // 언제 쓰나
  data: string;        // 필요한 데이터 형태
  note?: string;       // 주의/팁
}

// 모든 학습 방법은 연구(이론) 이름으로 — 합성소의 Task Arithmetic·SLERP 과 톤 통일.
export const METHODS: MethodMeta[] = [
  { id: 'sft', label: 'SFT', emoji: '📝', level: '기본', tag: '따라 배우기',
    full: 'Supervised Fine-Tuning', paper: 'LoRA · 2106.09685', arxiv: '2106.09685',
    what: '질문→모범답안 "정답지"로 지도학습 (LoRA 어댑터로 가볍게)', when: '정체성·페르소나·핵심 지식 주입', data: '질문-답변 쌍 (🔬증강으로 다양하게)', note: '가장 기본. 여기서 시작. 엔진=LoRA(Low-Rank Adaptation).' },
  { id: 'dpo', label: 'DPO', emoji: '⚖️', level: '중급', tag: '가려 다듬기',
    full: 'Direct Preference Optimization', paper: '2305.18290', arxiv: '2305.18290',
    what: '좋은답/나쁜답 선호쌍으로 품질 학습 (AI 자동 피드백·RLAIF)', when: '답변 품질·톤 다듬기 (SFT 다음 단계)', data: 'AI 자동 생성 선호쌍 (사람 클릭 0)', note: 'RLHF의 쉽고 안정적인 대체재.' },
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
export function buildMethodNotebook(method: string, datasetRepo: string, base: string, outRepo: string, dataCount: number, opts: TrainOpts, inlineJsonl = ''): string {
  const rank = opts.rank || 16, quant = opts.quant || 'q4_k_m';
  switch (method) {
    case 'dpo': return nbDPO(datasetRepo, base, outRepo, rank, quant);
    case 'sft':
    default: return buildNotebook(datasetRepo, base, outRepo, dataCount, opts, inlineJsonl);
  }
}

// ── 🧬 AI 합성소 (무료 Colab) — 능력 더하기/빼기·섞기를 직접. mergekit 없이 torch 텐서연산 → 모든 구조 OK ──
//    멤버십은 앱에서 원클릭(우리 GPU), 비멤버는 이 노트북으로 무료 Colab GPU에서 직접 = "누구나 AI 소유".
export function buildSurgeryNotebook(method: string, modelA: string, modelB: string, scale: number, outRepo: string): string {
  const isSub = method === 'task_sub';
  const isBlend = !method.startsWith('task');   // slerp/blend 등
  const title = isBlend ? '🔀 두 AI 섞기 (Blend)' : isSub ? '➖ 능력 빼기 (Task Arithmetic · Negation)' : '➕ 능력 더하기 (Task Arithmetic · Addition)';
  const concept = isBlend
    ? ['## 🌐 두 AI를 섞어 새 AI 만들기 — SLERP(구면 선형 보간)\n', '**SLERP**: 두 가중치를 직선이 아니라 **구면(곡면)을 따라** 부드럽게 섞어요. 원조는 컴퓨터그래픽스 논문 **K. Shoemake, SIGGRAPH 1985** (3D 회전 보간) — 그걸 모델 병합에 가져온 거예요.\n']
    : isSub
      ? ['## ➖ 능력 빼기 — Task Arithmetic (Negation)\n', '논문 **arXiv:2212.04089**. 능력 벡터 `τ = (능력모델 − 원본)`.\n', '`결과 = 능력모델 − 강도×τ` → 그 능력만 지워 원본 쪽으로.\n']
      : ['## ➕ 능력 더하기 — Task Arithmetic (Addition)\n', '논문 **arXiv:2212.04089**. 능력 벡터 `τ = (능력모델 − 원본)`.\n', '`결과 = 원본 + 강도×τ` → 원본이 그 능력을 획득.\n'];
  const name = (outRepo.split('/').pop() || 'my-merged');   // 🆔 결과 모델 이름만 — 계정은 Colab 로그인한 본인 것으로
  const cells = [
    md(['# ', title, ' — 무료 Colab\n', '\n',
        '비개발자도 **런타임 → 모두 실행**만 누르면 돼요. 결과가 내 HuggingFace에 올라가고, Connect AI 앱에서 "받기"로 바로 씁니다.\n', '\n',
        '> 💎 멤버십은 앱에서 버튼 하나(우리 GPU). 여기선 **무료 Colab GPU**로 직접 — 누구나 AI를 *소유*.\n']),
    md(concept),
    code(['%%capture\n', '!pip install -q torch transformers huggingface_hub peft accelerate safetensors\n']),
    md(['## 🔑 HuggingFace 로그인 (무료)\n',
        '결과를 저장할 **무료 HuggingFace 계정**이 필요해요(결제 X). 아래에서 1분이면 됩니다:\n',
        '1. [huggingface.co 무료 가입](https://huggingface.co/join) → 2. [**write** 토큰 만들기](https://huggingface.co/settings/tokens) → 3. 아래 칸에 붙여넣기\n']),
    code(['from huggingface_hub import notebook_login\n', 'notebook_login()\n']),
    md(['## ⚙️ 설정 — 이 4개만 보면 돼요\n', '`MODEL_A`=원본 · `MODEL_B`=상대(능력) · `METHOD` · `SCALE`(강도)\n', '\n', '> 💡 무료 Colab(T4·16GB)은 **작은 모델 2개**(예: 0.5B~1.5B 같은 구조)에 적합해요. 7B+ 두 개는 메모리 초과될 수 있어요.\n']),
    code([
      'import torch\n',
      'from transformers import AutoModelForCausalLM, AutoTokenizer\n',
      'from huggingface_hub import HfApi\n', '\n',
      'MODEL_A = "' + modelA + '"   # 원본\n',
      'MODEL_B = "' + modelB + '"   # 상대(능력) 모델\n',
      'METHOD  = "' + method + '"   # task_add | task_sub | blend\n',
      'SCALE   = ' + (Number.isFinite(scale) ? scale : 1.0) + '       # 강도(λ). 1.0 권장\n',
      'NAME    = "' + name + '"  # 결과 모델 이름 (계정은 위에서 로그인한 본인 것으로 자동)\n', '\n',
      'def load(repo):\n',
      '    files = HfApi().list_repo_files(repo)\n',
      '    full = any(f.endswith(".safetensors") and not f.startswith("adapter") for f in files)\n',
      '    if (not full) and ("adapter_config.json" in files):\n',
      '        from peft import AutoPeftModelForCausalLM\n',
      '        print("🔧 LoRA 어댑터 → 원본에 자동 병합:", repo)\n',
      '        return AutoPeftModelForCausalLM.from_pretrained(repo, torch_dtype=torch.bfloat16, low_cpu_mem_usage=True).merge_and_unload()\n',
      '    return AutoModelForCausalLM.from_pretrained(repo, torch_dtype=torch.bfloat16, low_cpu_mem_usage=True)\n', '\n',
      '# 방식에 따라 기준(base)·상대(other) 정하기 — 빼기는 능력모델(B)이 기준\n',
      'base_id, other_id = (MODEL_B, MODEL_A) if METHOD == "task_sub" else (MODEL_A, MODEL_B)\n',
      'print("📥 두 모델 로딩…")\n',
      'base = load(base_id); other = load(other_id)\n', '\n',
      '# 🌐 SLERP(구면 선형 보간) — Shoemake 1985. 두 가중치를 구면을 따라 t만큼 보간.\n',
      'def slerp(a, b, t):\n',
      '    af, bf = a.flatten().float(), b.flatten().float()\n',
      '    na, nb = af.norm(), bf.norm()\n',
      '    if na < 1e-8 or nb < 1e-8:\n',
      '        return torch.lerp(a.float(), b.float(), t).to(a.dtype)\n',
      '    dot = ((af / na) * (bf / nb)).sum().clamp(-1.0, 1.0)\n',
      '    theta = torch.arccos(dot)\n',
      '    if theta < 1e-4:                      # 거의 평행 → 직선 보간으로 안전 폴백\n',
      '        return torch.lerp(a.float(), b.float(), t).to(a.dtype)\n',
      '    st = torch.sin(theta)\n',
      '    out = (torch.sin((1 - t) * theta) / st) * af + (torch.sin(t * theta) / st) * bf\n',
      '    return out.reshape(a.shape).to(a.dtype)\n', '\n',
      '# blend=SLERP(구면) · task=Task Arithmetic(base + λ(other−base)) — 구조 무관\n',
      'o = dict(other.named_parameters()); applied = 0\n',
      'is_task = METHOD.startswith("task")\n',
      'with torch.no_grad():\n',
      '    for n, p in base.named_parameters():\n',
      '        q = o.get(n)\n',
      '        if q is None or q.shape != p.shape: continue\n',
      '        if is_task:\n',
      '            p.add_((q.data.to(p.dtype) - p.data) * float(SCALE))           # ➕➖ 능력 더하기/빼기\n',
      '        else:\n',
      '            p.copy_(slerp(p.data, q.data.to(p.dtype), float(SCALE)))        # 🌐 SLERP 섞기\n',
      '        applied += 1\n',
      'print(f"✅ {applied}개 가중치에 적용 (방식={METHOD}, 강도={SCALE})")\n', '\n',
      '# 📤 결과를 "내" HuggingFace 계정에 업로드 — 위에서 로그인한 본인 계정으로 자동\n',
      'ME = HfApi().whoami()["name"]      # 지금 로그인한 내 HF 아이디\n',
      'OUTPUT = f"{ME}/{NAME}"            # → 내 계정/모델이름\n',
      'tok = AutoTokenizer.from_pretrained(base_id)\n',
      'base.push_to_hub(OUTPUT); tok.push_to_hub(OUTPUT)\n',
      'print(f"🎉 모델 업로드 완료 → https://huggingface.co/{OUTPUT}")\n']),
    md(['## 🧊 GGUF로 변환 (앱에서 바로 켜지게)\n',
        '내장 엔진(llama.cpp)은 **GGUF** 형식만 켤 수 있어요. 합친 모델을 GGUF로 바꿔 같이 올립니다. (몇 분 소요)\n']),
    code([
      '# 합친 모델을 로컬에 저장 → llama.cpp로 GGUF 변환 → 내 repo에 업로드\n',
      'base.save_pretrained("merged"); tok.save_pretrained("merged")\n',
      '!git clone -q https://github.com/ggml-org/llama.cpp\n',
      '# ⚠️ 변환에 필요한 것만 설치 — llama.cpp requirements.txt는 torch를 CPU판으로 재설치해 GPU를 깨뜨림(절대 쓰지 말 것)\n',
      '!pip install -q gguf sentencepiece protobuf\n',
      '!python llama.cpp/convert_hf_to_gguf.py merged --outfile merged-f16.gguf --outtype f16\n',
      'HfApi().upload_file(path_or_fileobj="merged-f16.gguf", path_in_repo="merged-f16.gguf", repo_id=OUTPUT)\n',
      'print("✅ GGUF 업로드 완료 → Connect AI 앱 🤖 내 AI 에서 받아 바로 켜집니다!")\n',
      'print(f"👉 {OUTPUT}")\n']),
    md(['## 🎉 끝!\n', '결과(모델 + GGUF)가 **내 HuggingFace 계정**에 올라갔어요. Connect AI 앱 🤖 내 AI에서 받아 쓰면 됩니다.\n', '더 쉽게 하려면 → 💎 멤버십(앱에서 버튼 하나, 우리 GPU).\n']),
  ];
  return wrap(cells);
}
