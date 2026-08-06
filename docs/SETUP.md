# 설치·환경구축 가이드

메일 기반 이슈 트래킹 시스템을 처음부터 띄우는 절차입니다.

| 단계 | 내용 | 소요 |
|---|---|---|
| [0](#0-준비물) | 준비물 확인 | 5분 |
| [1](#1-supabase-프로젝트-생성) | Supabase 프로젝트 생성 | 5분 (+대기 2분) |
| [2](#2-스키마-실행) | 테이블·RLS·Storage 만들기 | 3분 |
| [3](#3-로그인-정책-설정) | 로그인 정책 설정 | 3분 |
| [4](#4-계정-만들기) | 관리자·팀원 계정 생성 | 5분 |
| [5](#5-키-확인) | API 키 확인 | 3분 |
| [6](#6-웹-대시보드-로컬-실행) | 웹 대시보드 로컬 실행 | 5분 |
| [7](#7-관리자-지정) | 관리자 지정 | 2분 |
| [8](#8-local-pc-에이전트-설치) | Local PC 에이전트 설치 | 15분 |
| [9](#9-github-pages-배포) | GitHub Pages 배포 | 10분 |
| [10](#10-동작-확인-체크리스트) | 동작 확인 | 15분 |

---

## 0. 준비물

**계정 3개**

| 계정 | 용도 | 비용 |
|---|---|---|
| Supabase | DB·인증·파일 저장 | 무료 플랜 |
| Google AI Studio | 메일 분류 LLM (Gemini) | 무료 한도 있음 · 초과 시 종량제 |
| GitHub | 대시보드 배포 | 무료 |

**PC 2종**

| 역할 | 요구사항 |
|---|---|
| 관리자 PC (에이전트) | **Windows + Outlook 데스크톱**, Python 3.10 이상 |
| 개발/배포용 | Node.js 20 이상, git |

> 에이전트는 Outlook COM(`pywin32`)으로 메일을 읽습니다. macOS·Linux 에서는 실제 메일 수집이
> 되지 않고, `AGENT_MAIL_BACKEND=fixture` 로 흐름만 확인할 수 있습니다.

**LLM 비용 감각** — 메일 한 통 분류에 본문 절단 기준 대략 2~4천 토큰이 듭니다.
하루 30통이면 월 1,000통 안쪽입니다. 기본 모델은 `gemini-2.5-flash` 로,
무료 한도 안에서 처리되거나 초과해도 매우 적은 금액입니다.
정확도가 아쉬우면 `.env` 의 `GEMINI_MODEL` 을 상위 모델로 올리면 됩니다 —
쓸 수 있는 모델 목록은 `ticket-agent doctor` 가 알려줍니다.

---

## 1. Supabase 프로젝트 생성

1. <https://supabase.com/dashboard> → **New project**

   | 항목 | 값 |
   |---|---|
   | Name | `ticket-system` |
   | Database Password | 강한 비밀번호. 비밀번호 관리자에 보관 |
   | Region | **Northeast Asia (Seoul)** |
   | Plan | Free |

2. **Create new project** → 프로비저닝에 1~2분.

> **리전은 나중에 바꿀 수 없습니다.** 팀이 국내에 있다면 Seoul 을 고르세요.

---

## 2. 스키마 실행

1. 왼쪽 메뉴 **SQL Editor** → **New query**
2. [`supabase/schema.sql`](../supabase/schema.sql) 전체를 붙여넣고 **Run**
3. `Success. No rows returned` 이 나오면 성공입니다.

이 한 파일이 테이블 8개, RLS 정책, 트리거, Storage 버킷, 통계 뷰를 전부 만듭니다.
**여러 번 실행해도 안전합니다.**

**확인** — 같은 편집기에서:

```sql
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' order by tablename, cmd;
```

`users` `tickets` `ticket_meta` `ticket_status_history` `comments` `attachments`
`outbound_emails` 7개 테이블의 정책이 보여야 합니다.

Storage 버킷도 확인합니다:

```sql
select id, public from storage.buckets where id = 'ticket-attachments';
```

`public` 이 **false** 여야 합니다. true 면 첨부파일이 URL 만 알면 누구나 열립니다.

---

## 3. 로그인 정책 설정

**Authentication** → **Sign In / Providers** → **Email**

| 설정 | 값 | 이유 |
|---|---|---|
| Enable Email provider | **ON** | 메일+비밀번호 로그인 |
| **Confirm email** | **OFF** | 사내 계정에 확인 메일을 보내지 않습니다 |
| **Allow new users to sign up** | **OFF** | 등록한 사람만 접속 |

**Save** 를 누릅니다.

> **이 두 개를 끄는 것이 이 앱의 접근 통제 전부입니다.** GitHub Pages URL 은 인터넷 전체에
> 공개되므로, 셀프 가입이 열려 있으면 누구나 계정을 만들어 티켓 내용을 열람할 수 있습니다.

---

## 4. 계정 만들기

> ### ⚠️ 이 시스템에는 기본 계정이 없습니다
>
> 초기 이메일·비밀번호 같은 것은 존재하지 않습니다. 기획서상 **셀프 가입이 없고**,
> 관리자가 Supabase 대시보드에서 계정을 직접 만드는 구조입니다.
> 이 단계를 건너뛰면 로그인할 수 있는 계정이 하나도 없습니다.

**Authentication** → **Users** → **Add user** → **Create new user**

| 항목 | 값 |
|---|---|
| Email | 사내 메일 주소 (예: `david@example.co.kr`) |
| Password | 초기 비밀번호 |
| **Auto Confirm User** | **반드시 체크** |

> `Auto Confirm User` 를 체크하지 않으면 그 계정은 확인 메일을 기다리는 상태로 남아
> **로그인이 되지 않습니다.** 실수했다면 삭제 후 재생성하세요.

계정을 만들면 트리거가 `public.users` 행을 자동으로 만듭니다. **기본 역할은 팀원(member)** 입니다.

---

## 5. 키 확인

필요한 값이 **3개**이고 서로 다른 화면에 있습니다.

### 5-1. Project URL — Settings → **Data API**

```
https://xxxxxxxxxxxx.supabase.co     →  VITE_SUPABASE_URL / SUPABASE_URL
```

### 5-2. Publishable key — Settings → **API Keys**

`Publishable and secret API keys` 탭의 **Publishable key** `default` 행.

```
sb_publishable_xxxxxxxxxxxx          →  VITE_SUPABASE_ANON_KEY   (웹 대시보드용)
```

### 5-3. Secret key — 같은 화면

```
sb_secret_xxxxxxxxxxxx               →  SUPABASE_SERVICE_KEY     (에이전트 전용)
```

> ### ⚠️ 두 키의 용도가 다릅니다
>
> | 키 | 어디에 | 왜 |
> |---|---|---|
> | **Publishable** | 웹 대시보드 (`web/.env`, GitHub Secrets) | 공개돼도 RLS 가 막습니다 |
> | **Secret** | **에이전트 PC 의 `agent/.env` 한 곳만** | RLS 를 **전부 무시**합니다 |
>
> Secret 키를 웹에 넣으면 정적 사이트라 브라우저 개발자도구에 그대로 노출되고,
> URL 을 아는 누구나 모든 테이블을 읽고 지울 수 있게 됩니다. **절대 넣지 마세요.**

### 5-4. Gemini API 키

<https://aistudio.google.com/apikey> → **Create API key** → `AIza…`

키를 넣는 곳은 두 군데이고, **설정 화면이 우선입니다.**

| 넣는 곳 | 언제 쓰나 |
|---|---|
| 웹 → 설정 → 시스템 설정 → Gemini API 키 | **권장.** 키를 바꿀 때 Windows PC 에 붙지 않아도 됩니다 |
| `agent/.env` 의 `GEMINI_API_KEY` | 대비책. 화면에 등록하지 않았을 때 씁니다 |

설정 화면에 등록하면 `.env` 의 값은 무시됩니다. 화면에서 바꿨는데 `.env` 가
이기면, 바꾼 줄 알고 옛 키를 계속 쓰게 되기 때문입니다.

**한 번 등록한 키는 화면에서 다시 볼 수 없습니다** — 마지막 4글자만 남습니다.
값을 저장한 표(`app_secrets`)에는 RLS 정책이 하나도 없어 웹에서 읽는 경로 자체가
없고, 읽는 쪽은 service_role 로 붙는 에이전트뿐입니다. 확인이 필요하면 확인하지
말고 새 키로 교체하세요.

어느 쪽 키를 쓰고 있는지는 `ticket-agent doctor` 가 알려 줍니다.

에이전트 PC 의 `agent/.env` 에만 넣습니다. 웹 대시보드는 LLM 을 직접 부르지 않습니다.

---

## 6. 웹 대시보드 로컬 실행

### macOS — 더블클릭

저장소 최상단의 **`start-dashboard.command`** 를 Finder 에서 더블클릭합니다.

터미널이 열리면서 Node 확인 → `.env` 확인 → 의존성 설치 → 서버 실행 → 브라우저 열기까지
자동으로 진행됩니다. 처음 한 번은 의존성 설치 때문에 1~2분 걸립니다.

`.env` 가 없으면 예시에서 만들어 편집기로 열어 주고 멈춥니다. 5-1(URL)과
5-2(**Publishable** key) 두 값을 채우고 저장한 뒤 다시 더블클릭하세요.

> 이 스크립트는 **대시보드만** 띄웁니다. 메일 수집 에이전트는 아웃룩이 설치된
> Windows PC 에서 실행합니다 (8장).

> **"열 수 없습니다" 경고가 뜨면** — 처음 받은 파일이라 macOS 가 막은 것입니다.
> 파일에서 마우스 오른쪽 클릭 → **열기** → **열기** 를 한 번 누르면 이후로는 그냥 열립니다.
> 터미널에서 받았다면 `chmod +x start-dashboard.command` 가 필요할 수 있습니다.

종료는 터미널 창에서 **Ctrl+C**.

### 직접 실행 (모든 OS)

```bash
cd web
cp .env.example .env
# .env 를 열어 5-1(URL), 5-2(Publishable key) 두 값을 붙여넣습니다

npm install
npm run dev
```

<http://localhost:5173/ticket-dashboard/> 를 엽니다.
4단계에서 만든 계정으로 로그인하면 빈 보드가 보입니다.

`web/.env` 는 `.gitignore` 에 있어 커밋되지 않습니다.

---

## 7. 관리자 지정

`public.users` 행은 **계정 생성 시** 트리거가 만들므로 바로 실행할 수 있습니다.
**SQL Editor** 에서:

```sql
update public.users set role = 'admin' where email = 'admin@example.co.kr';
```

`UPDATE 1` 이 나오면 성공입니다. 이후 관리자 승격·강등은 대시보드의 **사용자** 메뉴에서 합니다.

> **왜 SQL 로 해야 하나** — 역할 변경은 트리거가 관리자만 허용합니다. 그런데 첫 관리자는
> 아직 아무도 관리자가 아닐 때 만들어야 하므로, 이 경로가 필요합니다.
> 트리거는 `auth.uid()` 가 null 인 경우(SQL Editor·service_role·마이그레이션)를 통과시켜
> 이 교착을 피합니다. 실제로 막는 대상은 **로그인한 팀원이 API 로 자기 역할을 올리는 경우**입니다.

> `UPDATE 0` 이 나오면 `public.users` 에 행이 없는 것입니다.
> 계정 생성 트리거가 만들지만, 이 스키마를 적용하기 전에 만든 계정이라면
> `schema.sql` 을 다시 실행하세요 (백필 INSERT 가 들어 있습니다).

관리자만 할 수 있는 일: 담당자 배정 · 회신 발송 요청 · 티켓 삭제 · 역할 변경 · 첨부 삭제.

---

## 8. Local PC 에이전트 설치

**관리자 PC(Windows + Outlook)에서** 진행합니다.

### 8-1. 설치

```powershell
cd agent
python -m venv .venv
.venv\Scripts\activate
pip install -e .
```

### 8-2. 환경설정

```powershell
copy .env.example .env
notepad .env
```

최소한 이 값들을 채웁니다:

| 키 | 값 |
|---|---|
| `SUPABASE_URL` | 5-1 의 Project URL |
| `SUPABASE_SERVICE_KEY` | **5-3 의 Secret key** |
| `GEMINI_API_KEY` | 5-4 의 키. **설정 화면에 등록했다면 비워 둬도 됩니다** |
| `OUTLOOK_FOLDER` | 스캔할 폴더. 하위 폴더는 `받은 편지함/요청` |
| `OUTLOOK_DONE_FOLDER` | 처리한 메일을 옮길 폴더 (비우면 읽음 표시만) |

### 8-3. 아웃룩 폴더 준비

받은편지함 아래에 `요청` 폴더를 만들고, 규칙(Rule)으로 요구사항 메일이 그 폴더로
들어가게 하거나, 담당자가 수동으로 옮깁니다.

> 폴더를 나누지 않고 받은편지함 전체를 스캔해도 동작합니다 — LLM 이 일상 메일을 걸러냅니다.
> 다만 메일 수만큼 API 비용이 나가므로 폴더를 나누는 편이 쌉니다.

### 8-4. 점검

```powershell
ticket-agent doctor
```

Supabase · 메일 백엔드 · Gemini API 세 항목이 전부 ✅ 여야 합니다.

`GEMINI_MODEL` 이 키로 쓸 수 없는 모델이면, doctor 가 **실제 사용 가능한 모델 목록**을
출력해 줍니다. 그중 하나로 `.env` 를 고치면 됩니다.

### 8-5. 실행

```powershell
ticket-agent collect          # 한 번만 스캔 (처음엔 이걸로 확인)
ticket-agent run              # 수집 + 발송 상시 실행
```

### 8-6. 상시 실행 등록 (작업 스케줄러)

1. **작업 스케줄러** → 작업 만들기
2. 트리거: **로그온할 때**
3. 동작: 프로그램 시작
   - 프로그램: `C:\...\agent\.venv\Scripts\ticket-agent.exe`
   - 인수: `run`
   - 시작 위치: `C:\...\agent`
4. 조건 → "컴퓨터의 AC 전원이 켜져 있는 경우에만 시작" **해제**

---

## 9. GitHub Pages 배포

### 9-1. 저장소에 올리기

```bash
git init
git add -A
git commit -m "초기 구현"
git branch -M main
gh repo create ticket-dashboard --public --source=. --remote=origin --push   # 완료됨
```

> **저장소 이름을 `ticket-dashboard` 가 아닌 것으로 만들었다면**
> `web/vite.config.ts` 의 `base` 를 `'/실제저장소이름/'` 으로 고치고 다시 push 하세요.
> 이게 안 맞으면 배포된 페이지가 흰 화면으로 나옵니다.

> **Free 플랜의 Pages 는 Public 저장소에서만 동작합니다.** Secret 키는 저장소에 없고
> Publishable 키만 Actions Secrets 로 주입되므로 Public 이어도 문제없습니다.
> 다만 **배포된 앱 주소는 인터넷에 공개**되므로 3단계의 셀프 가입 OFF 가 유일한 방어선입니다.

### 9-2. Secrets 등록

```bash
gh secret set VITE_SUPABASE_URL       # 5-1 의 값
gh secret set VITE_SUPABASE_ANON_KEY  # 5-2 의 Publishable key
```

> **Secret 키(`sb_secret_…`)를 여기 넣지 마세요.** 웹 번들에 들어가 그대로 노출됩니다.

### 9-3. Pages 켜기

**Settings** → **Pages** → **Source** 를 **GitHub Actions** 로.

### 9-4. 배포

```bash
gh workflow run deploy.yml
gh run watch
```

`npm ci → npm test → npm run build → deploy` 순서로 2~3분 걸립니다.
이후 `main` 의 `web/` 이 바뀔 때마다 자동 배포됩니다.

> **Secrets 등록 전에는 로그인 화면에 경고 배너가 뜹니다.** Secrets 는 빌드 시점에
> 주입되므로 등록 후 **반드시 재배포**해야 반영됩니다.

---

## 10. 동작 확인 체크리스트

### 기본

| # | 확인 항목 | 기대 |
|---|---|---|
| 1 | 배포 URL 접속 | 로그인 화면 |
| 2 | 등록되지 않은 메일로 로그인 | 실패 (가입 화면 자체가 없음) |
| 3 | 로그인 후 새로고침 | 로그인 유지 (HashRouter + 세션) |
| 4 | 개발자도구 → Network | `sb_secret` 문자열이 **어디에도 없음** |

### 수집 (기획서 2-1~3)

| # | 확인 항목 | 기대 |
|---|---|---|
| 5 | 요구사항 메일을 대상 폴더에 넣고 `ticket-agent collect` | 티켓 생성, 보드 '접수 대기' 열에 표시 |
| 6 | 같은 메일로 `collect` 재실행 | **중복 티켓이 생기지 않음** (`중복 1건` 로그) |
| 7 | 일상 메일(회식 공지 등)로 실행 | 티켓이 생기지 않음 (`대상아님 1건`) |
| 8 | 첨부가 있는 메일 | 상세 화면에서 첨부 클릭 → 다운로드됨 |
| 9 | 카드 표시 항목 | 제목·요청자·등급·시스템·접수일·기한이 모두 보임 |
| 10 | 본문이 한 줄뿐인 부실한 메일 | **반려되지 않고** 적재됨 |
| 11 | `GEMINI_API_KEY` 를 틀리게 두고 실행 | 티켓은 생기고 `⚠ 자동분류 실패` 배지가 뜸 |

### 티켓 관리 (기획서 3.2)

| # | 확인 항목 | 기대 |
|---|---|---|
| 12 | 관리자로 카드를 다른 열로 드래그 | 상태 변경, 이력에 기록 |
| 13 | 팀원으로 두 칸 건너뛰기 드래그 | 차단 + 안내 메시지 |
| 14 | 팀원으로 남의 티켓 드래그 | 차단 |
| 15 | 코멘트 작성 | 목록에 추가됨 |
| 16 | 관리자 → 담당자 배정 | 카드에 담당자 표시 |
| 17 | 팀원으로 담당자 셀렉트 | 비활성 |

### 회신 발송 (기획서 2-5, 5-4)

| # | 확인 항목 | 기대 |
|---|---|---|
| 18 | 완료 전 회신 패널 | "완료 처리한 뒤에" 안내 |
| 19 | 완료 처리 후 관리자로 회신 초안 작성 | 코멘트가 '처리 내역' 절에 들어감 |
| 20 | 발송 요청 | 큐 상태 '발송 대기' |
| 21 | 같은 티켓에 또 발송 요청 | 차단 ("이미 발송 대기 중") |
| 22 | 에이전트 `send` 실행 | **아웃룩 창이 뜨고 자동 발송되지 않음** |
| 23 | 창에서 보내기 | 원본 메일 스레드에 회신으로 붙음 |

### 통계 (기획서 3.2)

| # | 확인 항목 | 기대 |
|---|---|---|
| 24 | 통계 화면 | 시스템별·등급별 현황, 리드타임, 14일 추이 |
| 25 | 완료 건이 없는 시스템 | **'자료 없음'** 으로 표기 (0 으로 처리하지 않음) |
| 26 | 티켓이 하나도 없을 때 | 안내 문구, 빈 차트가 아님 |

> 22번이 이 시스템의 가장 중요한 안전장치입니다. 발송은 되돌릴 수 없으므로
> 기본 설정에서 에이전트는 창만 띄우고 사람이 확인한 뒤에야 나갑니다.

---

## 11. 문제가 생겼을 때

| 증상 | 원인 | 조치 |
|---|---|---|
| **로그인 화면은 뜨는데 어떤 계정으로도 안 됨** | 계정을 아직 안 만들었음 (기본 계정 없음) | 4장으로 가서 계정을 만드세요 |
| `Supabase 에 연결하지 못했습니다` | `web/.env` 의 URL 이 예시값이거나 오타 | 5-1 의 실제 Project URL 로 교체 후 서버 재시작 |
| `Invalid login credentials` | 비밀번호 오타 또는 `Auto Confirm User` 미체크 | 계정 삭제 후 **Auto Confirm 체크하고** 재생성 |
| 로그인은 되는데 목록이 빈 화면 | `public.users` 행 없음 | `select * from public.users;` 확인. 없으면 계정 재생성 |
| `new row violates row-level security policy` | 권한 부족 또는 세션 만료 | 역할 확인 → 재로그인 → 그래도면 `schema.sql` 재실행 |
| 배포 페이지가 흰 화면 | `vite.config.ts` 의 `base` 와 저장소 이름 불일치 | `base` 수정 후 push |
| 배포 페이지 로그인 화면에 경고 배너 | Secrets 미등록 또는 등록 후 미배포 | 9-2 확인 후 **재배포** |
| `ticket-agent doctor` 에서 Outlook ❌ | Outlook 미실행 또는 폴더명 오타 | Outlook 을 켜고, 오류 메시지가 알려주는 폴더 목록과 대조 |
| 같은 메일이 계속 티켓이 됨 | `source_message_id` 유니크 제약 누락 | `schema.sql` 재실행 |
| 첨부 다운로드 시 오류 | 버킷 정책 누락 | `schema.sql` 12장 재실행 |
| 며칠 뒤 갑자기 전부 안 됨 | Free 플랜은 **7일간 요청이 없으면 일시정지** | 대시보드에서 **Restore** |

**로그 보는 곳**

- 에이전트: 콘솔 출력 (`LOG_LEVEL=DEBUG` 로 상세히)
- Supabase: 대시보드 → **Logs** → `API` / `Postgres`
- 웹: 개발자도구 → Console / Network

---

## 12. 운영

**비밀번호 재설정** — Authentication → Users → 해당 사용자 → Reset password.

**퇴사자** — `update public.users set is_active = false where email = '…';`
계정을 삭제하면 `on delete cascade` 로 그 사람의 코멘트 작성자 정보가 사라집니다.
**이력을 남기려면 삭제 대신 비활성화하세요.**

**LLM 프롬프트 조정** — `agent/src/ticket_agent/classifier.py` 의 `SYSTEM_PROMPT` 를 고칩니다.
분류 기준이 조직마다 다르므로 운영 첫 달에 한 번은 손보게 됩니다.

**코드값 추가** — 시스템 구분에 항목을 더하려면 **세 곳을 함께** 고쳐야 합니다:

1. `supabase/schema.sql` 의 check 제약 (`alter table … drop constraint … add constraint …`)
2. `agent/src/ticket_agent/constants.py`
3. `web/src/lib/constants.ts`

하나만 고치면 저장 시점에 실패합니다.

**무료 한도** — 팀 10명 · 하루 30건 기준으로 어느 쪽도 근처에 가지 않습니다.

| 항목 | Free 한도 | 예상 사용 |
|---|---|---|
| DB 용량 | 500MB | 연간 수십 MB |
| Storage | 1GB | 첨부 기준 연간 수백 MB |
| 월간 활성 사용자 | 50,000 | 10 |
| GitHub Pages | 월 100GB 전송 | 무시할 수준 |

---

## 부록. 명령어 요약

```bash
# 웹
cd web
npm install
npm run dev      # 개발 서버
npm test         # 순수 로직 단위 테스트 83개
npm run build    # 타입체크 + 프로덕션 빌드

# 에이전트
cd agent
pip install -e ".[dev]"
ticket-agent doctor    # 설정·연결 점검
ticket-agent collect   # 메일 1회 스캔
ticket-agent send      # 발송 큐 1회 처리
ticket-agent run       # 수집 + 발송 상시 실행
pytest -q              # 단위 테스트 103개
```
