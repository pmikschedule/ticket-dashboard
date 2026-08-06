# 메일 기반 이슈 트래킹 시스템 (Email-to-Ticket)

아웃룩으로 접수되는 시스템 요구사항·장애 신고를 자동 수집·분류해 티켓화하고,
처리 상태부터 라이프사이클 통계까지 관리하는 경량 이슈 트래킹 시스템.

```
 ┌─ 관리자 PC (Windows + Outlook) ────────────┐
 │  Python 에이전트                            │
 │   ① 폴더 스캔 → ② Claude 분류               │
 │   ③ Supabase 적재 + 첨부 업로드              │
 │   ⑤ 발송 큐 감지 → 아웃룩 회신 (사람 확인)    │
 └────────────────┬───────────────────────────┘
                  │ service_role 키
                  ▼
        ┌──────────────────────┐
        │  Supabase            │   Postgres + Auth + Storage + RLS
        └──────────┬───────────┘
                   │ publishable 키
                   ▼
        ┌──────────────────────┐
        │  GitHub Pages        │   React 대시보드
        │   ④ 칸반·상세·통계     │
        └──────────────────────┘
```

**배포 주소**: <https://pmikschedule.github.io/ticket-dashboard/>
**저장소**: <https://github.com/pmikschedule/ticket-dashboard>

## 시작하기

[`docs/SETUP.md`](docs/SETUP.md) — Supabase 생성부터 배포·운영까지 한 번에.

**macOS 에서 대시보드만 빠르게 띄우려면** 최상단의 `start-dashboard.command` 를 더블클릭하세요.
(Supabase 설정과 계정 생성이 먼저 끝나 있어야 합니다 — SETUP.md 1~5장)

> **기본 계정은 없습니다.** 셀프 가입이 없는 구조라, 관리자가 Supabase 대시보드에서
> 계정을 직접 만들어야 로그인할 수 있습니다 (SETUP.md 4장).

## 이 저장소

| 경로 | 내용 |
|---|---|
| [`docs/SPEC-EMAIL-TICKET.md`](docs/SPEC-EMAIL-TICKET.md) | **정본 기획서** |
| [`docs/DESIGN.md`](docs/DESIGN.md) | 기획서가 정하지 않은 부분의 설계 결정과 근거 |
| [`docs/SETUP.md`](docs/SETUP.md) | 설치·배포·운영·문제 해결 |
| [`docs/reference/`](docs/reference/) | 다른 프로젝트의 참고 자료 (이 시스템의 사양 아님) |
| [`supabase/schema.sql`](supabase/schema.sql) | 테이블·RLS·Storage·통계 뷰. 한 파일, 재실행 안전 |
| [`agent/`](agent/) | Local PC 에이전트 (Python) |
| [`web/`](web/) | React 대시보드 |
| [`CLAUDE.md`](CLAUDE.md) | 이 저장소에서 코드를 고칠 때의 규칙 |

## 상태 파이프라인

```
접수 대기 → 분석/할당 → 진행 중 → 테스트 → 배포 → 완료
 intake     triage    in_progress testing  deploy  done
```

관리자는 임의 단계로 이동할 수 있고, 팀원은 인접 단계로만 이동합니다.
전이는 전부 `ticket_status_history` 에 남고, 이것이 리드타임 통계의 원천입니다.

## 설계에서 지키는 것

1. **메일 한 통이 두 번 티켓이 되지 않는다** — 아웃룩 EntryID 유니크 제약
2. **내용이 부실해도 버리지 않는다** — 분류 실패 시 안전한 기본값으로 적재하고 화면에 표시
3. **회신은 사람이 확인하고 보낸다** — 에이전트 기본값은 창을 띄우는 `display` 모드
4. **service_role 키는 브라우저에 도달하지 않는다** — 웹은 publishable 키만
5. **권한은 화면이 아니라 DB 가 막는다** — RLS 정책

## 개발

```bash
cd web   && npm install && npm test && npm run build
cd agent && pip install -e ".[dev]" && pytest -q
```

에이전트 테스트는 Outlook·Supabase·Claude API 없이 macOS 에서도 전부 돕니다.
