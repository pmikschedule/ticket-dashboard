#!/bin/zsh
#
# launchd 가 부르는 진입점.
#
# 스캔은 **매번**, 주간보고는 **화요일에만**, 월간보고는 **매월 1일에만**.
# 한 plist 에 여러 일정을 넣었기 때문에 요일·날짜로 갈라야 합니다 —
# launchd 는 어느 일정 때문에 깨웠는지 알려 주지 않습니다.
#
# 주간 구간이 **화~월** 이라 월요일이 끝나야 그 주가 닫힙니다. 그래서 주간보고는
# 화요일에 돌리고, 그 직전에 뜬 스냅샷이 구간 마감 상태가 됩니다. 월요일에 돌리면
# 아직 안 끝난 주를 보고하거나 한 주 전 것을 보고하게 됩니다.

set -u
cd "$(dirname "$0")/.." || exit 1

stamp() { date '+%Y-%m-%d %H:%M:%S'; }
echo "───────────────────────────────── $(stamp)"

# 스냅샷은 놓치면 복원되지 않습니다. 보고서 생성이 실패해도 스캔은 남깁니다.
if ! npx tsx src/cli.ts scan; then
  echo "[$(stamp)] scan 실패 — 쿠키 만료일 수 있습니다"
fi

# 주간보고는 스냅샷이 두 주치 이상 쌓여야 변화가 나옵니다. 한 주치뿐이면
# CLI 가 '기준 주차' 로 만들고 그 사실을 슬라이드에 적습니다 — 실패가 아닙니다.
if [[ "$(date '+%u')" == "2" ]]; then
  if ! npx tsx src/cli.ts weekly; then
    echo "[$(stamp)] weekly 실패"
  fi
fi

if [[ "$(date '+%d')" == "01" ]]; then
  # 지난달이 기본값입니다
  if ! npx tsx src/cli.ts monthly; then
    echo "[$(stamp)] monthly 실패"
  fi
fi
