#!/bin/zsh
#
# launchd 가 부르는 진입점.
#
# 스캔은 **매번**, 월간보고는 **매월 1일에만**.
#
# 주간 보고서는 여기서 안 만듭니다 — 이슈트래커의 태스크맵 화면에서 사람이
# 만듭니다. 여기가 할 일은 그 화면이 볼 스냅샷을 제때 올려 두는 것입니다.
# 주간 구간이 **화~월** 이라 월요일이 끝나야 그 주가 닫히고, 그래서 월요일 저녁과
# 화요일 아침 두 번 스캔합니다.

set -u
cd "$(dirname "$0")/.." || exit 1

stamp() { date '+%Y-%m-%d %H:%M:%S'; }
echo "───────────────────────────────── $(stamp)"

# 스냅샷은 놓치면 복원되지 않습니다. 보고서 생성이 실패해도 스캔은 남깁니다.
if ! npx tsx src/cli.ts scan; then
  echo "[$(stamp)] scan 실패 — 쿠키 만료일 수 있습니다"
fi

if [[ "$(date '+%d')" == "01" ]]; then
  # 지난달이 기본값입니다
  if ! npx tsx src/cli.ts monthly; then
    echo "[$(stamp)] monthly 실패"
  fi
fi
