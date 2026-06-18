# /// script
# requires-python = ">=3.10"
# dependencies = ["mergekit", "torch", "transformers", "huggingface_hub", "gguf", "numpy", "sentencepiece", "protobuf", "peft", "accelerate"]
# ///
# 🔪 Connect AI — AI 합치기(Model Merging) 클라우드 수술 (HF Jobs UV 스크립트)
#
# 코랩 없이 한 줄로 (장기기억 학습과 똑같은 HF Jobs 방식):
#   hf jobs uv run --flavor l4x1 --timeout 1h --secrets HF_TOKEN \
#     -e MODEL_A=Qwen/Qwen2.5-1.5B-Instruct -e MODEL_B=Qwen/Qwen2.5-Coder-1.5B-Instruct \
#     -e OUTPUT_REPO=<user>/my-merged -e METHOD=slerp -e T=0.5 \
#     https://huggingface.co/datasets/<user>/connect-ai-surgery/resolve/main/merge_uv.py
import os, sys, subprocess, time

# 🌐 HF 다운로드를 타임아웃에 강하게 — 기본 10초는 느린/붐비는 Hub에서 ReadTimeout(=합치기 실패) 유발.
#    실제 제보: 'Can't load the configuration of …' 는 사실 모델명 문제가 아니라 다운로드 타임아웃이었음.
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "60")       # 10s → 60s
os.environ.setdefault("HF_XET_HIGH_PERFORMANCE", "1")        # Xet 고속 다운로드(hf_transfer 후속 · 최신 hub 권장)

MODEL_A = os.environ.get("MODEL_A", "")
MODEL_B = os.environ.get("MODEL_B", "")
METHOD  = os.environ.get("METHOD", "slerp")
T       = os.environ.get("MERGE_T", os.environ.get("T", "0.5"))
OUTPUT_REPO = os.environ.get("OUTPUT_REPO", "")
HF_TOKEN = os.environ.get("HF_TOKEN", "")
GGUF_QUANT = os.environ.get("GGUF_QUANT", "f16")   # f16 = 순수 파이썬 변환(빌드 불필요)

def sh(cmd):
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)

# 🩹 mergekit ↔ pydantic 호환 픽스 — mergekit의 pydantic 모델들이 torch 전방참조(forward-ref)를
#    런타임에 못 풀어 'ConfiguredArchitectureInfo is not fully defined'로 죽는 문제(pydantic 2.9~2.10 공통).
#    해법: torch를 각 모듈 네임스페이스에 넣고 모든 BaseModel을 강제 재빌드한 뒤 in-process로 실행.
def run_mergekit(args):
    import importlib, inspect, pydantic
    import torch as _torch
    # 1) 전체 그래프를 먼저 임포트 — run_yaml 이 끌어오는 architecture/plan/config 등 모든 모델을 적재
    from mergekit.scripts.run_yaml import main as mk_main
    for m in ["mergekit.architecture", "mergekit.architecture.base", "mergekit.plan",
              "mergekit.config", "mergekit.merge_methods", "mergekit.common", "mergekit.graph"]:
        try: importlib.import_module(m)
        except Exception: pass
    # 2) torch 를 모든 mergekit 모듈 네임스페이스에 주입(전방참조 해소용)
    for name, mod in list(sys.modules.items()):
        if name.startswith("mergekit") and hasattr(mod, "__dict__"):
            try: setattr(mod, "torch", _torch)
            except Exception: pass
    # 3) 모델 의존성 순서 때문에 1회로는 일부만 성공 → 안정될 때까지 여러 번 재빌드
    def collect():
        cs = []
        for name, mod in list(sys.modules.items()):
            if name.startswith("mergekit") and hasattr(mod, "__dict__"):
                for obj in list(vars(mod).values()):
                    if inspect.isclass(obj) and issubclass(obj, pydantic.BaseModel):
                        cs.append(obj)
        return cs
    for _ in range(6):
        rebuilt = 0
        for obj in collect():
            try: obj.model_rebuild(force=True, _types_namespace={"torch": _torch}); rebuilt += 1
            except Exception: pass
        print(f"🩹 호환 픽스 패스: pydantic={pydantic.__version__}, {rebuilt}개 재빌드", flush=True)
    old = sys.argv; sys.argv = ["mergekit-yaml"] + args
    try:
        mk_main()
    except SystemExit as e:
        if e.code not in (0, None): raise
    finally:
        sys.argv = old

# 🔁 모델을 미리 캐시에 받아둔다(재시도 포함) → mergekit이 네트워크 대신 로컬에서 읽어 타임아웃 실패를 막음.
def prefetch(repo, token, tries=4):
    from huggingface_hub import snapshot_download
    for i in range(tries):
        try:
            snapshot_download(repo, token=token,
                              allow_patterns=["*.json", "*.safetensors", "*.model", "*.txt", "tokenizer*", "*.bin", "*.py"])
            print(f"✅ 모델 캐시 완료: {repo}", flush=True); return
        except Exception as e:
            wait = 6 * (i + 1)
            print(f"⚠️ {repo} 다운로드 재시도 {i+1}/{tries} ({wait}s 후) — {e}", file=sys.stderr, flush=True)
            time.sleep(wait)
    print(f"❌ {repo} 를 받지 못했어요(네트워크 불안정). 잠시 후 다시 합성해 주세요.", file=sys.stderr); sys.exit(1)

def repo_kind(repo, token):
    # 합칠 수 있는 형태인지 분류: 'full'(풀 safetensors) | 'adapter'(LoRA만) | None(불가)
    from huggingface_hub import HfApi
    try:
        files = HfApi(token=token).list_repo_files(repo)
    except Exception as e:
        print(f"❌ '{repo}' 정보를 불러올 수 없어요(주소·접근권한 확인): {e}", file=sys.stderr); sys.exit(1)
    has_full = any(f.endswith(".safetensors") and not f.startswith("adapter") for f in files) \
        or any(f.endswith(".bin") and "pytorch_model" in f for f in files)
    has_adapter = ("adapter_config.json" in files) and any("adapter_model" in f for f in files)
    if has_full: return "full"
    if has_adapter: return "adapter"   # 🔧 어댑터는 원본+병합 후 사용
    only_gguf = any(f.endswith(".gguf") for f in files)
    why = ("GGUF 파일만 있어요(LM Studio 전용) — 합성엔 못 써요. 학습할 때 safetensors도 저장되게 해주세요."
           if only_gguf else "가중치 파일이 없는 저장소예요.")
    print(f"❌ '{repo}' 에는 합칠 수 있는 가중치가 없어요.\n   {why}\n   👉 합성은 풀모델(safetensors) 또는 LoRA 어댑터만 됩니다.",
          file=sys.stderr); sys.exit(1)

def load_full_model(repo, token):
    # 🔧 풀모델이면 그대로, LoRA 어댑터면 원본+어댑터 자동 병합(peft) → 풀모델로 반환. (구조 무관)
    import torch
    kind = repo_kind(repo, token)
    kw = dict(torch_dtype=torch.bfloat16, low_cpu_mem_usage=True, token=token, trust_remote_code=True)
    if kind == "adapter":
        print(f"🔧 '{repo}' 는 LoRA 어댑터 → 원본에 병합 중…", flush=True)
        from peft import AutoPeftModelForCausalLM
        m = AutoPeftModelForCausalLM.from_pretrained(repo, **kw)
        return m.merge_and_unload()
    from transformers import AutoModelForCausalLM, AutoModel
    try:
        return AutoModelForCausalLM.from_pretrained(repo, **kw)
    except Exception as e:
        print(f"ℹ️ CausalLM 로드 실패 → AutoModel 시도(멀티모달 등): {e}", flush=True)
        return AutoModel.from_pretrained(repo, **kw)

def run_task_arithmetic_torch(base_repo, other_repo, scale, token):
    # ➗ Task Arithmetic 를 mergekit 없이 torch 텐서 연산으로 직접 — 구조 정의 불필요 → gemma-4 등 모든 모델 OK.
    #    결과 = base + scale·(other − base)  (이름·모양 같은 텐서끼리만).  → ./merged 에 safetensors로 저장.
    import torch
    from transformers import AutoTokenizer
    print("📥 두 모델 로딩(torch 직접 계산)…", flush=True)
    base = load_full_model(base_repo, token)
    other = load_full_model(other_repo, token)
    o = dict(other.named_parameters())
    applied = skipped = 0
    with torch.no_grad():
        for nme, p in base.named_parameters():
            q = o.get(nme)
            if q is not None and q.shape == p.shape:
                p.add_((q.data.to(p.dtype) - p.data) * float(scale)); applied += 1
            else:
                skipped += 1
    print(f"✅ Task Arithmetic(torch, mergekit 불필요): {applied}개 텐서 적용 · {skipped}개 건너뜀 · scale={scale}", flush=True)
    del other
    base.save_pretrained("merged", safe_serialization=True)
    AutoTokenizer.from_pretrained(base_repo, token=token).save_pretrained("merged")
    print("✅ 합치기 완료 → ./merged (safetensors)", flush=True)

def assert_mergeable(repo, token):
    repo_kind(repo, token)   # 불가면 내부에서 종료

def main():
    if not (MODEL_A and MODEL_B and OUTPUT_REPO and HF_TOKEN):
        print("MODEL_A, MODEL_B, OUTPUT_REPO, HF_TOKEN(secret) 이 필요합니다.", file=sys.stderr); sys.exit(1)

    # 0) 합칠 수 있는 모델인지 먼저 점검(10GB 받기 전에) → 안 되면 명확한 이유로 즉시 종료
    assert_mergeable(MODEL_A, HF_TOKEN); assert_mergeable(MODEL_B, HF_TOKEN)

    # 0-2) 두 모델을 미리 받아둔다(재시도) — 다운로드 타임아웃으로 합치기가 죽던 문제 예방
    prefetch(MODEL_A, HF_TOKEN); prefetch(MODEL_B, HF_TOKEN)

    # 1) 능력 더하기/빼기(Task Arithmetic)는 mergekit 없이 torch로 직접 → gemma-4 등 모든 구조 OK.
    if METHOD == "task_add":      # ➕ A + λ(B−A) : 원본(A)에 능력 더하기
        run_task_arithmetic_torch(MODEL_A, MODEL_B, float(T), HF_TOKEN)
    elif METHOD == "task_sub":    # ➖ B + λ(A−B) = B − λ(B−A) : 능력모델(B)에서 능력 빼기
        run_task_arithmetic_torch(MODEL_B, MODEL_A, float(T), HF_TOKEN)
    else:
        # 그 외(SLERP/passthrough/ties/dare/linear)는 mergekit 사용
        import yaml
        from transformers import AutoConfig
        n = int(getattr(AutoConfig.from_pretrained(MODEL_A), "num_hidden_layers", 0)) or 32   # 실제 레이어 수
        if METHOD in ("slerp", "passthrough"):
            conf = {"slices": [{"sources": [
                        {"model": MODEL_A, "layer_range": [0, n]},
                        {"model": MODEL_B, "layer_range": [0, n]}]}],
                    "merge_method": METHOD, "base_model": MODEL_A,
                    "parameters": {"t": float(T)}, "dtype": "bfloat16"}
        else:
            conf = {"models": [{"model": MODEL_A}, {"model": MODEL_B}],
                    "merge_method": METHOD, "base_model": MODEL_A,
                    "parameters": {"weight": [1.0 - float(T), float(T)]}, "dtype": "bfloat16"}
        with open("merge.yaml", "w") as f:
            yaml.safe_dump(conf, f)
        print(f"✅ 합치기 설정 (레이어 {n}, {METHOD}):\n", open("merge.yaml").read(), flush=True)
        run_mergekit(["merge.yaml", "merged", "--cuda", "--allow-crimes", "--lazy-unpickle"])   # pydantic 호환 픽스 적용
    print("✅ 합치기 완료 → ./merged", flush=True)

    # 3) f16 GGUF 변환 (순수 파이썬 — llama.cpp convert 스크립트만 사용, 컴파일 불필요)
    gguf_path = None
    try:
        import urllib.request, zipfile, io as _io
        print("📥 llama.cpp 받는 중 (zip — git 불필요)...", flush=True)
        _z = urllib.request.urlopen("https://github.com/ggml-org/llama.cpp/archive/refs/heads/master.zip", timeout=180).read()
        zipfile.ZipFile(_io.BytesIO(_z)).extractall(".")
        _ld = "llama.cpp-master"
        # convert 의존성(gguf·numpy·sentencepiece·protobuf·transformers)은 이미 위 스크립트 헤더에 설치됨.
        # uv 환경엔 pip이 없어 'python -m pip'가 실패하므로, 혹시 빠진 것만 uv로 보강(실패해도 진행).
        try: sh(["uv", "pip", "install", "-q", "gguf", "numpy", "sentencepiece", "protobuf"])
        except Exception as _ie: print(f"(의존성 보강 생략: {_ie})", flush=True)
        gguf_path = "merged-f16.gguf"
        sh([sys.executable, f"{_ld}/convert_hf_to_gguf.py", "merged", "--outfile", gguf_path, "--outtype", "f16"])
        print(f"✅ GGUF 변환 완료 → {gguf_path}", flush=True)
    except Exception as e:
        print(f"⚠️ GGUF 변환 실패(합쳐진 모델은 업로드됨): {e}", file=sys.stderr)

    # 4) 업로드 (safetensors 합본 + GGUF)
    from huggingface_hub import HfApi, create_repo
    api = HfApi(token=HF_TOKEN)
    create_repo(OUTPUT_REPO, token=HF_TOKEN, exist_ok=True, repo_type="model")
    api.upload_folder(folder_path="merged", repo_id=OUTPUT_REPO, ignore_patterns=["*.gguf"])
    if gguf_path and os.path.exists(gguf_path):
        api.upload_file(path_or_fileobj=gguf_path, path_in_repo=os.path.basename(gguf_path), repo_id=OUTPUT_REPO)
    print(f"✅ 수술 완료 → https://huggingface.co/{OUTPUT_REPO}", flush=True)

if __name__ == "__main__":
    main()
