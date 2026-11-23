#!/bin/zsh -f
#
# launchd 감시 작업(me.saebom.reporter.requests)이 30초마다 부르는 진입점.
#
# 화면의 '주간보고서 생성' 이 넣은 desk 수집 요청을 처리합니다 (`npm run requests`).
# 할 일이 없으면 쿼리 한 번으로 끝나고 아무것도 안 찍습니다.
#
# `-f` 로 셸 초기화 파일을 읽지 않습니다. 30초마다 로그인 셸을 띄우면 사용자의
# 셸 설정(키체인 조회 등)이 하루 2,880번 돕니다. 대신 PATH 는 plist 가 줍니다.
# npx 도 거치지 않습니다 — 매번 패키지를 찾는 시간이 실행보다 깁니다.

set -u
cd "${0:A:h}/.." || exit 1
exec ./node_modules/.bin/tsx src/cli.ts requests
