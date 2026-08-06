# TaskBoard Lite v2 — 추가 개발계획서

> 작성일: 2026-08-04 | 선행 문서: 「TaskBoard Lite 경량 확정판 개발 기획서」
> 목적: 실제 운영 중인 「활동 월간 요약 보고서」를 도구가 **자동 생성**하도록 범위 확장
> 이 문서는 **델타 사양서**입니다. 선행 문서를 대체하지 않고 추가·변경분만 기술합니다.

---

## 1. 변경 배경

기존 설계는 개발 업무의 진척 관리만 다루었습니다. 그러나 실제 월간 보고서를 확인한 결과, 보고 산출물의 **절반이 운영·장애 영역**이었습니다.

| 실제 보고서 구성 요소 | 기존 설계로 생성 가능? |
|---|---|
| 헤더 (보고기간·작성자·보고일·조직) | ❌ 개념 없음 |
| MONTHLY SUMMARY 밴드 (안건 N건 / 장애 N건 / 중점) | ❌ 장애 데이터 없음 |
| 1. 개발 안건별 진행 현황 (안건·진행내용·상태·진척율·일정) | △ 진행내용·일정 표기 형식 불일치 |
| 2. 장애 발생 추이 (월별 추이·등급별·매우심각 목록) | ❌ **전면 부재** |
| 3. 주요 이슈 및 의사결정 필요 사항 | △ 이슈는 있으나 제목/의사결정 구분 없음 |
| 4. 차월 계획 | ❌ 개념 없음 |
| PPTX 1장 출력 | ❌ 엑셀만 지원 |

**결론: 운영·장애를 개발 업무와 동등한 관리 대상으로 승격시켜야 합니다.** 개발 안건 9건과 장애 8건이 나란히 보고되는 조직에서, 도구가 개발 안건만 다루면 매월 절반은 수작업으로 남습니다.

---

## 2. 추가되는 관리포인트

기존 5개 관리포인트에 **⑥ 운영 관리**를 추가합니다.

| | 무엇을 보는가 | 어떤 값이면 이상인가 | 이상이면 무엇을 하는가 |
|---|---|---|---|
| **⑥ 운영 관리** | 장애 발생 건수와 등급 | 아래 개입 규칙 참조 | 원인 분석 및 재발방지 대책 등록 |

**시점**: 장애 발생 즉시 등록, 매월 말 집계 · **주체**: 담당자 등록 → 팀장 확인

### 2.1 장애 등급 판정 기준

등급이 사람마다 달라지면 월별 추이가 의미를 잃습니다. 기준을 코드 상수로 고정합니다.

| 등급 | 판정 기준 | 예시 (07월 실적 기준) |
|---|---|---|
| **매우심각** | 서비스 전면 중단, 결제·주문·가입 실패, 개인정보 노출 위험, 정산·출고 데이터 오류 | 외국인 온라인 회원가입 500 오류 / 입금액·주문금액 불일치 미승인 / KOSSA DB 출고 데이터 오류 |
| **심각** | 일부 기능 불가하나 우회 수단 존재, 특정 채널·특정 회원군에 한정 | 특정 조회 화면 오류, 일부 채널 연동 지연 |
| **보통** | 화면 표시 오류, 경미한 데이터 불일치, 사용자 영향 제한적 | 라벨 오표기, 정렬 오류 |

### 2.2 장애 개입 규칙

| 조건 | 조치 | 주체 |
|---|---|---|
| 매우심각 발생 | 24시간 내 원인·조치 등록, 재발방지 대책 필수 입력 | 담당자 → 팀장 확인 |
| 동일 원인 유형 3회 이상 | 근본원인 분석 안건을 개발 태스크로 등록 | 팀장 |
| 월 매우심각 5건 초과 | 월간보고에 원인 분석 별도 기술 | 팀장 |
| 등록 후 7일 경과 미조치 | 팀장 보고 및 우선순위 재조정 | 팀장 |

---

## 3. 데이터 모델 변경

### 3.1 기존 테이블 확장

```sql
-- 개발 안건(tasks) 확장
alter table tasks add column progress_note   text;                    -- 주요 진행 내용(결과), 2줄 이내
alter table tasks add column stage           text default 'dev';      -- dev | 적용 | 운영적용 | 배포
alter table tasks add column initial_due_date date;                   -- 최초 마감일 (일정 변경 표기용)
alter table tasks add column is_agenda       boolean default true;    -- 월간보고 '개발 안건'에 포함 여부

-- 최초 마감일 백필 (기존 데이터)
update tasks set initial_due_date = due_date where initial_due_date is null;

-- 이슈 확장
alter table issues add column title          text;                    -- 굵은 제목 (예: 스마트로 키인 결제)
alter table issues add column needs_decision boolean default false;   -- 의사결정 필요 사항 여부
alter table issues add column sort_order     int default 0;
```

> `is_agenda`를 둔 이유: 정기점검·사용자지원처럼 상시 반복되는 업무까지 월간보고 안건 표에 올리면 표가 30행이 됩니다. 보고 대상 안건은 담당자가 등록 시 체크로 구분합니다(기본값 포함).

### 3.2 신규 테이블

```sql
-- 장애
create table incidents (
  id serial primary key,
  occurred_at    date not null,
  title          text not null,
  system         text not null,              -- WEB | POVAS | 공통
  severity       text not null,              -- critical | major | normal
  cause_type     text,                       -- 코드결함 | 데이터 | 인프라 | 외부연동 | 운영실수 | 기타
  action         text,                       -- 조치 내용
  status         text default 'responding',  -- responding | resolved
  recurrence_action text,                    -- 재발방지 대책
  related_task_id   int references tasks(id),
  reporter_id    uuid references profiles(id),
  resolved_at    timestamptz,
  created_at     timestamptz default now()
);
create index idx_incidents_month on incidents (occurred_at);

-- 월간보고 (수동 입력분만 저장, 나머지는 집계)
create table monthly_reports (
  id serial primary key,
  year_month   text unique not null,          -- '2026-07'
  org_name     text default 'WEB / POVAS 운영·개발',
  author_name  text,
  report_date  date,
  highlight    text,                          -- MONTHLY SUMMARY 중점 문구
  footnote     text default '데이터 출처 : 월말 Error 리포트 · 개발 진행현황 기준일',
  base_date    date,                          -- 개발 진행현황 기준일
  confirmed_at timestamptz
);

-- 차월 계획 (자동 추출분 외 수동 추가)
create table next_month_plans (
  id serial primary key,
  year_month text not null,                   -- 계획이 실행될 달 '2026-08'
  content    text not null,
  sort_order int default 0
);
```

**RLS는 기존과 동일 패턴** — 읽기·쓰기 전원, 삭제만 admin. 3개 테이블 모두 동일하게 적용합니다.

### 3.3 상수 추가

```ts
// src/lib/constants.ts
export const SYSTEMS  = ['WEB', 'POVAS', '공통'] as const;
export const SEVERITY = {
  critical: { label: '매우심각', color: 'C0392B', bg: 'FDE8E8' },
  major:    { label: '심각',     color: 'B7791F', bg: 'FDF6E3' },
  normal:   { label: '보통',     color: '1E7A5A', bg: 'E4F5EE' },
} as const;
export const CAUSE_TYPES = ['코드결함', '데이터', '인프라', '외부연동', '운영실수', '기타'] as const;
export const STAGES = ['dev', '적용', '운영적용', '배포'] as const;
```

---

## 4. 입력 부담 관리 (30초 원칙 유지)

새 필드가 늘었다고 등록 폼에 필드를 추가하면 v1의 30초 설계가 무너집니다. **등록 시점과 갱신 시점을 분리합니다.**

| 필드 | 입력 시점 | 이유 |
|---|---|---|
| `stage` | 등록 시 (칩 1탭, 기본 `dev`) | 선택지 4개, 탭 1회 |
| `is_agenda` | 등록 시 (기본 체크됨) | 해제할 때만 조작 |
| `progress_note` | **주간보고 작성 시** | 매주 한 번, 이미 회고하는 시점 |
| `initial_due_date` | 자동 (최초 저장 시 `due_date` 복사) | 입력 없음 |
| `recurrence_action` | 장애 조치 완료 시 | 발생 시점엔 원인 미상 |

**등록 폼에 보이는 입력은 여전히 4개입니다**: 업무명 · 카테고리 · 마감일 · 단계(stage).

### 4.1 장애 등록 폼 (목표 20초)

장애는 발생 직후 경황이 없을 때 기록하므로 더 짧아야 합니다.

```
┌─ 장애 등록 ──────────────────────────── Esc ─┐
│  [ 외국인 온라인 회원가입 500 오류_________ ] │ ← 자동 포커스
│  시스템   ● WEB   ○ POVAS   ○ 공통           │
│  등급     ● 매우심각  ○ 심각  ○ 보통         │
│  발생일   ● 오늘(8/4)  ○ 어제  [ 직접 📅 ]   │
│  ▸ 원인유형·조치내용 (나중에 입력 가능)      │
│              [ 저장 후 계속 ]   [ 저장 ⏎ ]   │
└──────────────────────────────────────────────┘
```

원인유형·조치내용·재발방지는 접힌 영역이며, **미입력 상태로 저장 가능**합니다. 매우심각 등급만 24시간 내 조치 입력을 화면 배너로 독촉합니다.

---

## 5. 화면 변경

| 라우트 | 화면 | 상태 |
|---|---|---|
| `#/` | 내 업무 | 기존 (stage 칩 추가) |
| `#/team` | 팀 현황 | 기존 |
| `#/weekly` | 주간보고 | **변경** — `progress_note` 입력란 추가 |
| `#/report` | 리포트 (엑셀) | **변경** — 장애 시트 추가 |
| **`#/incidents`** | **장애 관리** | **신규** |
| **`#/monthly`** | **월간보고** | **신규** |

### 5.1 `#/incidents` 장애 관리

- 상단: 당월 등급별 건수 3개 카드, 전월 대비 증감
- 목록: 발생일 내림차순, 미조치 건 상단 고정, 경과일 표시
- 필터: 월 · 시스템 · 등급 · 상태
- 우측: 최근 7개월 월별 추이 미니 차트
- 매우심각 미조치 24시간 초과 건은 행 강조

### 5.2 `#/monthly` 월간보고

3단 구성입니다.

1. **집계 결과 미리보기** — 아래 6장의 매핑 규칙대로 자동 생성된 내용을 화면에 그대로 표시
2. **수동 입력 4개** — 중점 문구(highlight), 작성자, 보고일, 기준일
3. **의사결정 사항 / 차월 계획 편집** — 자동 추출분 확인 후 가감
4. **출력** — `PPTX 다운로드` / `엑셀 다운로드`

---

## 6. 월간보고 자동 생성 매핑 (핵심 사양)

보고서의 모든 칸이 어느 데이터에서 나오는지를 고정합니다. **이 표가 v2 개발의 기준 문서입니다.**

| 보고서 영역 | 데이터 출처 | 산출 규칙 |
|---|---|---|
| 보고기간 | `year_month` | 해당 월 1일 ~ 말일, `YYYY.MM.DD ~ MM.DD` |
| 작성자 / 보고일 | `monthly_reports` | 수동 입력 |
| 조직명 | `monthly_reports.org_name` | 기본값 사용 |
| SUMMARY — 개발 안건 | `tasks` where `is_agenda` 이고 당월 활동분 | `N건 (완료 n · 진행 n · 지연 n)` |
| SUMMARY — 장애 | `incidents` 당월 | `N건 (전월 N건 대비 △/▲n)` |
| SUMMARY — 중점 | `monthly_reports.highlight` | 수동 입력 |
| **1. 안건명** | `tasks.name` | 그대로 |
| **1. 주요 진행 내용** | `tasks.progress_note` | 최대 2줄, 초과 시 말줄임 |
| **1. 상태** | 자동 판정 (6.1) | 완료 / 진행중 / 지연 |
| **1. 진척율** | 완료 체크포인트 ÷ 전체 | 정수 % + 진행바 |
| **1. 일정** | `stage` + 날짜 (6.2) | `7/29 운영 적용`, `7/13 → 8/6 dev` |
| **2. 월별 추이** | `incidents` 최근 7개월 | 월별 count, 당월만 강조색 |
| **2. 등급별 건수** | `incidents` 당월 group by severity | 매우심각/심각/보통 |
| **2. 전월 대비** | 당월 − 전월 | `전월 N건 대비 △n건` |
| **2. 매우심각 목록** | `incidents` 당월 critical | `제목 (시스템)`, 최대 6건 |
| **3. 의사결정 사항** | `issues` where `needs_decision` and 미해소 | 제목(굵게) + 내용, 최대 4건 |
| **4. 차월 계획** | 차월 마감 `tasks` + `next_month_plans` | 최대 6건 |
| 각주 | `monthly_reports.footnote` + `base_date` | |

### 6.1 상태 자동 판정

```
완료   : status = 'done'
지연   : status ≠ 'done' AND (오늘 > due_date  OR  실적진척률 − 계획진척률 < -20%p)
진행중 : 그 외
```

> 07월 실적의 「규정 위반 회원 신고」는 진척율 0%이지만 마감일이 7/31로 남아 있어 **진행중**, 「스마트로 단말기 키인」은 7/13이 지나 **지연**으로 판정됩니다. 위 규칙이 실제 보고서와 일치하는지 확인된 사례입니다.

### 6.2 일정 표기 규칙

```
initial_due_date == due_date  →  "M/D {stage}"          예: 7/29 운영 적용
initial_due_date != due_date  →  "M/D → M/D {stage}"    예: 7/13 → 8/6 dev
```

일정이 밀린 사실이 보고서에 자동으로 드러납니다. 별도로 적을 필요가 없고, 숨길 수도 없습니다.

---

## 7. PPTX 출력 사양

### 7.1 라이브러리

브라우저에서 직접 생성합니다. 서버 불필요.

```bash
npm install pptxgenjs
```
```ts
import pptxgen from 'pptxgenjs';
```

### 7.2 캔버스

- **1 슬라이드**, 16:9 (`LAYOUT_16x9` 아님에 주의 — `pres.defineLayout` 으로 13.333 × 7.5 인치 지정)
- 파일명: `활동_월간요약보고서_YYYY-MM.pptx`
- 폰트: `맑은 고딕`

```ts
pres.defineLayout({ name: 'A4WIDE', width: 13.333, height: 7.5 });
pres.layout = 'A4WIDE';
```

### 7.3 색상

```ts
const NAVY='1F3864', NAVY_L='2E4A7D', ICE_L='EAF1FA', LINE='D6DEEA',
      TXT='222222', MUT='7A8699',
      OK_BG='D9F2E6', OK_TX='1E7A5A',       // 완료
      ING_BG='1F3864', ING_TX='FFFFFF',     // 진행중
      DLY_BG='FBE0E0', DLY_TX='C0392B',     // 지연
      BAR='2E7D5B',                          // 진척 바
      SEV1='C0392B', SEV1_BG='FDECEC',
      SEV2='B7791F', SEV2_BG='FDF6E3',
      SEV3='1E7A5A', SEV3_BG='E4F5EE';
```

### 7.4 레이아웃 좌표 (인치)

| 영역 | x | y | w | h |
|---|---|---|---|---|
| 제목 「활동 월간 요약 보고서」 32pt bold NAVY | 0.40 | 0.18 | 6.5 | 0.55 |
| 조직명 12pt MUT | 0.42 | 0.72 | 5.0 | 0.28 |
| 메타 박스 (테두리 LINE) | 8.30 | 0.16 | 4.60 | 0.62 |
| └ 보고기간 / 작성자 / 보고일 10.5pt | 8.45 | 0.22 | 4.3 | 0.5 |
| SUMMARY 밴드 (ICE_L, roundRect) | 0.42 | 0.90 | 12.45 | 0.45 |
| 섹션1 헤더 「1. 개발 안건별 진행 현황」 14pt bold | 0.50 | 1.40 | 5.0 | 0.32 |
| 섹션1 표 | 0.42 | 1.78 | 8.06 | 가변 |
| 섹션2 헤더 「2. 장애 발생 추이」 | 8.78 | 1.40 | 4.0 | 0.32 |
| 섹션2 박스 (테두리 LINE) | 8.70 | 1.78 | 4.20 | 3.55 |
| └ 월별 추이 차트 | 8.85 | 2.15 | 3.90 | 1.55 |
| └ 등급 카드 3개 | 8.85 | 3.85 | 각 1.24 | 0.62 |
| └ 매우심각 목록 | 8.85 | 4.62 | 3.90 | 0.90 |
| 섹션3 헤더 「3. 주요 이슈 및 의사결정 필요 사항」 | 0.50 | 5.55 | 6.0 | 0.32 |
| 섹션3 박스 (ICE_L 아주 옅게 / F7F9FC) | 0.42 | 5.92 | 8.06 | 1.15 |
| 섹션4 헤더 「4. 차월(M월) 계획」 | 8.78 | 5.55 | 4.0 | 0.32 |
| 섹션4 박스 | 8.70 | 5.92 | 4.20 | 1.15 |
| 각주 9pt MUT | 0.42 | 7.14 | 9.0 | 0.25 |
| 우하단 조직 서명 9pt MUT (우측 정렬) | 10.5 | 7.14 | 2.4 | 0.25 |

### 7.5 섹션 1 표 사양

```
열: 안건(1.85) | 주요 진행 내용(3.30) | 상태(0.90) | 진척율(0.95) | 일정(1.06)
헤더: fill NAVY, 색 흰색, 11pt bold, 높이 0.34
본문: 10pt, 행 높이 0.44 (2줄 내용이면 0.52)
안건명: bold, TXT
진행 내용: 9.5pt, MUT
상태: roundRect 배지 (완료/진행중/지연 색상), 중앙 정렬
진척율: 상단에 "100%" 10pt bold, 하단에 진행 바 (배경 EEEEEE / 채움 BAR, 높이 0.06)
일정: 10pt, 중앙 정렬
행 구분선: LINE 0.75pt 하단
```

**행 수가 많을 때**: 안건이 12건을 넘으면 표 행 높이를 0.38로 축소하고, 15건 초과 시 진척율 상위 순으로 15건만 표기하며 각주에 `외 n건`을 추가합니다.

### 7.6 섹션 2 차트

```ts
slide.addChart(pres.ChartType.bar, [{
  name: '장애 건수', labels: ['1월',...,'7월'], values: [14,8,12,14,9,8,8]
}], {
  x: 8.85, y: 2.15, w: 3.90, h: 1.55,
  barDir: 'col', chartColors: ['B9C6DC'],
  showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 9,
  showLegend: false, valAxisHidden: true,
  catAxisLabelFontFace: '맑은 고딕', catAxisLabelFontSize: 9,
  catGridLine: { style: 'none' }, valGridLine: { style: 'none' }
});
```

> 당월 막대만 NAVY로 강조하려면 `chartColors` 배열에 7개 색을 넣고 마지막만 NAVY로 지정합니다. pptxgenjs는 단일 시리즈에서 색 배열을 데이터포인트별로 적용합니다.

### 7.7 등급 카드 3개

각 카드: `roundRect`, 테두리 = 등급 색, 배경 = 등급 배경색, 상단에 등급명 10pt bold(등급 색), 하단에 `N건` 15pt bold.

### 7.8 엑셀 출력도 함께 갱신

기존 4개 시트에 **시트 5 「장애」** 를 추가합니다.
`발생일 | 제목 | 시스템 | 등급 | 원인유형 | 조치 내용 | 상태 | 재발방지 대책 | 경과일`
등급 열은 배경색을 적용합니다 (매우심각 `FDECEC` / 심각 `FDF6E3` / 보통 `E4F5EE`).

---

## 8. Claude Code 실행 계획 (Step 7~11 추가)

기존 Step 1~6 완료를 전제로 이어서 진행합니다.

**Step 7 — 데이터 모델 확장**
```
docs/SPEC-V2.md 3장의 SQL을 supabase/schema-v2.sql 로 작성해줘.
기존 테이블 alter, 신규 테이블 3개(incidents, monthly_reports, next_month_plans),
RLS 정책은 기존 테이블과 동일 패턴(읽기·쓰기 전원, 삭제는 admin만)으로 적용.
initial_due_date 백필 UPDATE 문도 포함해줘.
그리고 src/lib/constants.ts 에 SYSTEMS / SEVERITY / CAUSE_TYPES / STAGES 상수를 추가하고,
src/lib/api.ts 에 장애·월간보고 관련 함수를 추가해줘.
컴포넌트에서 supabase 직접 호출 금지 원칙은 그대로야.
```

**Step 8 — 장애 관리 화면**
```
'#/incidents' 화면을 구현해줘.
- 등록 폼은 SPEC-V2.md 4.1 대로. 보이는 입력은 제목·시스템·등급·발생일 4개뿐이고
  원인유형·조치내용·재발방지는 접힌 영역. 미입력 저장 가능. 목표 20초.
- 상단에 당월 등급별 건수 3개 카드 + 전월 대비 증감
- 목록은 발생일 내림차순, 미조치 건 상단 고정, 경과일 표시
- 매우심각인데 24시간 내 조치 미입력 건은 행 강조
- 우측에 최근 7개월 월별 추이 미니 차트
- 필터: 월·시스템·등급·상태
```

**Step 9 — 업무·주간보고 확장**
```
tasks 확장 필드를 화면에 반영해줘.
- 등록 폼에 stage 칩(dev/적용/운영적용/배포, 기본 dev) 추가. 필드 개수는 4개를 넘기지 마.
- is_agenda 는 접힌 영역에 체크박스(기본 체크)
- 최초 저장 시 initial_due_date 에 due_date 를 복사
- 주간보고 화면에 업무별 progress_note 입력란 추가 (2줄 제한)
- 이슈 등록에 title 과 '의사결정 필요' 체크박스 추가
```

**Step 10 — 월간보고 집계 + 화면**
```
src/lib/monthly.ts 를 순수 함수로 작성해줘.
SPEC-V2.md 6장 매핑표의 모든 항목을 집계하는 buildMonthlyReport(yearMonth, data) 함수와
상태 판정(6.1), 일정 표기(6.2) 함수를 포함하고 vitest 단위 테스트도 작성해줘.
특히 다음 케이스를 테스트에 반드시 넣어줘:
- 진척 0% + 마감일 미도래 → '진행중'
- 진척 0% + 마감일 경과 → '지연'
- initial_due_date != due_date → "7/13 → 8/6 dev" 형식

이어서 '#/monthly' 화면을 구현해줘. 집계 결과 미리보기, 수동 입력 4개(중점·작성자·보고일·기준일),
의사결정 사항과 차월 계획 편집, 하단에 PPTX/엑셀 다운로드 버튼.
```

**Step 11 — PPTX 출력**
```
npm install pptxgenjs 후 src/lib/exportPptx.ts 를 작성해줘.
SPEC-V2.md 7장의 좌표·색상·표 사양을 그대로 따라 1슬라이드 보고서를 생성해줘.
- pres.defineLayout 으로 13.333 x 7.5 인치 지정
- 색상 hex 에 '#' 붙이지 말 것, 8자리 hex 금지
- 옵션 객체를 여러 addText 에 재사용하지 말고 매번 새로 만들 것
- 안건 12건 초과 시 행 높이 축소, 15건 초과 시 15건만 표기하고 각주에 '외 n건'
- 파일명은 활동_월간요약보고서_YYYY-MM.pptx
엑셀 리포트에는 '장애' 시트를 추가해줘 (SPEC-V2.md 7.8).
```

---

## 9. CLAUDE.md 추가 규칙

```markdown
## v2 추가 규칙
- 장애(incidents)는 업무(tasks)와 별개 엔티티다. 장애를 태스크로 등록하지 않는다.
- 장애 등급 판정 기준은 constants.ts 에 고정. 화면에서 임의 등급을 추가하지 않는다.
- 업무 등록 폼에 보이는 입력은 4개(업무명·카테고리·마감일·단계)를 넘기지 않는다.
  새 필드는 주간보고 또는 상세 화면으로 보낸다.
- progress_note 는 등록 시 입력받지 않는다. 주간보고 작성 시에만 입력한다.
- initial_due_date 는 사용자가 수정할 수 없다. 최초 저장 시 자동 설정.
- 월간보고의 모든 수치는 src/lib/monthly.ts 순수 함수를 거친다. 화면에서 직접 집계 금지.
- PPTX 생성은 클라이언트 pptxgenjs. 서버 호출 없음.
- PPTX 색상 hex 에 '#' 을 붙이면 파일이 깨진다. 8자리 hex도 금지.
```

---

## 10. 검증 체크리스트 (v2 추가분)

| # | 항목 |
|---|---|
| 1 | 장애 1건 등록 실측 20초 이내 |
| 2 | 원인유형·조치 미입력 상태로 장애 저장 가능 |
| 3 | 매우심각 24시간 미조치 건이 목록에서 강조됨 |
| 4 | 업무 등록 폼의 보이는 입력이 여전히 4개 |
| 5 | 마감일 변경 후 월간보고 일정 칸이 `7/13 → 8/6 dev` 형식으로 표기 |
| 6 | 진척 0% + 마감 미도래 → 진행중, 마감 경과 → 지연으로 판정 |
| 7 | SUMMARY 밴드의 장애 전월 대비 증감이 실제 데이터와 일치 |
| 8 | 월별 추이 차트가 최근 7개월을 표시하고 당월이 강조됨 |
| 9 | PPTX 파일이 PowerPoint에서 정상 열림 (손상 경고 없음) |
| 10 | 안건 15건 초과 시 표가 슬라이드를 넘치지 않음 |
| 11 | **생성된 PPTX를 2026-07 실제 보고서와 나란히 놓고 육안 비교 — 누락 항목 없음** |
| 12 | 엑셀에 장애 시트가 추가되고 등급 열에 배경색 적용 |

> 11번이 v2의 최종 합격 기준입니다. 07월 데이터를 그대로 입력해 생성한 PPTX가 기존 수작업 보고서와 같은 내용을 담고 있으면 이관 가능합니다.

---

## 11. 일정 영향

| 단계 | 소요 |
|---|---|
| Step 7 (데이터 모델) | 0.3일 |
| Step 8 (장애 관리) | 0.5일 |
| Step 9 (업무·주간보고 확장) | 0.3일 |
| Step 10 (월간보고 집계·화면) | 0.7일 |
| Step 11 (PPTX·엑셀 출력) | 0.7일 |
| 07월 데이터 역입력 및 대조 검증 | 0.5일 |
| **합계** | **약 3일** |

v1(1.5일)과 합산하여 **총 4.5일**입니다. 월간보고 수작업이 매월 수 시간 소요된다면 2~3개월 내 회수됩니다.

---

## 12. 이관 계획 (권고)

새 도구로 갑자기 넘어가면 첫 달 보고가 비는 위험이 있습니다.

| 시점 | 조치 |
|---|---|
| 1개월차 | 도구로 생성 + 기존 수작업 병행. 두 보고서를 대조하여 누락 항목 보완 |
| 2개월차 | 도구 생성본을 정본으로 사용, 수작업은 검토만 |
| 3개월차 | 수작업 중단 |

병행 기간에 발견되는 차이가 곧 사양 누락분입니다. 이 기간을 건너뛰면 3개월쯤 뒤 "이 항목이 왜 빠졌지"를 매달 반복하게 됩니다.
