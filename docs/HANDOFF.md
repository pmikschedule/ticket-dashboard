# 인수인계 — 2026-08-07

이 문서는 **이 시점의 상태**를 적습니다. 시스템이 어떻게 동작하는지는
[CLAUDE.md](../CLAUDE.md)와 [SETUP.md](SETUP.md)가 정본입니다. 여기 적힌 것이
그 문서들과 어긋나면 그쪽이 이깁니다.

## 지금 상태

| | |
|---|---|
| 대시보드 | <https://pmikschedule.github.io/ticket-dashboard/> (커밋 `5b65c73`) |
| Supabase | `dftqwkvhqjgwrfidsmwc` — **PMSchedule 과 별개 프로젝트입니다** |
| 에이전트 | Windows 서버, 오프라인 꾸러미 방식. 버전은 `run.py doctor` 첫 줄 |
| 계정 | 8명 등록 완료. 관리자는 Steven 한 명 |
| 테스트 | 에이전트 178개 · 웹 170개 |

## 반드시 먼저 할 일 두 가지

이 둘을 안 하면 **화면은 도는데 저장에서 막힙니다.** 원인을 찾기 어려운 실패입니다.

### 1. `supabase/schema.sql` 전체 재실행

SQL Editor 에 통째로 붙여넣습니다. 재실행 안전합니다. 마지막 세 장이 이번에
추가된 것입니다.

- **21장** — `scanned_mails.outcome` 에 `linked` 추가. 없으면 후속 연결이 제약 위반으로 실패
- **22장** — `scan_attachments` 표, 그리고 스크리닝 권한을 팀원에게 개방

확인:

```sql
select conname, pg_get_constraintdef(oid)
  from pg_constraint where conname = 'scanned_mails_outcome_check';
-- 'ticketed','excluded','pending','linked' 넷이 다 나와야 합니다

select policyname from pg_policies
 where tablename = 'scanned_mails' and cmd = 'UPDATE';
-- scanned_update_member 가 나와야 합니다 (scanned_update_admin 이 아니라)
```

### 2. 윈도우 에이전트 소스 교체 (0.4.0)

<https://github.com/pmikschedule/ticket-dashboard/releases/download/agent-v1/ticket-agent-src-0.4.0.zip>

54KB 입니다. 라이브러리는 안 바뀌었으니 **`lib/` 는 건드리지 마세요.**

1. 에이전트를 끕니다
2. zip 을 풀어 나온 `src` 폴더를 `C:\ticket-agent\` 에 덮어쓰기
3. `.env` 에 아래 두 줄을 더합니다 (없으면 기본값 3일 / 제한 없음)

```
SCAN_LOOKBACK_DAYS=3
SCAN_LIMIT=0
```

4. `python run.py doctor` → 첫 줄이 `에이전트 버전 : 0.4.0`

`.env` 는 그대로 둡니다 (zip 에 든 건 `.env.example` 이라 이름이 달라 안전합니다).

**이걸 안 하면** 판단 대기·첨부 구분·스캔 첨부 보관이 전부 동작하지 않습니다.
에이전트 코드에 있는 기능들입니다.

## 이번 세션에 바뀐 것

### 분류 실패 → 티켓이 아니라 '판단 대기' (`33fba93`)

예전에는 LLM 이 실패해도 `is_request=True` 를 찍어 티켓을 만들었습니다. 판단이
아니라 추측이고, 그 티켓은 통계 모수에 들어가고 담당자에게 할당되고 요청자에게
회신까지 나갑니다.

이제 `scanned_mails` 에 `outcome='pending'` 으로 남기고 사람이 정합니다.
**보드에 안 뜨므로** 상단 메뉴 '스크리닝' 옆 건수 배지가 유일한 알림입니다.
그 배지를 없애면 분류 실패가 조용히 묻힙니다.

기획서 3.1 의 "내용이 부실해도 반려하지 않는다" 는 **판별에 성공한** 경우입니다.
요청이라고 판단했으면 세부가 비어도 티켓이 되고 `triage` 로 갑니다.

### 서명 로고·명함을 첨부에서 제외 (`dab93f2`)

MAPI 속성 세 가지로 가릅니다. **Content-ID 는 있다는 것만으로 버리지 않고**
본문 HTML 이 `cid:` 로 참조하는지까지 봅니다 — 클라이언트가 습관적으로 ID 를
달아 둔 진짜 첨부가 있습니다.

판정은 `agent/src/ticket_agent/attachments.py` 순수 함수이고 macOS 에서
25개 테스트가 돕니다. 애매하면 **남깁니다.**

뺀 파일은 이름만 `tickets.skipped_inline_attachments` 에 남아 상세 화면에 뜹니다.

### 티켓 수정 + 원본 메일 증적 (`7be7366`)

담당자가 제목·요청자·요청자 메일·기한·내용을 고칠 수 있습니다
(`can_edit_ticket` = 관리자 또는 담당자).

고칠 수 있게 되면서 "무엇을 받았는가" 와 "무엇으로 정리했는가" 가 갈라졌습니다.
받은 것은 `scanned_mails` 스냅숏에 남고 상세 화면 **'원본 메일 (증적)'** 칸에서
봅니다. `source_message_id` 는 트리거로 막았습니다.

**요청자 메일을 고치면 완료 회신이 그 주소로 갑니다.**

### 후속 메일을 기존 티켓에 코멘트로 (`2d066eb`)

스크리닝 판단 패널이 3지선다입니다 — 새 요청 / 진행 중인 건의 후속 / 접수 안 함.

판정은 **사람이 합니다.** LLM 제안은 넣지 않았습니다 — 틀린 제안은 없는 제안보다
나쁩니다. 사람이 확인하지 않고 누르기 때문입니다. 대신 티켓을 빨리 찾는 데
힘을 썼습니다: 검색어가 비어도 최근 티켓이 뜨고, 같은 요청자의 안 끝난 건이
위로 옵니다.

붙은 코멘트는 `[메일]` 로 시작하고 상세 화면에서 배지로 구분됩니다. 이 내용은
**완료 회신 메일에 그대로 실려** 요청자에게 나갑니다 (`reply.ts`).

`outcome='linked'` 는 `ticketed` 와 다릅니다 — 앞은 이 메일이 그 티켓이 **된**
것이고 뒤는 **붙은** 것입니다. 합치면 "메일 한 통 = 티켓 한 건" 전제가 깨집니다.

### 모든 스캔 메일의 첨부 보관 + 스크리닝 개방 (`5b65c73`)

티켓이 안 된 메일의 첨부도 `scan_attachments` 에 보관합니다. 티켓이 되거나
티켓에 붙을 때 `attachments` 로 **행만** 복사합니다 — 파일은 이미 Storage 에
있으므로 다시 안 올립니다.

스크리닝 판단을 팀원 전원에게 열었습니다. `scanned_mails` 만 열면 안 됩니다 —
`tickets`·`ticket_meta`·`attachments` insert 도 함께 열어야 저장이 됩니다.
**삭제는 여전히 관리자만** 입니다.

## 알려진 한계

- **Storage 가 쌓입니다.** 요청이 아니라고 걸러진 메일의 첨부도 보관합니다.
  정리하려면 오래된 `excluded` 건의 `scan_attachments` 를 지우면 됩니다.
  아직 정리 도구는 없습니다.
- **수동 등록 티켓에는 '원본 메일' 칸이 없습니다.** `scanned_mails` 행이 없기
  때문입니다. 원문은 `manual_intake.raw_text` 에 있습니다.
- **첨부 판정이 100% 는 아닙니다.** Content-ID 없이 서명 이미지를 보내는
  클라이언트가 있습니다. 그때는 `.env` 의 `ATTACHMENT_MIN_IMAGE_BYTES` 를
  켭니다(기본 0=꺼짐). 근거가 약한 기준이라 기본값은 끔입니다.
- **관리자가 Steven 한 명입니다.** 티켓 삭제·설정 변경·계정 관리가 그 계정에
  묶여 있습니다.

## 운영 메모

- **`gh` 활성 계정이 `viralfactory` 로 바뀌어 있으면 push·release 가 403/404** 입니다.
  전역 전환 대신 `GH_TOKEN=$(gh auth token --user pmikschedule)` 를 그 명령에만 붙입니다.
- **대시보드가 안 바뀌면 캐시입니다.** GitHub Pages 가 `index.html` 에
  `max-age=600` 을 겁니다. 상단 커밋 해시를 보고 강제 새로고침(Ctrl+F5).
- **오프라인 꾸러미 재생성**: 인터넷 되는 기기에서
  `python3 agent/tools/build_offline_bundle.py` (전체 67MB).
  코드만 바뀌었으면 `src` 폴더만 zip 해서 올리면 됩니다.
- **Outlook COM 은 로그온한 데스크톱 세션에서만 됩니다.** 작업 스케줄러에서
  "로그온 여부에 관계없이 실행" 을 고르면 **조용히 아무 메일도 수집되지 않습니다.**

## 다음에 할 만한 것

우선순위는 실제로 며칠 돌려 본 뒤에 정하는 게 낫습니다. 지금 보이는 후보:

1. **Storage 정리 도구** — 오래된 `excluded` 스캔의 첨부를 지우는 배치
2. **관리자 한 명 더** — Steven 부재 시 아무도 못 하는 일이 있습니다
3. **수동 등록 티켓의 원문 표시** — `manual_intake.raw_text` 를 증적 칸에
4. **후속 메일 제안** — 지금은 순수 수동입니다. 며칠 써 보고 느리면 그때
