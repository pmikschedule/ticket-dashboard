#!/bin/bash
#
# 대시보드 실행 (macOS)
#
# Finder 에서 이 파일을 **더블클릭**하면 터미널이 열리고 대시보드가 실행됩니다.
# 처음 실행할 때는 의존성 설치 때문에 1~2분 걸리고, 그 뒤로는 몇 초면 뜹니다.
#
# 이 스크립트는 **대시보드만** 띄웁니다. 메일 수집 에이전트는 아웃룩이 설치된
# Windows PC 에서 실행합니다 (docs/SETUP.md 8장).
#
# 종료: 터미널에서 Ctrl+C

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

# ── 위치 ─────────────────────────────────────────────────────────────────────
# 더블클릭 시 작업 디렉터리는 홈이므로, 스크립트 위치를 기준으로 잡습니다.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$ROOT/web"

[ -d "$WEB" ] || die "web 폴더를 찾을 수 없습니다: $WEB" \
  "이 스크립트는 저장소 최상단에 있어야 합니다. 옮겼다면 원래 위치로 되돌리세요."

cd "$WEB" || die "web 폴더로 이동하지 못했습니다."

printf '\n%s메일 기반 이슈 트래킹 — 대시보드%s\n' "$BOLD" "$RESET"
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

NODE_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
if [ "${NODE_MAJOR:-0}" -lt 20 ] 2>/dev/null; then
  die "Node.js 20 이상이 필요합니다 (현재 $(node -v))." \
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
      "  VITE_SUPABASE_URL       Supabase → Settings → Data API 의 Project URL" \
      "  VITE_SUPABASE_ANON_KEY  Supabase → Settings → API Keys 의 Publishable key" \
      "" \
      "⚠️  Secret(sb_secret_…) 키는 넣지 마세요. 브라우저에 그대로 노출됩니다."
  fi
  die "web/.env 도 web/.env.example 도 없습니다." "저장소가 손상됐을 수 있습니다."
fi

# 예시값이 그대로 남아 있으면 흰 화면 대신 여기서 잡습니다.
if grep -qE '^VITE_SUPABASE_URL=https://xxxxx|^VITE_SUPABASE_ANON_KEY=sb_publishable_xxxx' .env; then
  open -t .env 2>/dev/null || true
  die "web/.env 에 예시값이 그대로 남아 있습니다." \
    "실제 Supabase URL 과 Publishable key 로 바꾼 뒤 다시 실행하세요."
fi

if grep -q 'sb_secret_' .env; then
  die "web/.env 에 Secret 키가 들어 있습니다." \
    "웹 대시보드는 Publishable 키(sb_publishable_…)만 씁니다." \
    "Secret 키는 RLS 를 전부 무시하고 브라우저 개발자도구에 그대로 노출됩니다." \
    "agent/.env 로 옮기고, web/.env 에는 Publishable 키를 넣으세요."
fi
ok "web/.env"

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

# ── 4. 포트 고르기 ───────────────────────────────────────────────────────────
step "포트 확인"
PORT=5173
while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
  [ "$PORT" -gt 5200 ] && die "5173~5200 사이에 빈 포트가 없습니다." \
    "다른 개발 서버를 종료하고 다시 실행하세요."
done
[ "$PORT" -ne 5173 ] && warn "5173 이 사용 중이라 $PORT 로 실행합니다"
ok "포트 $PORT"

URL="http://localhost:$PORT/ticket-dashboard/"

# ── 5. 실행 ──────────────────────────────────────────────────────────────────
printf '\n'
step "대시보드 실행 중…"

# `npm run dev` 가 아니라 vite 바이너리를 직접 띄웁니다.
# npm 을 거치면 vite 가 npm 의 자식이 되고, 종료 시 npm 만 죽어 vite 가 포트를
# 물고 남습니다. 그러면 다음 실행마다 포트가 하나씩 밀립니다.
VITE_BIN="$WEB/node_modules/.bin/vite"
[ -x "$VITE_BIN" ] || die "vite 를 찾을 수 없습니다: $VITE_BIN" \
  "web/node_modules 를 지우고 이 스크립트를 다시 실행하세요."

"$VITE_BIN" --port "$PORT" --strictPort &
DEV_PID=$!

# Ctrl+C, 터미널 창 닫기, kill 어느 쪽으로 끝나도 vite 를 확실히 내립니다.
cleanup() {
  trap - INT TERM HUP EXIT
  printf '\n%s대시보드를 종료합니다…%s\n' "$DIM" "$RESET"
  kill "$DEV_PID" 2>/dev/null
  wait "$DEV_PID" 2>/dev/null
  printf '%s종료했습니다.%s\n' "$DIM" "$RESET"
  exit 0
}
trap cleanup INT TERM HUP EXIT

# 서버가 응답할 때까지 기다렸다가 브라우저를 엽니다.
# 바로 열면 아직 안 떠서 오류 페이지가 보입니다.
for _ in $(seq 1 40); do
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    die "개발 서버가 시작하자마자 종료됐습니다." "위 오류 메시지를 확인하세요."
  fi
  if curl -sf -o /dev/null "$URL"; then
    printf '\n'
    ok "실행됐습니다"
    printf '\n  %s%s%s\n\n' "$BOLD" "$URL" "$RESET"
    printf '  %s종료하려면 이 창에서 Ctrl+C 를 누르세요.%s\n\n' "$DIM" "$RESET"
    open "$URL" 2>/dev/null || warn "브라우저를 자동으로 열지 못했습니다. 위 주소를 직접 여세요."
    break
  fi
  sleep 0.5
done

wait "$DEV_PID"
