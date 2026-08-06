# Local PC 에이전트

아웃룩 메일을 읽어 티켓으로 적재하고, 완료된 티켓의 회신을 발송합니다.
관리자 PC(Windows + Outlook 데스크톱)에서 상시 실행하는 것을 전제로 합니다.

설치 절차는 [`../docs/SETUP.md`](../docs/SETUP.md) 8장에 있습니다.

## 명령

```bash
ticket-agent doctor                 # 설정·연결 점검. 문제를 먼저 여기서 잡습니다
ticket-agent collect                # 메일 1회 스캔
ticket-agent collect --watch        # 주기 스캔 (--interval 초, 최소 30)
ticket-agent send                   # 발송 큐 1회 처리
ticket-agent send --watch           # 발송 큐 상시 감시
ticket-agent run                    # 수집 + 발송 상시 실행 (운영 기본)
```

`--env-file` 로 다른 `.env` 를 지정할 수 있습니다.

## 구조

```
src/ticket_agent/
├─ cli.py           명령 진입점
├─ config.py        .env 로딩·검증 (값이 없으면 즉시 실패)
├─ constants.py     코드값 — schema.sql / web 의 constants.ts 와 같은 값
├─ models.py        값 객체 (RawMail, Classification, OutboundEmail …)
├─ textutil.py      본문 정리 — 인용부 제거, 절단, 파일명 정규화  ★순수
├─ classifier.py    Gemini 로 판별·분류
├─ store.py         Supabase DB·Storage 접근
├─ collector.py     수집 파이프라인
├─ summarize.py     회신 본문 작성  ★순수
├─ sender.py        발송 파이프라인
└─ mail/
   ├─ base.py       MailClient 인터페이스
   ├─ outlook.py    운영 (pywin32, Windows 전용)
   └─ fixture.py    개발·테스트 (JSON 파일 ↔ 파일 출력)
```

★ 표시는 순수 함수 모듈입니다. Outlook·네트워크 없이 테스트가 돕니다.

## macOS·Linux 에서 개발하기

`AGENT_MAIL_BACKEND` 를 비워 두면 (`auto`) Windows 가 아닌 곳에서는 자동으로
`fixture` 백엔드가 선택됩니다. `fixtures/sample_mails.json` 의 메일 4통을 읽고,
발송은 `.fixture-outbox/` 에 텍스트 파일로 기록합니다.

```bash
cp .env.example .env      # Supabase·Gemini 키는 실제 값 필요
ticket-agent collect      # fixture 메일 4통으로 수집 흐름 확인
```

샘플에는 요구사항 메일 3통과 일상 메일(회식 투표) 1통이 들어 있어,
LLM 필터가 실제로 걸러내는지 눈으로 확인할 수 있습니다.

## 테스트

```bash
pip install -e ".[dev]"
pytest -q
```

114개. 전부 Outlook·Supabase·Gemini API 없이 돕니다 —
외부 의존은 가짜 객체로 대체하고, 나머지는 순수 함수입니다.

## 자주 걸리는 것

| 증상 | 원인 |
|---|---|
| `pywin32 를 불러올 수 없습니다` | Windows 가 아니거나 `pip install pywin32` 누락. 개발 중이면 `AGENT_MAIL_BACKEND=fixture` |
| `아웃룩 폴더를 찾지 못했습니다` | 폴더명 오타. 오류 메시지가 같은 위치의 실제 폴더 목록을 알려줍니다 |
| 같은 메일이 계속 티켓이 됨 | `tickets.source_message_id` 유니크 제약 누락 → `schema.sql` 재실행 |
| 티켓은 생기는데 등급이 전부 medium/etc | LLM 호출이 실패하고 기본값으로 적재된 것. 상세 화면의 `⚠ 자동분류 실패` 배지와 `llm_error` 확인 |
