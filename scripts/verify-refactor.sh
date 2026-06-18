#!/usr/bin/env bash
# 리팩토링 검증 하네스 — 매 추출 단계마다 실행.
#   타입체크(strict)와 esbuild 번들이 둘 다 그린이어야 그 단계가 안전하다.
#   동작 보존 리팩토링이므로 "컴파일 + 번들 성공"이 곧 회귀 없음의 증거.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "── 1) tsc --noEmit (strict) ──────────────────"
npx tsc --noEmit -p .
TSC=$?
echo "tsc exit: $TSC"

echo "── 2) esbuild bundle ─────────────────────────"
npm run compile >/tmp/cai-compile.log 2>&1
ESB=$?
tail -4 /tmp/cai-compile.log
echo "esbuild exit: $ESB"

if [ "$TSC" -eq 0 ] && [ "$ESB" -eq 0 ]; then
  echo "✅ VERIFY PASS"
  exit 0
else
  echo "❌ VERIFY FAIL (tsc=$TSC esbuild=$ESB)"
  exit 1
fi
