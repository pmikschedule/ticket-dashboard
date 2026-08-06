-- ============================================================================
-- 데모용 샘플 티켓
--
-- 에이전트를 설치하기 전에 대시보드 화면(칸반·상세·통계)이 제대로 도는지
-- 확인하기 위한 것입니다. **운영 데이터가 아닙니다.**
--
-- · 여러 번 실행해도 중복되지 않습니다 (source_message_id 유일 제약 + on conflict)
-- · 맨 아래 정리 구문 한 줄로 흔적 없이 지울 수 있습니다
-- · 날짜는 실행 시점 기준 상대값이라 언제 돌려도 "최근 접수"로 보입니다
-- ============================================================================

-- ── 티켓 6건 ────────────────────────────────────────────────────────────────
insert into public.tickets
  (subject, description, reporter_email, reporter_name, received_at, due_date, source_message_id, source_folder)
values
  ('ERP 전표 승인 화면에서 저장이 안 됨',
   E'안녕하세요, 회계팀 김영희입니다.\n\n오늘 오전 8시 40분경부터 ERP 전표 승인 화면에서 저장 버튼을 누르면\n''처리 중 오류가 발생했습니다'' 라는 메시지만 뜨고 저장이 되지 않습니다.\n회계팀 6명 전원 동일 증상이며, 월 마감이 오늘까지라 급합니다.\n\n확인 부탁드립니다.',
   'kim.younghee@example.co.kr', '김영희', now() - interval '6 hours', current_date, 'demo-001', '받은 편지함/요청'),

  ('물류 연동 API 응답 지연 개선 요청',
   E'물류팀 이지훈입니다.\n\n출고 조회 API 응답이 평소 1초 내외였는데 최근 5~8초까지 늘어났습니다.\n업무는 진행 가능하지만 하루 200건 조회 시 체감 지연이 큽니다.\n검토 부탁드립니다.',
   'lee.jihoon@example.co.kr', '이지훈', now() - interval '2 days', current_date + 14, 'demo-002', '받은 편지함/요청'),

  ('신규 입사자 그룹웨어 계정 생성 (3명)',
   E'8월 입사 예정 3명의 그룹웨어 및 VPN 계정 생성 요청드립니다.\n\n- 정수연 / 마케팅팀\n- 최도현 / 개발팀\n- 한소미 / 영업팀\n\n입사일 전날까지 준비 부탁드립니다.',
   'hr@example.co.kr', '인사팀', now() - interval '3 days', current_date + 4, 'demo-003', '받은 편지함/요청'),

  ('영업 실적 대시보드 월별 필터 추가 요청',
   E'영업지원팀입니다.\n현재 대시보드가 분기 단위로만 조회되는데 월별로도 볼 수 있으면 좋겠습니다.\n급한 건은 아닙니다.',
   'sales.support@example.co.kr', '영업지원팀', now() - interval '5 days', null, 'demo-004', '받은 편지함/요청'),

  ('사내 위키 첨부파일 업로드 실패',
   E'2MB 이상 파일을 올리면 진행률 100%에서 멈추고 오류가 납니다.\n작은 파일은 정상입니다.',
   'park.minsu@example.co.kr', '박민수', now() - interval '8 days', current_date - 2, 'demo-005', '받은 편지함/요청'),

  ('급여명세서 PDF 다운로드 오류 (해결됨)',
   E'인사팀입니다. 급여명세서 PDF 다운로드 시 빈 파일이 받아집니다.\n전 직원 대상이라 급합니다.',
   'hr@example.co.kr', '인사팀', now() - interval '10 days', current_date - 7, 'demo-006', '받은 편지함/요청')
on conflict (source_message_id) do nothing;

-- ── 메타데이터 (상태·등급·시스템) ───────────────────────────────────────────
-- 칸반 6개 열에 골고루 퍼지도록, 통계에 의미가 생기도록 배치했습니다.
insert into public.ticket_meta
  (ticket_id, category, severity, system_type, status, assignee_id, llm_model, llm_confidence, llm_reason, completed_at)
select t.id, v.category, v.severity, v.system_type, v.status,
       case when v.assign then (select id from public.users where role = 'admin' order by created_at limit 1) end,
       'claude-opus-5', v.confidence, v.reason, v.completed_at
from public.tickets t
join (values
  ('demo-001', 'error',   'critical', 'erp',     'in_progress', true,  0.96, '저장 실패 증상과 전원 재현이 명시됨. 월 마감 임박으로 영향도 큼', null::timestamptz),
  ('demo-002', 'improve', 'medium',   'api',     'triage',      true,  0.88, '응답 지연 개선 요청. 우회 가능하여 보통 등급', null),
  ('demo-003', 'new',     'low',      'infra',   'intake',      false, 0.92, '계정 생성 요청. 정형 업무', null),
  ('demo-004', 'improve', 'low',      'web_app', 'intake',      false, 0.85, '기능 개선 제안. 급하지 않다고 본문에 명시', null),
  ('demo-005', 'error',   'high',     'web_app', 'testing',     true,  0.91, '특정 크기 이상 업로드 실패. 우회 수단 없음', null),
  ('demo-006', 'error',   'critical', 'erp',     'done',        true,  0.94, '전 직원 대상 다운로드 실패', now() - interval '9 days')
) as v(msg, category, severity, system_type, status, assign, confidence, reason, completed_at)
  on v.msg = t.source_message_id
on conflict (ticket_id) do nothing;

-- ── 처리 내역 코멘트 ────────────────────────────────────────────────────────
insert into public.comments (ticket_id, user_id, content, created_at)
select t.id,
       (select id from public.users where role = 'admin' order by created_at limit 1),
       v.content,
       now() - v.ago
from public.tickets t
join (values
  ('demo-001', '로그 확인 결과 승인 트랜잭션에서 타임아웃 발생. DB 커넥션 풀 확인 중입니다.', interval '4 hours'),
  ('demo-001', '커넥션 풀 고갈 확인. 임시로 풀 크기를 늘려 조치했고 근본 원인 분석 중입니다.', interval '2 hours'),
  ('demo-005', '업로드 크기 제한 설정값이 2MB로 잡혀 있었습니다. 10MB로 상향 후 테스트 중입니다.', interval '1 day'),
  ('demo-006', '리포트 서버의 폰트 패키지 누락이 원인이었습니다. 설치 후 정상 생성 확인했습니다.', interval '9 days'),
  ('demo-006', '요청자 확인 완료. 종결합니다.', interval '9 days')
) as v(msg, content, ago) on v.msg = t.source_message_id
where not exists (
  select 1 from public.comments c where c.ticket_id = t.id and c.content = v.content
);

-- ── 확인 ────────────────────────────────────────────────────────────────────
select m.status, count(*) as 건수
from public.ticket_meta m
join public.tickets t on t.id = m.ticket_id
where t.source_message_id like 'demo-%'
group by m.status
order by m.status;

-- ============================================================================
-- 정리 — 샘플을 지울 때 이 한 줄만 실행하세요.
-- ticket_meta / comments / attachments / history 는 on delete cascade 로 함께 지워집니다.
-- ============================================================================
-- delete from public.tickets where source_message_id like 'demo-%';
