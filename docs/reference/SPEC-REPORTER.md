# Desk Reporter — 정기 스캔 기반 주간·월간 보고서 생성기 기획서

> 작성일: 2026-08-04
> 대상 시스템: Sloan's Desk (`https://desk.saebom.me/`)
> 목적: desk 에 이미 쌓여 있는 데이터를 정기적으로 수집·보존하여, 주간·월간 보고서를 자동 생성한다.
> **이 프로그램은 desk 를 수정하지 않는다. 읽기 전용이다.**

---

## 1. 왜 별도 프로그램인가

desk 는 **현재 상태만** 보관합니다. 확인된 사실입니다.

| 확인 항목 | 결과 |
|---|---|
| API | `GET /api/state` **단 하나**. 전체 상태를 JSON 한 번에 반환 |
| 쓰기 API | **없음** (번들 전수 조사 — `method: POST/PUT/PATCH` 미검출) |
| 과거 이력 | `reports[]` 스냅샷 **1건뿐** (`2026-07-27`) |
| 업무 변경 이력 | `work.log` 32건 중 **1건**만 값 있음 |
| 최초 마감일 | 필드 자체가 없음 |

즉 **"지난주에 어떤 상태였는지"를 desk 에게 물어볼 방법이 없습니다.** 오늘 못 떠 놓으면 영원히 사라집니다.

이 프로그램의 존재 이유는 보고서 생성이 아니라 **스냅샷 축적**입니다. 보고서는 축적된 스냅샷의 부산물입니다.

### 1.1 축적이 만들어내는 것

주 1회 스냅샷을 뜨기 시작하면, 원본에 없던 정보가 W+1 주차부터 생깁니다.

| 파생 정보 | 산출 방법 | 원본만으로는 |
|---|---|---|
| 금주 완료 | 지난주 `ing` → 이번주 `done` 전이 | `completedOn` 에 의존 (12건 중 11건만 값 있음) |
| **일정 변경 (`7/13 → 8/6`)** | 지난주 `due` ≠ 이번주 `due` | **불가능** (최초 마감일 필드 없음) |
| 신규 등록 업무 | 지난주에 없던 `id` | 불가능 |
| 주간 진척 증가분 | `milestones` done 개수 차이 | 불가능 |
| 정체 업무 | N주 연속 `ing` 이면서 변화 없음 | 불가능 |

**이것이 이 도구의 핵심 가치입니다.** 스캔을 시작한 시점부터 데이터가 자라기 시작하므로, 착수가 빠를수록 좋습니다.

---

## 2. 범위

| 만드는 것 | 만들지 않는 것 |
|---|---|
| `/api/state` 주기적 수집 · 스냅샷 보존 | desk 의 기능 수정·확장 |
| 스냅샷 diff 기반 주간보고 생성 | desk 에 데이터 쓰기 |
| 주간 스냅샷 누적 기반 월간보고 생성 | 새로운 업무관리 시스템 |
| 장애 자료(외부 제공) 병합 | 장애 등록 화면 |
| 파일 출력 (Markdown · 엑셀 · PPTX) | 웹 UI · 대시보드 |
| 스케줄 실행 (주 1회 · 월 1회) | 알림 발송 |

---

## 3. 아키텍처

```
 ┌─ desk.saebom.me ─────────────┐
 │  GET /api/state  (읽기 전용) │
 └──────────────┬───────────────┘
                │  Cloudflare Access Service Token
                │  매주 월 09:00
                ▼
     ┌──────────────────────────┐
     │  scan                    │  원본 JSON 을 손대지 않고 그대로 저장
     │  → snapshots/2026-W32.json│
     └──────────┬───────────────┘
                │
      ┌─────────┴──────────┐
      ▼                    ▼
 ┌──────────┐        ┌──────────────────────────────┐
 │ weekly   │        │ monthly                      │
 │ W-1 diff │        │ 해당 월 주간 스냅샷 4~5개    │
 │          │        │  +  incidents/2026-08.csv    │
 └────┬─────┘        └───────────┬──────────────────┘
      ▼                          ▼
 out/weekly/2026-W32.{md,xlsx}   out/monthly/2026-08.{pptx,xlsx}
```

**서버를 두지 않습니다.** 로컬 Mac 의 launchd 또는 GitHub Actions 에서 도는 단일 CLI 입니다.

---

## 4. 인증 — 쿠키 방식 (확정)

desk 는 Cloudflare Access(`jolly-mouse-5602.cloudflareaccess.com`) 뒤에 있습니다. Service Token 은 Cloudflare 계정 소유자 권한이 필요하므로, **브라우저 로그인으로 발급된 `CF_Authorization` 쿠키를 재사용**하는 방식으로 확정합니다.

### 4.1 동작

```bash
curl -sf https://desk.saebom.me/api/state \
  -H "Cookie: CF_Authorization=<jwt>"
```

`CF_Authorization` 은 JWT 이므로 **페이로드의 `exp` 를 파싱해 만료 시점을 프로그램이 스스로 압니다.** 사람이 달력에 적어 둘 필요가 없습니다.

### 4.2 쿠키 확보 — 2가지 경로

**A. 자동 추출 (기본)** — macOS Chrome 프로필의 쿠키 DB 에서 직접 읽습니다.

```
~/Library/Application Support/Google/Chrome/<Profile>/Cookies   (SQLite)
   └─ 값은 AES-128-CBC 암호화 → Keychain 의 "Chrome Safe Storage" 키로 복호화
```

- 최초 1회 Keychain 접근 허용이 필요합니다 (macOS 가 묻습니다)
- **Chrome 이 실행 중이어도 읽을 수 있습니다** (DB 를 복사한 뒤 읽음)
- 프로필이 여러 개이므로 `config` 에 대상 프로필 경로를 지정합니다

**B. 수동 주입 (대체)** — 자동 추출이 실패하면 사람이 붙여넣습니다.

```bash
desk-reporter auth          # 쿠키 값을 물어보고 .env 에 저장, exp 를 표시
```

> DevTools → Application → Cookies → `https://desk.saebom.me` → `CF_Authorization` 값 복사

A 가 실패하는 상황(Chrome 업데이트로 암호화 방식 변경, Keychain 거부 등)에서도 B 로 즉시 복구되므로 자동화가 완전히 멈추지 않습니다.

### 4.3 만료 대응 — 이 방식의 유일한 약점

Cloudflare Access 세션은 **한 달**입니다. 만료되면 사람이 브라우저에서 메일 OTP 로 다시 로그인해야 합니다.

| 시점 | 동작 |
|---|---|
| 만료 7일 전 | `scan` 실행 시 경고 출력 + `data/auth-status.txt` 갱신 |
| 만료 3일 전 | macOS 알림 센터로 알림 (`osascript -e 'display notification'`) |
| 만료 후 첫 스캔 | 실패 기록 후 즉시 알림. **조용히 넘어가지 않는다** |
| 재로그인 후 | `desk-reporter auth` 또는 자동 추출이 새 쿠키를 잡아감 |

**한 달에 한 번, 브라우저에서 로그인 한 번**이 사람이 하는 유일한 작업입니다. 그 외에는 개입이 없습니다.

> 재로그인을 놓쳐 한 주를 건너뛰면 그 주의 변화(완료·일정변경)는 **영구히 복원되지 않습니다.**
> 다음 스캔에서 2주치 diff 로 뭉뚱그려 나오고, 주간보고 각주에 누락이 표기됩니다.
> 6.4 의 보조 스캔(주 2회)이 이 위험을 줄이는 장치입니다.

### 4.4 실행 위치 — 로컬 Mac 고정

쿠키가 이 Mac 의 Chrome 프로필에 묶여 있으므로 **GitHub Actions 로 옮길 수 없습니다.** macOS `launchd` 로 실행합니다. (Service Token 을 나중에 발급받으면 그때 Actions 이관을 재검토합니다.)

---

## 5. 데이터 모델

### 5.1 스냅샷 (`snapshots/YYYY-Wnn.json`)

`/api/state` 응답을 **가공 없이 그대로** 저장하고, 수집 메타만 덧붙입니다.

```jsonc
{
  "meta": {
    "scannedAt": "2026-08-10T00:00:12.431Z",
    "yearWeek":  "2026-W33",
    "periodFrom": "2026-08-03",   // 월요일
    "periodTo":   "2026-08-09",   // 일요일
    "sourceUpdatedAt": "2026-08-09 21:14:02",  // state.updatedAt
    "counts": { "work": 32, "projects": 11, "decisions": 2 }
  },
  "state": { /* 원본 그대로 */ }
}
```

**가공하지 않는 이유**: 나중에 보고서 양식이 바뀌어도 과거 스냅샷에서 다시 뽑을 수 있어야 합니다. 수집 시점에 요약해 버리면 그 순간 정보가 소실됩니다.

### 5.2 desk 원본 필드 (실측)

| 컬렉션 | 건수 | 필드 |
|---|---|---|
| `work` | 32 | `id, owner, title, project, system, parent, status, start, due, completedOn, progress, types, detail, assessment, log` |
| `projects` | 11 | `key, title, codename, parent, system, overview, memo, assessment, current, policy, milestones[{name,done}], participants, start, due, systems, owner, scale` |
| `systems` | 11 | `key, title, status, overview, memo, assessment, current, policy, participants, retro` |
| `people` | 7 | `name, github, role, domain, assessment` |
| `decisions` | 2 | `id, at, status, escalate, title, body, project, system, work` |
| `reports` | 1 | desk 자체 주간 스냅샷 (참고용, 우리는 자체 스냅샷을 쓴다) |
| `todos` `notes` `meetings` `references` | 0 | 비어 있음 — 사용하지 않음 |

`status` 값: `ing` · `todo` · `done`
`types` 값: `plan` · `feature` · `ops` · `improve` · `design` · `bug` · `analysis`

**값이 비어 있는 필드** (보고서에서 기대하면 안 되는 것):

| 필드 | 채워진 비율 | 영향 |
|---|---|---|
| `work.progress` | **0 / 32** | 업무 단위 진척율 산출 불가 → 프로젝트 `milestones` 로 대체 |
| `work.assessment` | **0 / 32** | 진행 내용 텍스트 없음 |
| `work.log` | 1 / 32 | 변경 이력 없음 → diff 로 대체 |
| `work.detail.notes` | 4 / 32 | 진행 내용 텍스트 부족 |
| `work.due` | 20 / 32 | **12건 마감일 없음** → 6.1 규칙으로 처리 |

### 5.3 장애 자료 (`incidents/YYYY-MM.csv`) — 외부 제공

desk 에 장애 데이터가 없으므로 **별도 파일로 투입**합니다. 형식을 고정합니다.

```csv
occurred_at,title,system,severity,cause_type,action,status,recurrence_action
2026-07-03,외국인 온라인 회원가입 500 오류,WEB,critical,코드결함,핫픽스 배포,resolved,입력값 검증 추가
2026-07-11,입금액·주문금액 불일치 미승인,Payment,critical,데이터,수동 정정,resolved,
2026-07-18,특정 조회 화면 오류,Order,major,코드결함,,responding,
```

| 열 | 필수 | 허용값 |
|---|---|---|
| `occurred_at` | ✅ | `YYYY-MM-DD` |
| `title` | ✅ | 자유 |
| `system` | ✅ | desk `systems.title` 과 맞추면 연결됨 (BRS / Payment / Infra / Compliance / Workspace / Order / Car Bonus / Messaging / Virtual Account / Member / Firmbanking) |
| `severity` | ✅ | `critical` (매우심각) · `major` (심각) · `normal` (보통) |
| `cause_type` | | 코드결함 · 데이터 · 인프라 · 외부연동 · 운영실수 · 기타 |
| `action` | | 조치 내용 |
| `status` | | `responding` · `resolved` (기본 `responding`) |
| `recurrence_action` | | 재발방지 대책 |

**월별 추이 차트(최근 7개월)를 그리려면 과거 6개월치 CSV 도 함께 제공되어야 합니다.** 없는 달은 차트에서 `데이터 없음`으로 표기하고 조용히 0으로 처리하지 않습니다.

---

## 6. 집계 규칙

모든 규칙은 순수 함수로 구현하고 단위 테스트를 붙입니다. 렌더링 코드에서 직접 집계하지 않습니다.

### 6.1 상태 판정 — 마감일 없는 건의 처리

```
완료   : status = 'done'
지연   : status ≠ 'done'  AND  due 존재  AND  due < 기준일
진행중 : 그 외  ← due 가 없는 12건이 전부 여기로 들어온다
```

**마감일이 없는 업무는 지연으로 판정하지 않습니다.** 대신 일정 칸에 단계를 명시합니다.

```
due 있음 · 변경 없음 :  "8/6"
due 있음 · 변경 있음 :  "7/13 → 8/6"          ← 스냅샷 diff 로 복원
due 없음             :  "(계획)"              ← 12건이 여기에 해당
```

> 마감일 미정을 지연으로 처리하면 매주 12건이 빨갛게 뜨고, 보고서를 보는 사람이 신호를 무시하게 됩니다.
> `(계획)` 표기는 "아직 일정이 잡히지 않았다"는 사실 자체를 보고서에 드러냅니다. 숨기지 않되 지연과 섞지 않습니다.

### 6.2 진척율

`work.progress` 가 전부 비어 있으므로 **프로젝트 단위로만** 산출합니다.

```
프로젝트 진척율 = milestones.filter(done).length / milestones.length × 100
```

실측 예: 글로벌 BRS — 홍콩 `4/9 = 44%`, 결제 시스템 구축 `8/9 = 89%`

업무 단위 진척율은 표기하지 않습니다. **없는 숫자를 지어내지 않습니다.**

### 6.3 주차 정의

**ISO 주차, 월요일 00:00 ~ 일요일 23:59.** `2026-W32` 형식.

> desk 자체 스냅샷은 `periodFrom: 2026-07-19`(일) ~ `id: 2026-07-27`(월) 로 8일 구간을 씁니다.
> 우리 도구는 ISO 주차로 통일하고, desk 의 `reports[]` 는 참고만 하고 집계에 쓰지 않습니다.

### 6.4 주간 diff

지난주 스냅샷과 이번주 스냅샷을 `work.id` 기준으로 대조합니다.

| 분류 | 조건 |
|---|---|
| 신규 | 지난주에 없던 `id` |
| 완료 | `done` 이 아니었다가 `done` |
| 착수 | `todo` → `ing` |
| 일정변경 | `due` 값이 달라짐 (양쪽 다 값이 있을 때만) |
| 일정확정 | `due` 가 `null` → 값 (= `(계획)` 이 실제 일정을 얻음) |
| 진척 | 소속 프로젝트의 `milestones` done 개수 증가 |
| 정체 | 3주 연속 `ing` 이면서 위 변화가 하나도 없음 |

**첫 주차에는 diff 를 만들 수 없습니다.** 이때는 "기준 주차 — 비교 대상 없음"을 명시하고 현재 상태만 싣습니다.

### 6.5 월간 집계

해당 월에 걸친 **주간 스냅샷 전부**를 입력으로 받습니다.

| 항목 | 산출 |
|---|---|
| 완료 건수 | 그 달 안에 `done` 으로 전이한 업무 (주간 diff 의 완료를 합집합) |
| 진행 건수 | 월말 스냅샷 기준 `ing` + `due` 없는 `todo` |
| 지연 건수 | 월말 스냅샷 기준 6.1 지연 |
| 일정변경 | 그 달의 주간 diff 일정변경을 누적 → `7/13 → 8/6` |
| 프로젝트 진척 | 월초 스냅샷 vs 월말 스냅샷의 `milestones` 차이 |
| 의사결정 | `decisions` 중 `at` 이 그 달이거나 미해소인 건 (`escalate: true` 우선) |
| 차월 계획 | `due` 가 차월인 미완료 업무 + `(계획)` 업무 중 프로젝트 `due` 가 차월인 것 |
| **장애 전체** | `incidents/YYYY-MM.csv` |

**누락 주차가 있으면 보고서 각주에 명시합니다.** 예: `※ 2026-W33 스냅샷 누락 — 해당 주 변화분 미반영`

---

## 7. 출력

### 7.1 주간보고

| 형식 | 용도 |
|---|---|
| `out/weekly/2026-W32.md` | 메신저·메일 붙여넣기 |
| `out/weekly/2026-W32.xlsx` | 보고 라인 제출 |

**구성**

```
■ 2026-W32 (8/3 ~ 8/9)              진행 11 · 완료 12 · 지연 2 · 계획 12

■ 금주 완료
- 컴플라이언스 백엔드 분리작업 (Ji · 컴플라이언스 리뉴얼)
- Membership 멀티테넌트 작업 (Jayce · 글로벌 BRS)

■ 진행 중
- FABB 보너스 구현 (Jin · 글로벌 BRS) ~8/14
- 카보너스 관리자 서비스 분석 및 기획 (Alexa) (계획)

■ 지연
- 홍콩 클러스터 도메인 Ingress 설정 (Jin) 마감 7/31 · 4일 경과

■ 일정 변경
- 네이버페이 PG사 화면 구현 (Jacqueline) 7/13 → 8/6

■ 프로젝트 진척
- 결제 시스템 구축 8/9 (89%) ▲1
- 글로벌 BRS — 홍콩 4/9 (44%) —

■ 의사결정 필요
- HK 보너스 환율 = 발생(적립)월 환율로 락 [decided]

■ 정체 (3주 이상 변화 없음)
- Authz 멀티테넌트 구현 (Alexa)
```

### 7.2 월간보고

`docs/SPEC-V2.md` 7장의 **PPTX 1슬라이드 사양을 그대로 따릅니다.** 좌표·색상·표 사양이 이미 확정되어 있고, `~/Documents/PMSchedule/src/lib/exportPptx.ts` 에 구현체가 있습니다. 데이터 어댑터만 새로 씁니다.

| 보고서 영역 | 공급원 |
|---|---|
| 1. 개발 안건별 진행 현황 | 주간 스냅샷 누적 |
| 2. 장애 발생 추이 | `incidents/*.csv` |
| 3. 주요 이슈 및 의사결정 | `decisions` |
| 4. 차월 계획 | `due` 차월 업무 |
| 중점 문구 · 작성자 · 보고일 | `config/monthly-YYYY-MM.yml` (수동) |

엑셀도 함께 출력합니다 (`out/monthly/2026-08.xlsx`).

---

## 8. 구성

**위치**: `~/Documents/PMS/desk-reporter/` (확정)
`~/Documents/PMS/docs/` 의 기획서와 같은 트리에 두어, 사양과 구현이 함께 움직이도록 합니다.

```
~/Documents/PMS/
├─ docs/
│  ├─ SPEC.md          # TaskBoard Lite v1 (별개 프로젝트)
│  ├─ SPEC-V2.md       # TaskBoard Lite v2 — 월간보고 PPTX 사양을 여기서 재사용
│  ├─ SETUP.md
│  └─ SPEC-REPORTER.md # 이 문서
└─ desk-reporter/      # ← 이번에 만들 것

desk-reporter/
├─ src/
│  ├─ cli.ts               # scan | weekly | monthly
│  ├─ fetch.ts             # /api/state + Service Token
│  ├─ snapshot.ts          # 저장·로드, ISO 주차 계산
│  ├─ diff.ts              # 6.4 주간 diff          (순수)
│  ├─ weekly.ts            # 6.4 → 주간보고 데이터  (순수)
│  ├─ monthly.ts           # 6.5 월간 집계          (순수)
│  ├─ incidents.ts         # CSV 파서·검증
│  └─ render/
│     ├─ markdown.ts
│     ├─ xlsx.ts           # PMSchedule/excel.ts 이식
│     └─ pptx.ts           # PMSchedule/exportPptx.ts 이식
├─ data/
│  ├─ snapshots/2026-W32.json
│  ├─ incidents/2026-07.csv
│  └─ out/{weekly,monthly}/
├─ config/
│  └─ monthly-2026-08.yml
└─ .env                    # CF_ACCESS_CLIENT_ID / SECRET  (커밋 금지)
```

**명령**

```bash
desk-reporter scan                 # 지금 상태를 이번 주 스냅샷으로 저장
desk-reporter weekly 2026-W32      # 주간보고 생성 (생략 시 지난주)
desk-reporter monthly 2026-08      # 월간보고 생성 (생략 시 전월)
desk-reporter doctor               # 인증·스냅샷 연속성·장애 CSV 점검
```

`scan` 은 **멱등**입니다. 같은 주차에 두 번 돌리면 덮어쓰되, 기존 파일을 `snapshots/.archive/` 로 옮겨 보관합니다.

---

## 9. 스케줄

| 시점 | 명령 | 이유 |
|---|---|---|
| 매주 월 09:00 | `scan` → `weekly` | 지난주 마감 직후. 주간회의 전에 초안이 나온다 |
| 매주 목 18:00 | `scan` | 보조 수집. 월요일 실패 시 데이터 공백을 줄인다 |
| 매월 1일 09:30 | `monthly` | 전월 마지막 주 스캔이 끝난 뒤 |

macOS `launchd` 로 등록합니다 (`~/Library/LaunchAgents/me.saebom.desk-reporter.plist`).
Mac 이 꺼져 있어 놓친 스캔은 부팅 후 자동 실행합니다 (`StartCalendarInterval` + 누락 감지).

> GitHub Actions 로 옮기면 Mac 전원과 무관해집니다. Service Token 이 준비되면 이쪽을 권합니다.
> 스냅샷을 private 저장소에 커밋하면 이력 보존과 백업이 동시에 해결됩니다.

**실패 처리**: 스캔 실패 시 3회 재시도, 그래도 실패하면 `data/scan-errors.log` 에 기록하고 다음 주간보고 각주에 표기합니다. **조용히 넘어가지 않습니다.**

---

## 10. 단계별 구현

| Step | 내용 | 소요 | 선행 |
|---|---|---|---|
| 0 | 쿠키 추출(`auth`) + 만료 감지·알림 | 0.3일 | — |
| 1 | `fetch` + `snapshot` + `scan` 명령. 첫 스냅샷 확보 | 0.3일 | Step 0 |
| 2 | launchd 등록. 주 2회 스캔 시작 (**여기서부터 데이터가 자란다**) | 0.2일 | Step 1 |
| 3 | `diff` + `weekly` 집계. 단위 테스트 | 0.5일 | Step 1 |
| 4 | Markdown · 엑셀 주간 출력 | 0.3일 | Step 3 |
| 5 | `incidents` CSV 파서 + 검증 | 0.2일 | 장애 자료 |
| 6 | `monthly` 집계 (주간 스냅샷 N개 + 장애) | 0.5일 | Step 3, 5 |
| 7 | PPTX·엑셀 월간 출력 (PMSchedule 이식) | 0.5일 | Step 6 |
| | **합계** | **약 2.5일** | |

**Step 1~2 를 먼저 끝내는 것이 중요합니다.** 보고서 코드가 없어도 스냅샷은 쌓입니다. 반대로 보고서를 먼저 만들면 비교할 과거 데이터가 없어 첫 달을 통째로 날립니다.

---

## 11. 검증 체크리스트

| # | 항목 |
|---|---|
| 1 | 브라우저를 닫은 상태에서 쿠키만으로 `/api/state` 200 응답 |
| 1b | 쿠키 만료 7일 전 경고, 3일 전 알림 센터 알림이 실제로 뜸 |
| 1c | 만료된 쿠키로 스캔 시 실패가 기록되고 다음 보고서 각주에 표기됨 |
| 2 | `scan` 두 번 실행 시 아카이브 보관되고 최신본만 유효 |
| 3 | 마감일 없는 12건이 전부 **진행중 · `(계획)`** 으로 표기 |
| 4 | 마감일 지난 미완료 건만 **지연**으로 표기 |
| 5 | W-1 대비 `due` 가 바뀐 건이 `7/13 → 8/6` 형식으로 나옴 |
| 6 | 첫 주차 실행 시 "비교 대상 없음"이 명시되고 오류 없이 완료 |
| 7 | 스냅샷 누락 주차가 월간보고 각주에 표기됨 |
| 8 | 장애 CSV 의 `severity` 오타가 파싱 단계에서 차단됨 |
| 9 | 장애 CSV 없는 달의 월간보고 생성 시 해당 섹션이 "자료 미제공"으로 표기 |
| 10 | 프로젝트 진척율이 `milestones` 실측과 일치 (BRS 4/9 = 44%) |
| 11 | 생성 PPTX 가 PowerPoint 에서 손상 경고 없이 열림 |
| 12 | 07월 실제 보고서와 나란히 놓고 육안 비교 — 누락 항목 확인 |

---

## 12. 결정이 필요한 사항

**전 항목 확정 완료 (2026-08-04).**

| # | 항목 | 결정 |
|---|---|---|
| 1 | 인증 방식 | ✅ **쿠키 방식** (4장). 월 1회 브라우저 재로그인 필요 |
| 2 | 실행 위치 | ✅ **로컬 Mac launchd** — 쿠키가 이 프로필에 묶여 있어 Actions 불가 |
| 3 | 주간보고 출력 형식 | ✅ **Markdown + 엑셀** |
| 4 | 주간보고 그룹 단위 | ✅ **프로젝트별** (desk Weekly Report 화면과 동일) |
| 5 | 장애 과거 데이터 범위 | ✅ **당월분 기준으로 구현, 과거분은 나중에 투입** — 13장 참조 |
| 6 | 스냅샷 보관 위치 | ✅ **로컬 `data/` + private Git 저장소 자동 커밋·푸시** |

### 12.1 스냅샷 Git 보관 (결정 6)

`scan` 이 성공하면 자동으로 커밋·푸시합니다.

```
data/ 가 private 저장소의 작업 트리
  scan 성공 → git add data/snapshots/2026-W33.json
            → git commit -m "scan: 2026-W33 (work 32 · projects 11)"
            → git push
```

- 푸시 실패(네트워크 등)는 **스캔 실패로 취급하지 않습니다.** 로컬 파일은 이미 저장됐으므로 다음 스캔 때 함께 올라갑니다
- 저장소는 **반드시 private** 입니다. 업무명·담당자·의사결정 본문이 들어 있습니다
- 커밋 이력 자체가 "언제 무엇이 수집됐는지"의 감사 로그가 됩니다

---

## 13. 장애 자료 — 과거분 미확보 상태에서의 설계 (결정 5)

과거 몇 개월치를 확보할 수 있을지 미정이므로, **나중에 CSV 를 폴더에 넣기만 하면 차트가 자동으로 채워지는 구조**로 만듭니다. 코드 수정이 필요 없어야 합니다.

```
data/incidents/
  2026-08.csv     ← 있음
  2026-07.csv     ← 있음
  (2026-06.csv 이하 없음)
```

**월별 추이 차트 렌더링 규칙**

| 상황 | 표기 |
|---|---|
| CSV 있음 | 실제 건수 막대 |
| CSV 없음 | 막대 자리를 비우고 축 라벨 아래 `-` 표기 |
| 전월 CSV 없음 | 전월 대비 증감을 `전월 자료 미제공` 으로 표기 (0건으로 계산하지 않음) |
| 당월 CSV 없음 | 장애 섹션 전체를 `자료 미제공` 박스로 대체 |

**절대로 없는 달을 0건으로 처리하지 않습니다.** 0건과 미제공은 완전히 다른 사실이고, 0으로 처리하면 "장애가 줄고 있다"는 잘못된 결론이 보고서에 남습니다.

각주에 자동으로 덧붙입니다: `※ 장애 데이터 제공 범위 : 2026-07 ~ 2026-08 (이전 월 미제공)`

> 과거분을 나중에 확보하면 CSV 를 폴더에 넣고 `desk-reporter monthly 2026-08 --rebuild` 만 실행하면 됩니다.
> 이미 생성된 과거 월간보고도 같은 방식으로 다시 뽑을 수 있습니다.
