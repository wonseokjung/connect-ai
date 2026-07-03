#!/usr/bin/env bash
# clean-demo-orders.sh — 데모/검증용 오더 정리 (요건 #9).
#
# 파이프라인 검증용으로 만든 데모 오더(강아지 용품/고양이 간식 등)와 자율사이클
# sessions 가 실사용 데이터와 섞여 brain 에 남아있음. 이 스크립트가 식별·제거.
#
# 안전장치:
#   - dry-run 기본 (제거 대상만 출력, 실제 삭제 안 함)
#   - --confirm 있어야 실제 삭제
#   - 삭제 전 orders.json.demo-backup-<ts> 백업
#   - 타임스탬프 + title 키워드 매칭으로 보수적 식별
#
# 사용:
#   bash scripts/clean-demo-orders.sh              # dry-run (대상만 표시)
#   bash scripts/clean-demo-orders.sh --confirm    # 실제 삭제
set -euo pipefail

BRAIN_DIR="${BRAIN_DIR:-$HOME/.connect-ai-brain}"
COMPANY_DIR="$BRAIN_DIR/_company"
ORDERS_JSON="$COMPANY_DIR/_shared/orders.json"
ORDERS_DIR="$COMPANY_DIR/orders"

ok()   { printf "\033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "\033[33m!\033[0m %s\n" "$1"; }
info() { printf "· %s\n" "$1"; }

CONFIRM=false
[ "${1:-}" = "--confirm" ] && CONFIRM=true

if [ ! -f "$ORDERS_JSON" ]; then
  warn "orders.json 없음: $ORDERS_JSON"
  exit 0
fi

# 데모 오더 식별: title 이 데모 키워드를 포함하거나 2026-07-03(데모 실행일) 생성.
# node 로 JSON 파싱 (안전).
DEMO_KEYWORDS='강아지 용품|고양이 간식|동시성테스트|abort테스트|데모'
DEMO_DATE="2026-07-03"

mapfile -t DEMO_IDS < <(node -e "
const fs = require('fs');
const orders = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
const kw = new RegExp(process.argv[2], 'i');
const demoDate = process.argv[3];
const demo = orders.filter(o =>
  kw.test(o.title || '') || kw.test(o.prompt || '') ||
  (o.createdAt || '').startsWith(demoDate)
);
demo.forEach(o => console.log(o.id + '|' + (o.title || '').slice(0, 50) + '|' + o.status));
" "$ORDERS_JSON" "$DEMO_KEYWORDS" "$DEMO_DATE" 2>/dev/null || true)

if [ ${#DEMO_IDS[@]} -eq 0 ]; then
  ok "데모 오더 없음 — 정리할 것이 없습니다."
  exit 0
fi

echo "=== 데모 오더 식별 (${#DEMO_IDS[@]}개) ==="
for line in "${DEMO_IDS[@]}"; do
  IFS='|' read -r id title status <<< "$line"
  info "$id — $title ($status)"
done
echo ""

# sessions/auto-* + cycle.* 정리 대상 미리 보기 (dry-run / confirm 공통)
SESSIONS_DIR="$COMPANY_DIR/sessions"
CLEAN_FILES=("$BRAIN_DIR/cycle.log" "$BRAIN_DIR/cycle.err" "$COMPANY_DIR/cycle.health" "$COMPANY_DIR/cycle.alert")
AUTO_COUNT=$(find "$SESSIONS_DIR" -maxdepth 1 -type d -name 'auto-*' 2>/dev/null | wc -l | tr -d ' ')
echo "=== 추가 정리 대상 (자율 사이클 잔재) ==="
info "sessions/auto-* 폴더: ${AUTO_COUNT}개"
for f in "${CLEAN_FILES[@]}"; do
  [ -f "$f" ] && info "$(basename "$f"): 존재"
done
echo ""

if [ "$CONFIRM" = false ]; then
  warn "dry-run 모드 — 실제 삭제하려면 --confirm 플래그 사용"
  info "실행: bash scripts/clean-demo-orders.sh --confirm"
  exit 0
fi

# 백업
TS=$(date +%Y%m%d%H%M%S)
BACKUP="$ORDERS_JSON.demo-backup-$TS"
cp "$ORDERS_JSON" "$BACKUP"
ok "백업: $BACKUP"

# 제거: orders.json 에서 데모 ID 필터링 + orders/<id>/ 폴더 삭제
node -e "
const fs = require('fs');
const path = require('path');
const ordersJson = process.argv[1];
const ordersDir = process.argv[2];
const demoIds = process.argv[3].split(',');
const orders = JSON.parse(fs.readFileSync(ordersJson, 'utf-8'));
const kept = orders.filter(o => !demoIds.includes(o.id));
fs.writeFileSync(ordersJson, JSON.stringify(kept, null, 2));
console.log('orders.json: ' + orders.length + ' → ' + kept.length + ' (' + demoIds.length + '개 제거)');
let removed = 0;
for (const id of demoIds) {
  const dir = path.join(ordersDir, id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    removed++;
  }
}
console.log('orders/ 폴더 제거: ' + removed + '개');
" "$ORDERS_JSON" "$ORDERS_DIR" "$(printf '%s\n' "${DEMO_IDS[@]}" | cut -d'|' -f1 | paste -sd, -)"

# v0.4.9 — 자율 사이클 검증 잔재 정리: sessions/auto-* (데모 사이클 결과) + cycle.* 파일.
# 실사용 자율 사이클 결과도 auto-* 이라 데모/실제 구분 불가 — 사용자 확인(--confirm) 후 전체 정리.
AUTO_REMOVED=0
if [ -d "$SESSIONS_DIR" ]; then
  for d in "$SESSIONS_DIR"/auto-*; do
    [ -d "$d" ] || continue
    rm -rf "$d" && AUTO_REMOVED=$((AUTO_REMOVED + 1))
  done
fi
ok "sessions/auto-* 제거: ${AUTO_REMOVED}개"
for f in "${CLEAN_FILES[@]}"; do
  [ -f "$f" ] && rm -f "$f" && info "$(basename "$f") 제거"
done

ok "데모 오더 정리 완료"
info "복구 필요 시: cp $BACKUP $ORDERS_JSON"
