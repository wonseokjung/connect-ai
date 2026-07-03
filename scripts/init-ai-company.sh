#!/usr/bin/env bash
# init-ai-company.sh — 1인 AI 기업 부트스트랩.
#
# Connect AI Lab이 "실제로 돌아가는 상태"가 되기 위해 필요한 로컬 인프라를
# 한 번에 세팅한다 (idempotent — 이미 있으면 건드리지 않음):
#   1. 브레인 폴더      ~/.connect-ai-brain/
#   2. 회사 폴더        ~/.connect-ai-brain/_company/
#   3. _shared 시드     identity.md · goals.md · decisions.md · tracker.json · orders.json
#   4. VS Code 설정     connectAiLab.localBrainPath · ollamaUrl · defaultModel
#   5. Ollama 엔진 점검  (설치·실행·모델 보유 여부)
#
# 사용:
#   bash scripts/init-ai-company.sh                 # 기본 brain 경로
#   BRAIN_DIR=~/my-brain bash scripts/init-ai-company.sh
#
# Ollama 모델 풀은 이 스크립트가 건드리지 않는다 (긴 다운로드):
#   ollama pull qwen2.5:14b
set -euo pipefail

# ───────────────────────── Config ─────────────────────────
BRAIN_DIR="${BRAIN_DIR:-$HOME/.connect-ai-brain}"
COMPANY_DIR="$BRAIN_DIR/_company"
SHARED_DIR="$COMPANY_DIR/_shared"
MODEL="${MODEL:-qwen2.5:14b}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"

ok()   { printf "\033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "\033[33m!\033[0m %s\n" "$1"; }
info() { printf "· %s\n" "$1"; }

# ───────────────────────── 1. Brain + Company dirs ─────────────────────────
mkdir -p "$SHARED_DIR"
ok "브레인/회사 폴더 준비: $COMPANY_DIR"

# ───────────────────────── 2. _shared 시드 파일 ─────────────────────────
# identity.md — 회사 정체성. 확장의 _seedShared 포맷과 동일.
if [ ! -f "$SHARED_DIR/identity.md" ]; then
  cat > "$SHARED_DIR/identity.md" <<'EOF'
# 🏢 회사 정체성 / 톤앤매너

_브랜드 보이스, 톤, 절대 금지어 등을 적으세요. 모든 에이전트가 매번 참조합니다._

- **회사 이름:** 1인 AI 기업
- **대표자:** 사장님
- **타깃 청중:** (오더마다 결정)
- **핵심 가치:** 자율 파이프라인 — 아이디어 → 화면기획 → 화면구현 → 개발 → 운영
- **브랜드 톤:** 전문적이고 간결한 한국어
- **금기 (절대 하지 말 것):** 허위 정보, 검증 없는 단언

> 이 파일은 사용자가 직접 편집하거나 작업하면서 자가학습으로 채워집니다.
EOF
  ok "identity.md 시드 작성"
else
  info "identity.md 이미 존재 — 건드리지 않음"
fi

# goals.md — 공동 목표 (북극성). 자율 오더 파이프라인 중심.
if [ ! -f "$SHARED_DIR/goals.md" ]; then
  cat > "$SHARED_DIR/goals.md" <<'EOF'
# 🎯 공동 목표 (Company Goals)

_이 파일은 모든 에이전트가 매번 읽는 회사의 북극성입니다._

## 장기 목표 (1년)
- [ ] 신규 오더를 받으면 ①아이디어 ②화면기획 ③화면구현 ④개발 ⑤운영 파이프라인 자동 완수
- [ ] 24시간 자율 사이클로 사용자가 없어도 회사 가치 지속 창출

## 단기 목표 (1개월)
- [ ] 각 오더를 끝까지(운영 단계까지) 끝낸다
- [ ] 단계별 산출물이 다음 단계로 명확하게 전달되게 한다

## 지금 가장 필요한 것
- 검증 가능한 산출물 (코드는 tsc/node --check 통과, 문서는 즉시 사용 가능)
EOF
  ok "goals.md 시드 작성"
else
  info "goals.md 이미 존재 — 건드리지 않음"
fi

# decisions.md — 의사결정 로그 (append-only). 확장이 자가학습으로 채움.
if [ ! -f "$SHARED_DIR/decisions.md" ]; then
  cat > "$SHARED_DIR/decisions.md" <<'EOF'
# 📌 회사 의사결정 로그

_사용자와 에이전트가 내린 의사결정이 시간순으로 누적됩니다. 자가학습의 1순위 신뢰 소스._

EOF
  ok "decisions.md 시드 작성"
else
  info "decisions.md 이미 존재 — 건드리지 않음"
fi

# tracker.json — 할 일 추적. 확장의 _trackerPath 포맷 (빈 배열 시작).
if [ ! -f "$SHARED_DIR/tracker.json" ]; then
  printf '[]\n' > "$SHARED_DIR/tracker.json"
  ok "tracker.json 초기화"
else
  info "tracker.json 이미 존재 — 건드리지 않음"
fi

# orders.json — 신규 오더 파이프라인 추적. (신기능 — 확장의 orders.ts가 사용)
if [ ! -f "$SHARED_DIR/orders.json" ]; then
  printf '[]\n' > "$SHARED_DIR/orders.json"
  ok "orders.json 초기화 (신규 오더 파이프라인용)"
else
  info "orders.json 이미 존재 — 건드리지 않음"
fi

# sessions/ 폴더 (CEO 분배·자율 사이클 산출물이 여기 쌓임)
mkdir -p "$COMPANY_DIR/sessions"
# orders/ 폴더 (오더별 산출물 루트)
mkdir -p "$COMPANY_DIR/orders"

# ───────────────────────── 3. VS Code 설정 ─────────────────────────
# settings.json 에 connectAiLab.* 키 주입 (VS Code CLI가 있을 때만).
VSCODE_CLI=""
if command -v code >/dev/null 2>&1; then VSCODE_CLI="code";
elif [ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
  VSCODE_CLI="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
fi
if [ -n "$VSCODE_CLI" ]; then
  "$VSCODE_CLI" --user-data-dir "$HOME/Library/Application Support/Code" \
    >/dev/null 2>&1 || true
  # 직접 settings.json 편집이 더 확실 — VS Code config API는 확장 활성화 시에만.
  SETTINGS="$HOME/Library/Application Support/Code/User/settings.json"
  if [ -f "$SETTINGS" ]; then
    # settings.json 이 JSON 유효한지 점검 (손상시키지 않도록)
    if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$SETTINGS" >/dev/null 2>&1; then
      python3 - "$SETTINGS" "$BRAIN_DIR" "$OLLAMA_URL" "$MODEL" <<'PYEOF'
import json, sys
path, brain, url, model = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
cfg = json.load(open(path))
cfg.setdefault('connectAiLab', {})
cfg['connectAiLab']['localBrainPath'] = brain
cfg['connectAiLab']['ollamaUrl'] = url
cfg['connectAiLab']['defaultModel'] = model
cfg['connectAiLab']['autoCycleEnabled'] = cfg['connectAiLab'].get('autoCycleEnabled', True)
json.dump(cfg, open(path, 'w'), indent=4, ensure_ascii=False)
PYEOF
      ok "VS Code settings.json 업데이트 (localBrainPath/ollamaUrl/defaultModel)"
    else
      warn "VS Code settings.json이 올바른 JSON이 아님 — 수동으로 connectAiLab.localBrainPath=$BRAIN_DIR 설정 필요"
    fi
  else
    warn "VS Code settings.json 없음 ($SETTINGS) — VS Code 한 번 실행 후 재시도"
  fi
else
  warn "VS Code CLI(code)를 찾을 수 없음 — settings.json 수동 설정 필요"
  info "  connectAiLab.localBrainPath = $BRAIN_DIR"
  info "  connectAiLab.ollamaUrl       = $OLLAMA_URL"
  info "  connectAiLab.defaultModel    = $MODEL"
fi

# ───────────────────────── 4. Ollama 점검 ─────────────────────────
if ! command -v ollama >/dev/null 2>&1; then
  warn "ollama 미설치 — brew install ollama && brew services start ollama"
elif ! curl -s -m 3 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
  warn "ollama API 응답 없음 ($OLLAMA_URL) — brew services start ollama 또는 ollama serve"
else
  if ollama list 2>/dev/null | grep -q "$MODEL"; then
    ok "Ollama 모델 보유: $MODEL"
  else
    warn "Ollama 모델 미풀: $MODEL"
    info "  실행: ollama pull $MODEL  (약 9GB, 수 분 소요)"
  fi
fi

# ───────────────────────── 5. launchd 자율 사이클 (요건 #7) ─────────────────────────
# node 경로 해석 — asdf shim(/.../.asdf/shims/node)은 bash 스크립트라 launchd 환경
# (프로파일 미로드)에서 깨질 수 있음. 실제 바이너리 경로를 우선 사용.
resolve_node_bin() {
  local candidate=""
  # (1) asdf 실제 install 경로 (가장 안정)
  if command -v asdf >/dev/null 2>&1; then
    candidate="$(asdf which node 2>/dev/null)"
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then echo "$candidate"; return; fi
  fi
  # (2) asdf shim 의 readlink 대상 — shim 파일에서 exec 경로 추출 시도
  if command -v node >/dev/null 2>&1; then
    local node_path; node_path="$(command -v node)"
    # shim 이면 asdf exec 로 위임 — 실제 바이너리 찾기 어려우면 shim 그대로(차선)
    if echo "$node_path" | grep -q "asdf/shims"; then
      # asdf 리스트에서 현재 버전의 install 경로 유추
      local ver; ver="$(asdf current nodejs 2>/dev/null | awk '{print $1}')"
      if [ -n "$ver" ]; then
        local install="$HOME/.asdf/installs/nodejs/$ver/bin/node"
        if [ -x "$install" ]; then echo "$install"; return; fi
      fi
    fi
    # shim 아닌 일반 바이너리면 그대로
    if [ -x "$node_path" ]; then echo "$node_path"; return; fi
  fi
  # (3) homebrew fallback
  for hb in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$hb" ]; then echo "$hb"; return; fi
  done
  echo ""
}

NODE_BIN="$(resolve_node_bin)"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_PATH="$HOME/Library/LaunchAgents/com.connectai.cycle.plist"
SHIMS_DIR="$HOME/.asdf/shims"

# plist 는 항상 최신 node 경로로 재작성 (idempotent — 덮어쓰기)
mkdir -p "$(dirname "$PLIST_PATH")"
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.connectai.cycle</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN:-node}</string>
    <string>${REPO_ROOT}/scripts/cycle.js</string>
  </array>
  <key>WorkingDirectory</key><string>${REPO_ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BRAIN_DIR</key><string>${COMPANY_DIR}</string>
    <key>MODEL</key><string>${MODEL}</string>
    <key>OLLAMA_URL</key><string>${OLLAMA_URL}</string>
    <key>PATH</key><string>${SHIMS_DIR}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${BRAIN_DIR}/cycle.log</string>
  <key>StandardErrorPath</key><string>${BRAIN_DIR}/cycle.err</string>
</dict>
</plist>
PLIST

if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then
  ok "node 경로 해석: $NODE_BIN (실행 가능)"
else
  warn "node 바이너리 해석 실패 — plist가 'node' 로 fallback (PATH 의존)"
fi

# launchd 등록 (이미 있으면 unload 후 load 로 갱신)
if launchctl list 2>/dev/null | grep -q com.connectai.cycle; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi
if launchctl load "$PLIST_PATH" 2>/dev/null; then
  ok "launchd 자율 사이클 등록: $PLIST_PATH (30분 간격)"
else
  info "launchd 등록은 macOS 전용 (이 환경에서 스킵 또는 수동)"
fi

# ───────────────────────── 완료 요약 ─────────────────────────
echo ""
echo "────────────────────────────────────────"
ok "1인 AI 기업 부트스트랩 완료"
echo "────────────────────────────────────────"
info "브레인 폴더: $BRAIN_DIR"
info "회사 폴더:   $COMPANY_DIR"
info "오더 추적:   $SHARED_DIR/orders.json"
echo ""
info "다음 단계:"
info "  1. ollama pull $MODEL  (모델 다운로드)"
info "  2. VS Code에서 Connect AI 확장 실행 → 회사 대시보드 확인"
info "  3. 사이드바에서 /order <명령> 으로 신규 오더"
