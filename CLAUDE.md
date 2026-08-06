# 메일 기반 이슈 트래킹 시스템 (Email-to-Ticket)

아웃룩으로 접수되는 시스템 요구사항·장애 신고를 자동 수집·분류해 티켓화하고,
처리 상태부터 라이프사이클 통계까지 관리합니다.

## 문서

| 문서 | 성격 |
|---|---|
| [docs/SPEC-EMAIL-TICKET.md](docs/SPEC-EMAIL-TICKET.md) | **정본 사양.** 충돌하면 이 문서가 이깁니다 |
| [docs/DESIGN.md](docs/DESIGN.md) | 기획서가 정하지 않은 부분의 설계 결정과 근거 |
| [docs/SETUP.md](docs/SETUP.md) | 설치·배포·운영 |
| [docs/reference/](docs/reference/) | **다른 프로젝트의 참고 자료.** 이 시스템의 사양이 아닙니다 |

## 구성

```
supabase/schema.sql   테이블 8개 + RLS + Storage + 통계 뷰 (한 파일, 재실행 안전)
agent/                Local PC 에이전트 (Python) — 메일 수집·분류·적재, 완료 회신 발송
web/                  React 대시보드 — 칸반·리스트·상세·통계
```

## 절대 규칙

- **service_role(Secret) 키는 `agent/.env` 한 곳에만 있습니다.** 웹 코드·저장소·GitHub
  Secrets 어디에도 넣지 않습니다. 웹은 Publishable(anon) 키만 씁니다.
- **컴포넌트는 `supabase` 클라이언트를 직접 import 하지 않습니다.** `web/src/lib/api.ts` 를 경유합니다.
- **에이전트의 DB·Storage 접근은 `store.py` 를 경유합니다.**
- **권한은 화면이 아니라 DB 가 막습니다.** 버튼을 숨기는 것은 편의일 뿐이고,
  실제 차단은 `schema.sql` 11장의 RLS 정책입니다. 둘의 규칙은 항상 같아야 합니다.
- **회신은 기본적으로 사람이 확인하고 보냅니다** (`AGENT_SEND_MODE=display`).
  발송은 되돌릴 수 없습니다. 자동 발송으로 바꾸는 것은 운영자의 명시적 선택입니다.
- **메일 한 통이 두 번 티켓이 되지 않습니다.** `tickets.source_message_id` 유니크 제약이 근거이고,
  수집 경로에서 반드시 먼저 조회합니다.
- **분류에 실패해도 메일을 버리지 않습니다** (기획서 3.1). LLM 오류·스키마 위반은
  안전한 기본값(`etc`/`medium`) + `triage` 상태로 적재하고 `llm_error` 에 사유를 남깁니다.
  화면에는 `⚠ 자동분류 실패` 배지로 드러냅니다 — 숨기면 담당자가 잘못된 등급을 사실로 믿습니다.
- **집계는 순수 함수를 거칩니다.** 웹은 `web/src/lib/stats.ts`, 에이전트는 `summarize.py`.
  화면·렌더링 코드에서 직접 계산하지 않습니다.
- **없는 값을 0 으로 채우지 않습니다.** "완료 건 0" 과 "완료 건 없음" 은 다른 사실입니다.
- **Outlook 접근은 `MailClient` 인터페이스 뒤에 둡니다.** 운영은 `OutlookMailClient`,
  개발·테스트는 `FixtureMailClient`. 나머지 코드는 구현을 몰라야 macOS 에서 테스트가 돕니다.

## 코드값을 바꿀 때

상태·등급·유형·시스템 구분은 **세 곳에 같은 값**이 있습니다. 하나만 고치면 저장이 실패합니다.

1. `supabase/schema.sql` 의 check 제약
2. `agent/src/ticket_agent/constants.py`
3. `web/src/lib/constants.ts`

## 차트

- 단일 계열에는 색을 돌려 쓰지 않습니다 — 막대 옆 라벨이 이미 항목을 구분합니다.
- 등급처럼 **순서가 있는 값**에만 단일 색상의 순서형 램프를 씁니다 (`SEVERITY_RAMP`).
  흰 배경 기준으로 명도 단조·간격·대비를 검증한 값이므로 임의로 바꾸지 않습니다.
- 축·격자는 데이터보다 연하게. 값은 항목이 10개 이하일 때만 모든 막대에 붙입니다.

## 명령

```bash
cd web   && npm test && npm run build   # 순수 로직 83개 + 타입체크
cd agent && pytest -q                   # 순수 로직·파이프라인 103개
cd agent && ticket-agent doctor         # 설정·연결 점검
```

## 용어

- **접수일** = `tickets.received_at` (메일 수신일시). `created_at`(에이전트 적재 시각)이 아닙니다.
- **리드타임** = 접수 → 완료 경과 시간. `ticket_lead_times` 뷰가 계산합니다.
- **발송 큐** = `outbound_emails`. 웹이 넣고 에이전트가 집어갑니다.
