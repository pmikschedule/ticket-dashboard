# 메일 기반 이슈 트래킹 시스템 (Email-to-Ticket) 기획서

## 1. 시스템 개요 및 목적
* **목적:** 아웃룩으로 접수되는 시스템 요구사항 및 장애 신고를 자동 수집·분류하여 티켓화하고, 처리 상태부터 라이프사이클 통계까지 관리하는 경량화된 이슈 트래킹 시스템 구축.
* **운영 환경 (하이브리드 아키텍처):**
    * **Local PC (Agent):** 관리자 PC(아웃룩 설치 환경)에서 무조건 실행되며, 메일 수집/LLM 분석/회신 발송 등 로컬 리소스 접근 역할을 전담.
    * **Supabase (Backend as a Service):** PostgreSQL DB, 사용자 인증(Auth), REST/Realtime API 제공.
    * **GitHub (Frontend):** React 기반의 웹 대시보드를 호스팅하여 관리자 및 개발팀원(David, John, Sandeep 등)이 접속 가능하도록 서비스.

## 2. 핵심 워크플로우 (프로세스)
1. **메일 수집 (Local PC):** 아웃룩의 특정 라벨/폴더로 이동되거나 특정 수신자로부터 온 메일을 Python 에이전트가 주기적으로 스캔.
2. **LLM 필터링 및 분류 (Local PC):** LLM API를 통해 일상 메일은 제외하고, 시스템 요구사항(오류/개선/수정/신규)만 필터링. 대상 시스템과 요청 기한을 추출.
3. **DB 적재 (Local ➔ Supabase):** 첨부파일(로컬 다운로드 후 Supabase Storage 업로드)과 추출된 데이터를 Supabase DB에 Insert.
4. **티켓 관리 (Web Dashboard):** 관리자 및 팀원이 웹에 접속하여 티켓 상태 변경(`대기 ➔ 분석 ➔ 진행 중 ➔ 테스트 ➔ 배포 ➔ 완료`) 및 코멘트 작성.
5. **피드백 발송 (Web ➔ Local PC):** 웹에서 티켓을 '완료' 처리하고 메일 발송을 요청하면, Local PC의 에이전트가 이를 감지하여 아웃룩을 통해 요약된 처리 내역 메일을 원본 요청자에게 발송.

## 3. 상세 기능 명세

### 3.1. Local PC 에이전트 (Python 기반 백그라운드 프로그램)
* **Outlook COM 연동 (`pywin32`):** 메일 본문, 메타데이터(수신일시, 발신자), 첨부파일 읽기 및 회신 메일 발송.
* **LLM 파이프라인:**
    * 1차: 시스템 요구사항 메일인지 T/F 판별.
    * 2차: T인 경우 ➔ 장애 등급(Critical, High, Medium, Low), 시스템 구분(ERP, 연동 API, 사내 웹/앱 등), 요청 기한 파악.
    * 예외 처리: 내용이 부실해도 반려하지 않고 '분석/할당' 상태로 Supabase에 적재.
* **Supabase 통신 (`supabase-py`):** DB 읽기/쓰기, Storage 첨부파일 업로드, 완료된 티켓 감지 및 발송 큐 처리.

### 3.2. 프론트엔드 대시보드 (React + Supabase Auth)
* **칸반 보드 & 리스트 뷰:**
    * 티켓 카드 노출 정보: 티켓 제목, 요청자명, 장애 등급, 시스템 구분, 최초 접수일, 요청 기한.
* **티켓 상세 페이지:**
    * 원본 메일 내용 확인 및 첨부파일 다운로드.
    * 상태값 파이프라인: `[접수 대기] ➔ [분석/할당] ➔ [진행 중] ➔ [테스트] ➔ [배포] ➔ [완료]`
    * 관리자 수동 내용 보완 및 내부 팀원 간 작업 내역(코멘트) 작성.
* **통계 대시보드:** 시스템별 접수 현황, 처리 리드타임(접수~완료 시간), 장애 등급별 통계 차트.
* **권한 관리:** 관리자(Admin)는 전체 통제 및 배정 권한, 팀원(Member)은 할당된 티켓 처리 및 코멘트 권한.

## 4. 데이터베이스 스키마 (Supabase PostgreSQL)

| 테이블명 | 주요 컬럼 | 설명 |
| :--- | :--- | :--- |
| **users** | `id`, `email`, `role`, `name` | Admin 및 팀원 (David, John, Sandeep 등) 계정 정보 |
| **tickets** | `id`, `subject`, `description`, `reporter_email`, `created_at`, `due_date` | 티켓 기본 정보 및 원본 메일 데이터 |
| **ticket_meta** | `ticket_id`, `category`, `severity`, `system_type`, `status`, `assignee_id` | LLM 추출 메타데이터 및 티켓 상태/담당자 |
| **comments** | `id`, `ticket_id`, `user_id`, `content`, `created_at` | 처리 내역 및 내부 협업 코멘트 |
| **attachments** | `id`, `ticket_id`, `file_name`, `file_url` | Supabase Storage 첨부파일 경로 |

## 5. Claude 개발 프롬프트 가이드 (순서도)

1. **DB & Auth 세팅:** "기획서의 4번 스키마를 바탕으로 Supabase SQL 테이블 생성 쿼리와 RLS(Row Level Security) 정책을 작성해 줘."
2. **로컬 Python 에이전트 (수집):** "`pywin32`와 `supabase-py`를 사용하여 아웃룩 특정 폴더 메일을 읽고, Claude API로 분류한 뒤 Supabase DB 적재 및 첨부파일을 Storage에 올리는 Python 코드를 작성해 줘."
3. **프론트엔드 (UI):** "React, TailwindCSS, Supabase JS 클라이언트를 사용해서 티켓 칸반 보드와 상세 페이지 컴포넌트를 만들어 줘."
4. **로컬 Python 에이전트 (발송):** "Supabase DB에서 특정 티켓이 '완료' 상태로 바뀌면 에이전트가 이를 감지(Realtime/Polling)하고 아웃룩으로 요약 회신 메일을 작성하여 발송 전 화면에 띄워주는(Display) 코드를 추가해 줘."
