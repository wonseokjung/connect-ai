# /// script
# requires-python = ">=3.10"
# dependencies = ["mergekit", "torch", "transformers", "huggingface_hub", "gguf", "numpy", "sentencepiece", "protobuf"]
# ///
# 🔪 Connect AI — AI 합치기(Model Merging) 클라우드 수술 (HF Jobs UV 스크립트)
#
# 코랩 없이 한 줄로 (장기기억 학습과 똑같은 HF Jobs 방식):
#   hf jobs uv run --flavor l4x1 --timeout 1h --secrets HF_TOKEN \
#     -e MODEL_A=Qwen/Qwen2.5-1.5B-Instruct -e MODEL_B=Qwen/Qwen2.5-Coder-1.5B-Instruct \
#     -e OUTPUT_REPO=<user>/my-merged -e METHOD=slerp -e T=0.5 \
#     https://huggingface.co/datasets/<user>/connect-ai-surgery/resolve/main/merge_uv.py
import os, sys, subprocess

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

def main():
    if not (MODEL_A and MODEL_B and OUTPUT_REPO and HF_TOKEN):
        print("MODEL_A, MODEL_B, OUTPUT_REPO, HF_TOKEN(secret) 이 필요합니다.", file=sys.stderr); sys.exit(1)

    # 1) 합치기 설정 — SLERP/passthrough는 'slices'(정석), 그 외(ties/dare/linear)는 'models' 리스트
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

    # 2) 합치기 실행 (mergekit) → ./merged
    sh(["mergekit-yaml", "merge.yaml", "merged", "--cuda", "--allow-crimes", "--lazy-unpickle"])
    print("✅ 합치기 완료 → ./merged", flush=True)

    # 3) f16 GGUF 변환 (순수 파이썬 — llama.cpp convert 스크립트만 사용, 컴파일 불필요)
    gguf_path = None
    try:
        sh(["git", "clone", "--depth", "1", "https://github.com/ggml-org/llama.cpp"])
        sh([sys.executable, "-m", "pip", "install", "-q", "-r", "llama.cpp/requirements/requirements-convert_hf_to_gguf.txt"])
        gguf_path = "merged-f16.gguf"
        sh([sys.executable, "llama.cpp/convert_hf_to_gguf.py", "merged", "--outfile", gguf_path, "--outtype", "f16"])
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
