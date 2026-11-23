#!/bin/zsh
#
# launchd 가 부르는 진입점 — **매월 1일 월간보고만** 합니다.
#
# desk 수집은 2026-11-23 부터 사내 PC 의 에이전트가 합니다(월 18:00 · 화 09:00 ·
# 화면의 수집 요청). 이 Mac 은 desk 를 읽지 않고, `monthly` 가 먼저 대시보드의
# 스냅샷을 내려받아(`pull`) 그것으로 만듭니다. 그래서 여기서 스캔하지 않습니다.
#
# 주간 보고서는 여기서 안 만듭니다 — 이슈트래커의 태스크맵 화면에서 사람이 만듭니다.
#
# 날짜를 보지 않습니다. launchd 는 잠들어 놓친 실행을 **깨어난 직후** 한 번 돌리므로
# 2일에 돌 수도 있는데, 그때도 기본값(지난달)이 맞습니다. 손으로
# `launchctl start me.saebom.reporter` 해도 지난달 보고서가 나옵니다.

set -u
cd "$(dirname "$0")/.." || exit 1

stamp() { date '+%Y-%m-%d %H:%M:%S'; }
echo "───────────────────────────────── $(stamp)"

# 지난달이 기본값입니다
if ! npx tsx src/cli.ts monthly; then
  echo "[$(stamp)] monthly 실패"
fi
