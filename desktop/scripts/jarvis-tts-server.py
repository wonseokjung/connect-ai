# /// script
# requires-python = ">=3.10"
# dependencies = ["kokoro>=0.9.4", "soundfile", "flask", "torch", "numpy"]
# ///
# 🦾 자비스 로컬 TTS 서버 — Kokoro-82M 영국 남성 보이스 (무료·완전 로컬·MIT)
#
# Connect AI 데스크톱의 "로컬 TTS 서버" 훅(ttsLocalUrl)에 꽂는 백엔드.
# 영어 문장은 영화 J.A.R.V.I.S. 같은 영국 집사 톤이 난다. (한국어 발음은 약함 — 한국어 위주면 앱 내장 🦾 자비스(Edge) 권장)
#
# 실행:
#   1) uv 설치 (한 번만):  brew install uv      (윈도우: winget install astral-sh.uv)
#   2) uv run jarvis-tts-server.py              (첫 실행 시 모델 ~300MB 자동 다운로드)
#   3) 앱 ⚙️ 설정 → 🖥️ 로컬 Qwen3-TTS 서버 = http://127.0.0.1:7920
#      목소리 = "Sohee(Qwen)" 계열 대신 → 드롭다운에서 "자비스 로컬" 선택
#
# 프로토콜: POST /tts  {"text": "...", "voice": "..."}  → audio/wav 바이트
#           GET  /health → ok

import io

import numpy as np
import soundfile as sf
from flask import Flask, jsonify, request
from kokoro import KPipeline

PORT = 7920
# 🎩 영국 남성 보이스 — george(중후한 집사·기본), fable(또렷), lewis(낮음), daniel(차분)
VOICE_MAP = {
    "jarvis-local": "bm_george",
    "george": "bm_george",
    "fable": "bm_fable",
    "lewis": "bm_lewis",
    "daniel": "bm_daniel",
}
DEFAULT_VOICE = "bm_george"
SPEED = 0.92  # 살짝 느리게 = 더 진중한 집사 톤

app = Flask(__name__)
print("🦾 Kokoro 로딩 중… (첫 실행은 모델 다운로드로 1~2분)")
pipeline = KPipeline(lang_code="b")  # 'b' = British English
print(f"✅ 준비 완료 — http://127.0.0.1:{PORT}  (보이스: {DEFAULT_VOICE})")


@app.post("/tts")
def tts():
    body = request.get_json(silent=True) or {}
    text = str(body.get("text") or "").strip()[:1200]
    if not text:
        return jsonify({"error": "text 없음"}), 400
    voice = VOICE_MAP.get(str(body.get("voice") or "").strip(), DEFAULT_VOICE)
    chunks = [audio for _, _, audio in pipeline(text, voice=voice, speed=SPEED)]
    if not chunks:
        return jsonify({"error": "합성 실패"}), 500
    wav = np.concatenate(chunks)
    buf = io.BytesIO()
    sf.write(buf, wav, 24000, format="WAV")
    return buf.getvalue(), 200, {"Content-Type": "audio/wav"}


@app.get("/health")
def health():
    return "ok"


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, threaded=True)
