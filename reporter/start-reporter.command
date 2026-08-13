#!/bin/bash
#
# 활동 월간 요약 보고서 생성기 실행 (macOS)
#
# Finder 에서 이 파일을 **더블클릭**하면 터미널이 열리고 메뉴가 뜹니다.
# 처음 실행할 때는 의존성 설치 때문에 1~2분 걸리고, 그 뒤로는 몇 초면 뜹니다.
#
# 이 파일은 **손으로 돌릴 때** 쓰는 것입니다. 정기 실행은 launchd 가 맡습니다
# (scripts/me.saebom.reporter.plist). 둘 다 같은 CLI 를 부르므로 섞어 써도 됩니다.
#
# ⚠️ 스냅샷은 놓치면 복원되지 않습니다. desk 는 현재 상태만 보관하고 과거 이력이
#    없어서, 안 떠 놓은 날의 상태는 영영 되살릴 수 없습니다. 보고서를 안 만드는
#    달에도 스캔은 주 1회 이상 돌려야 합니다.

set -uo pipefail

# ── 표시 ─────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'
else
  BOLD=''; DIM=''; RESET=''; RED=''; GREEN=''; YELLOW=''; CYAN=''
fi

step() { printf '%s▸%s %s\n' "$CYAN" "$RESET" "$1"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$1"; }

# 더블클릭으로 연 터미널은 스크립트가 끝나면 닫힙니다.
# 오류 메시지를 볼 수 있도록 붙잡아 둡니다.
die() {
  printf '\n%s✗ %s%s\n' "$RED$BOLD" "$1" "$RESET"
  shift
  for line in "$@"; do printf '  %s\n' "$line"; done
  printf '\n%s이 창은 아무 키나 누르면 닫힙니다.%s\n' "$DIM" "$RESET"
  read -r -n 1 -s
  exit 1
}

# 성공해도 결과를 읽을 시간이 필요합니다.
hold() {
  printf '\n%s이 창은 아무 키나 누르면 닫힙니다.%s\n' "$DIM" "$RESET"
  read -r -n 1 -s
}

# ── 위치 ─────────────────────────────────────────────────────────────────────
# 더블클릭 시 작업 디렉터리는 홈이므로, 스크립트 위치를 기준으로 잡습니다.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -f "$ROOT/src/cli.ts" ] || die "reporter 소스를 찾을 수 없습니다: $ROOT/src/cli.ts" \
  "이 스크립트는 reporter 폴더 안에 있어야 합니다. 옮겼다면 원래 위치로 되돌리세요."

cd "$ROOT" || die "reporter 폴더로 이동하지 못했습니다."

printf '\n%s활동 월간 요약 보고서 생성기%s\n' "$BOLD" "$RESET"
printf '%s%s%s\n\n' "$DIM" "$ROOT" "$RESET"

# ── 1. Node.js 확인 ──────────────────────────────────────────────────────────
step "Node.js 확인"

# 더블클릭으로 뜬 셸은 로그인 셸이라 보통 PATH 가 잡히지만,
# Homebrew 를 쓰는데 PATH 에 없는 경우가 있어 흔한 위치를 보강합니다.
for candidate in /opt/homebrew/bin /usr/local/bin; do
  [ -d "$candidate" ] && case ":$PATH:" in *":$candidate:"*) ;; *) PATH="$candidate:$PATH" ;; esac
done
export PATH

command -v node >/dev/null 2>&1 || die "Node.js 가 설치돼 있지 않습니다." \
  "아래 중 하나로 설치한 뒤 다시 실행하세요." \
  "" \
  "  · Homebrew:  brew install node" \
  "  · 설치 프로그램: https://nodejs.org 에서 LTS 버전"

# 22 이상이 필요합니다 — 쿠키 복호화가 Chrome 의 SQLite DB 를 `node:sqlite` 로
# 직접 읽습니다. 20 에서는 그 모듈이 없어서 스캔이 통째로 실패합니다.
NODE_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
if [ "${NODE_MAJOR:-0}" -lt 22 ] 2>/dev/null; then
  die "Node.js 22 이상이 필요합니다 (현재 $(node -v))." \
    "쿠키를 읽는 데 node:sqlite 를 쓰는데, 22 미만에는 그 모듈이 없습니다." \
    "" \
    "  brew upgrade node   또는   https://nodejs.org 에서 LTS 설치"
fi
ok "Node.js $(node -v)"

# ── 2. 환경변수 확인 ─────────────────────────────────────────────────────────
step "환경변수 확인"

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    open -t .env 2>/dev/null || true
    die ".env 파일이 없어서 새로 만들었습니다. 값을 채워야 실행됩니다." \
      "방금 열린 편집기에서 두 값을 채우고 저장한 뒤, 이 파일을 다시 더블클릭하세요." \
      "" \
      "  SUPABASE_EMAIL     티켓 대시보드 로그인 계정" \
      "  SUPABASE_PASSWORD  그 계정의 비밀번호" \
      "" \
      "⚠️  service_role(sb_secret_…) 키는 넣지 마세요." \
      "    그 키는 에이전트 PC 의 .env 한 곳에만 있어야 합니다."
  fi
  die "reporter/.env 도 reporter/.env.example 도 없습니다." "저장소가 손상됐을 수 있습니다."
fi

# 절대 규칙 — 이 파일에 Secret 키가 있으면 안 됩니다.
if grep -q 'sb_secret_' .env; then
  die "reporter/.env 에 Secret(service_role) 키가 들어 있습니다." \
    "reporter 는 Publishable(anon) 키로 **로그인해서** 읽습니다. RLS 가 그대로 살아 있어야 합니다." \
    "Secret 키는 RLS 를 전부 무시합니다. agent/.env 한 곳에만 두세요."
fi
ok "reporter/.env"

# 대시보드 계정이 없으면 스캔은 되지만 보고서의 운영 현황 절이 비어 버립니다.
# 스캔까지 막지는 않습니다 — 스냅샷은 놓치면 복원이 안 되기 때문입니다.
DASHBOARD_READY=1
if ! grep -qE '^SUPABASE_EMAIL=.+' .env || ! grep -qE '^SUPABASE_PASSWORD=.+' .env; then
  DASHBOARD_READY=0
  warn "SUPABASE_EMAIL / SUPABASE_PASSWORD 가 비어 있습니다 — 운영 집계를 못 읽습니다"
  printf '  %s스캔은 그대로 됩니다. 보고서를 만들려면 .env 를 채우세요.%s\n' "$DIM" "$RESET"
fi

# ── 3. 의존성 설치 ───────────────────────────────────────────────────────────
# node_modules 가 없거나 package-lock.json 이 더 최신이면 다시 설치합니다.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  step "의존성 설치 (처음 한 번은 1~2분 걸립니다)"
  if [ -f package-lock.json ]; then
    npm ci || die "npm ci 에 실패했습니다." "네트워크를 확인하고 다시 실행하세요."
  else
    npm install || die "npm install 에 실패했습니다." "네트워크를 확인하고 다시 실행하세요."
  fi
  touch node_modules
  ok "의존성 설치 완료"
else
  ok "의존성 최신"
fi

# npx 를 거치지 않고 로컬 바이너리를 직접 부릅니다.
# npx 는 없으면 받으러 나가는데, 이 도구는 네트워크가 끊긴 자리에서도 돌아야 합니다.
TSX_BIN="$ROOT/node_modules/.bin/tsx"
[ -x "$TSX_BIN" ] || die "tsx 를 찾을 수 없습니다: $TSX_BIN" \
  "reporter/node_modules 를 지우고 이 스크립트를 다시 실행하세요."

# ── 4. 상태 ──────────────────────────────────────────────────────────────────
SNAP_DIR="$ROOT/data/snapshots"
SNAP_COUNT=0
LAST_SNAP="(없음)"
if [ -d "$SNAP_DIR" ]; then
  SNAP_COUNT="$(find "$SNAP_DIR" -maxdepth 1 -name '*.json' | wc -l | tr -d ' ')"
  NEWEST="$(find "$SNAP_DIR" -maxdepth 1 -name '*.json' | sort | tail -1)"
  [ -n "$NEWEST" ] && LAST_SNAP="$(basename "$NEWEST" .json)"
fi

printf '\n  %s스냅샷 %s개 · 마지막 %s%s\n' "$DIM" "$SNAP_COUNT" "$LAST_SNAP" "$RESET"
if [ "$SNAP_COUNT" -lt 2 ]; then
  printf '  %s스냅샷이 2개 미만이면 일정 변경(7/13 → 8/6)을 알 수 없습니다.%s\n' "$DIM" "$RESET"
fi

# ── 5. 메뉴 ──────────────────────────────────────────────────────────────────
printf '\n%s무엇을 할까요?%s\n\n' "$BOLD" "$RESET"
printf '  %s1%s  스냅샷 수집        %s주 1회 이상. 이걸 놓치면 그날은 복원되지 않습니다%s\n' "$BOLD" "$RESET" "$DIM" "$RESET"
printf '  %s2%s  주간 업무 보고     %s이번 주 pptx. 지난주 스냅샷과 대조합니다%s\n' "$BOLD" "$RESET" "$DIM" "$RESET"
printf '  %s3%s  지난달 보고서      %sout/ 에 pptx 를 만듭니다%s\n' "$BOLD" "$RESET" "$DIM" "$RESET"
printf '  %s4%s  특정 달 보고서     %s월을 직접 입력합니다%s\n' "$BOLD" "$RESET" "$DIM" "$RESET"
printf '  %s5%s  업무 목록          %s프로젝트별·담당자별 전수 목록 xlsx. 자르지 않습니다%s\n' "$BOLD" "$RESET" "$DIM" "$RESET"
printf '  %s6%s  태스크 맵 편집     %s브라우저로 항목을 묶고 프로젝트를 붙입니다%s\n' "$BOLD" "$RESET" "$DIM" "$RESET"
printf '  %s7%s  점검               %s설정·연결·쿠키 만료를 봅니다%s\n' "$BOLD" "$RESET" "$DIM" "$RESET"
printf '\n'
printf '선택 [1-7, 그냥 Enter 는 1]: '
read -r CHOICE
CHOICE="${CHOICE:-1}"

MONTH=''
case "$CHOICE" in
  1) ARGS=(scan) ;;
  2) ARGS=(weekly) ;;
  3) ARGS=(monthly) ;;
  4)
    printf '어느 달입니까? (예: 2026-07): '
    read -r MONTH
    # 형식을 여기서 막습니다. CLI 까지 흘려보내면 쿠키·로그인을 다 거친 뒤에 깨집니다.
    if ! printf '%s' "$MONTH" | grep -qE '^[0-9]{4}-(0[1-9]|1[0-2])$'; then
      die "월 형식이 올바르지 않습니다: ${MONTH:-(빈 값)}" "YYYY-MM 형태로 입력하세요. 예: 2026-07"
    fi
    ARGS=(monthly "$MONTH")
    ;;
  5) ARGS=(list) ;;
  6) ARGS=(ui) ;;
  7) ARGS=(doctor) ;;
  *) die "1~7 중에서 고르세요. 입력한 값: $CHOICE" ;;
esac

if [ "$DASHBOARD_READY" -eq 0 ] && [ "${ARGS[0]}" = "monthly" ]; then
  die "보고서를 만들려면 대시보드 계정이 필요합니다." \
    "reporter/.env 의 SUPABASE_EMAIL / SUPABASE_PASSWORD 를 채운 뒤 다시 실행하세요." \
    "" \
    "운영 건수를 0 으로 채워서 만들지 않습니다 — '0건' 과 '못 읽음' 은 다른 사실입니다."
fi

# ── 6. 실행 ──────────────────────────────────────────────────────────────────
printf '\n'
step "실행 중… ${ARGS[*]}"

# 쿠키는 macOS 키체인의 "Chrome Safe Storage" 키로 복호화합니다.
# 처음 한 번은 시스템이 접근 허용을 묻습니다 — 그 창은 이 터미널이 아니라
# 별도 대화상자로 뜹니다.
printf '%s  (처음이라면 키체인 접근 허용을 묻는 창이 뜹니다. 허용해야 desk 를 읽습니다.)%s\n\n' "$DIM" "$RESET"

"$TSX_BIN" src/cli.ts "${ARGS[@]}"
STATUS=$?

printf '\n'
if [ "$STATUS" -ne 0 ]; then
  # CLI 가 이미 사유를 찍었습니다. 여기서는 다음 행동만 짚습니다.
  # 점검(doctor)은 항목별 결과를 이미 줄줄이 찍었으므로 다시 점검하라고 하지 않습니다.
  if [ "${ARGS[0]}" = "doctor" ]; then
    die "점검에서 실패한 항목이 있습니다." \
      "위의 '실패' · '미설정' 줄이 사유입니다." \
      "" \
      "  · 쿠키 만료  → Chrome 으로 desk 에 다시 로그인하면 끝입니다" \
      "  · 대시보드   → .env 의 SUPABASE_EMAIL / SUPABASE_PASSWORD 를 채우세요"
  fi
  die "실패했습니다 (종료코드 $STATUS)." \
    "위 메시지를 먼저 보세요. 가장 흔한 원인은 쿠키 만료입니다." \
    "" \
    "  · 쿠키 만료  → Chrome 으로 desk 에 다시 로그인하면 끝입니다" \
    "  · 그 외      → 4번 점검을 돌려 보세요"
fi

ok "끝났습니다"

# 보고서를 만들었으면 결과 폴더를 엽니다. 어디 생겼는지 찾게 두지 않습니다.
if [ "${ARGS[0]}" = "monthly" ] || [ "${ARGS[0]}" = "list" ] || [ "${ARGS[0]}" = "weekly" ]; then
  printf '\n'
  open "$ROOT/out" 2>/dev/null || warn "out 폴더를 자동으로 열지 못했습니다: $ROOT/out"
fi

hold
