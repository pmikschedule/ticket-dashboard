-- ============================================================================
-- 메일 기반 이슈 트래킹 시스템 (Email-to-Ticket)
-- Supabase PostgreSQL 스키마 + RLS 정책
--
-- 기준 문서: docs/SPEC-EMAIL-TICKET.md 4장
-- 설계 결정: docs/DESIGN.md
--
-- 이 스크립트는 몇 번을 다시 실행해도 안전합니다 (idempotent).
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. 확장
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. 코드값 (docs/DESIGN.md 1장)
--    enum 타입 대신 check 제약을 씁니다. 값을 추가할 때 마이그레이션이 가볍습니다.
-- ----------------------------------------------------------------------------
-- role        : admin | member
-- status      : intake | triage | in_progress | testing | deploy | done  (라이프사이클 6단계)
-- work_type   : incident | maintenance | development                      (대분류. 15.2 참조)
-- severity    : critical | high | medium | low
-- category    : error | improve | fix | new                               (중분류)
-- system_type : public.systems 등록표를 따릅니다 (고정 목록 아님. 15.1 참조)

-- ----------------------------------------------------------------------------
-- 2. users — Admin 및 팀원 계정 정보
--    auth.users 를 그대로 참조합니다. 인증은 Supabase Auth, 역할은 이 테이블.
-- ----------------------------------------------------------------------------
create table if not exists public.users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  name       text not null default '',
  role       text not null default 'member' check (role in ('admin', 'member')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table  public.users is 'Admin 및 팀원 계정. auth.users 와 1:1';
comment on column public.users.is_active is '퇴사자는 삭제하지 않고 false 로 둡니다. 코멘트 이력이 보존됩니다';

-- 가입 시 users 행 자동 생성 (기본 역할 member)
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 기존 계정 백필.
-- 위 트리거는 INSERT 에만 걸리므로, 이 스키마를 적용하기 **전에** 만들어진 계정은
-- users 행이 없습니다. 그러면 로그인은 되는데 앱이 사용자를 못 찾아
-- 로그인 화면으로 되돌아옵니다. 다른 앱이 쓰던 Supabase 프로젝트에
-- 이 스키마를 얹을 때 반드시 밟는 경로입니다.
insert into public.users (id, email, name)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data ->> 'name', split_part(coalesce(u.email, ''), '@', 1))
from auth.users u
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 3. tickets — 티켓 기본 정보 및 원본 메일 데이터
-- ----------------------------------------------------------------------------
create table if not exists public.tickets (
  id                bigserial primary key,
  subject           text not null,
  description       text not null default '',          -- 원본 메일 본문 (평문)
  body_html         text,                              -- 원본 메일 본문 (HTML, 있으면)
  reporter_email    text not null,
  reporter_name     text,
  received_at       timestamptz not null default now(),-- 메일 수신일시 = 최초 접수일
  due_date          date,                              -- LLM 이 추출한 요청 기한
  source_message_id text unique,                       -- Outlook EntryID. 중복 적재 차단
  source_folder     text,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.users(id),  -- 수동 생성 시 작성자. 에이전트는 null
  updated_at        timestamptz not null default now()
);

comment on column public.tickets.source_message_id is
  '아웃룩 EntryID. 주기 스캔이 같은 메일을 다시 읽어도 티켓이 복제되지 않도록 하는 유일 제약';
comment on column public.tickets.received_at is
  '메일 수신일시. 화면의 "최초 접수일". created_at(에이전트 적재 시각)과 다릅니다';

create index if not exists idx_tickets_received_at on public.tickets (received_at desc);
create index if not exists idx_tickets_reporter    on public.tickets (reporter_email);

-- ----------------------------------------------------------------------------
-- 4. ticket_meta — LLM 추출 메타데이터 및 티켓 상태/담당자
--    tickets 와 1:1. ticket_id 가 곧 PK 입니다.
-- ----------------------------------------------------------------------------
create table if not exists public.ticket_meta (
  ticket_id      bigint primary key references public.tickets(id) on delete cascade,
  category       text not null default 'error'  check (category    in ('error','improve','fix','new')),
  severity       text not null default 'medium' check (severity    in ('critical','high','medium','low')),
  system_type    text not null default 'etc'    check (system_type in ('erp','api','web_app','infra','etc')),
  status         text not null default 'intake' check (status      in ('intake','triage','in_progress','testing','deploy','done')),
  assignee_id    uuid references public.users(id) on delete set null,

  -- LLM 판별 근거 (사람이 결과를 의심할 때 확인용)
  llm_model      text,
  llm_confidence numeric(3,2) check (llm_confidence is null or (llm_confidence >= 0 and llm_confidence <= 1)),
  llm_reason     text,
  llm_error      text,                                 -- 분류 실패 사유. 있어도 티켓은 적재됩니다

  completed_at   timestamptz,                          -- status 가 done 이 된 시각
  updated_at     timestamptz not null default now()
);

comment on column public.ticket_meta.llm_error is
  '분류 실패 사유. 기획서 3.1 예외 처리 - 실패해도 반려하지 않고 triage 상태로 적재합니다';

create index if not exists idx_meta_status   on public.ticket_meta (status);
create index if not exists idx_meta_assignee on public.ticket_meta (assignee_id);
create index if not exists idx_meta_severity on public.ticket_meta (severity);

-- ----------------------------------------------------------------------------
-- 5. ticket_status_history — 라이프사이클 통계의 원천
--    기획서 1장 "라이프사이클 통계", 3.2 "처리 리드타임"
-- ----------------------------------------------------------------------------
create table if not exists public.ticket_status_history (
  id          bigserial primary key,
  ticket_id   bigint not null references public.tickets(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references public.users(id),
  changed_at  timestamptz not null default now()
);

create index if not exists idx_history_ticket on public.ticket_status_history (ticket_id, changed_at);

-- ----------------------------------------------------------------------------
-- 6. comments — 처리 내역 및 내부 협업 코멘트
-- ----------------------------------------------------------------------------
create table if not exists public.comments (
  id         bigserial primary key,
  ticket_id  bigint not null references public.tickets(id) on delete cascade,
  user_id    uuid references public.users(id) on delete set null,
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_comments_ticket on public.comments (ticket_id, created_at);

-- ----------------------------------------------------------------------------
-- 7. attachments — Supabase Storage 첨부파일 경로
-- ----------------------------------------------------------------------------
create table if not exists public.attachments (
  id           bigserial primary key,
  ticket_id    bigint not null references public.tickets(id) on delete cascade,
  file_name    text not null,
  file_url     text not null,          -- Storage 내 경로 (bucket 제외). 예: 42/1699-error.png
  content_type text,
  size_bytes   bigint,
  created_at   timestamptz not null default now()
);

create index if not exists idx_attachments_ticket on public.attachments (ticket_id);

-- ----------------------------------------------------------------------------
-- 8. outbound_emails — 완료 회신 발송 큐 (기획서 2-5)
--    웹이 행을 넣고, Local PC 에이전트가 집어가 아웃룩으로 발송합니다.
-- ----------------------------------------------------------------------------
create table if not exists public.outbound_emails (
  id           bigserial primary key,
  ticket_id    bigint not null references public.tickets(id) on delete cascade,
  to_email     text not null,
  cc_emails    text,
  subject      text not null,
  body         text not null,
  status       text not null default 'queued'
                 check (status in ('queued','sent','failed','cancelled')),
  requested_by uuid references public.users(id),
  requested_at timestamptz not null default now(),
  sent_at      timestamptz,
  attempts     int not null default 0,
  error        text
);

comment on table public.outbound_emails is
  '발송 큐. 티켓 상태만 보고 발송하면 중복발송·취소·재시도 이력이 남지 않습니다';

create index if not exists idx_outbound_queued on public.outbound_emails (status, requested_at);

-- 같은 티켓에 대기 중인 발송 요청이 둘 이상 쌓이지 않게 합니다
create unique index if not exists uq_outbound_one_queued_per_ticket
  on public.outbound_emails (ticket_id) where (status = 'queued');

-- ----------------------------------------------------------------------------
-- 9. 트리거
-- ----------------------------------------------------------------------------

-- 9.1 updated_at 자동 갱신
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_tickets_touch on public.tickets;
create trigger trg_tickets_touch before update on public.tickets
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_meta_touch on public.ticket_meta;
create trigger trg_meta_touch before update on public.ticket_meta
  for each row execute function public.touch_updated_at();

-- 9.2 상태 전이 시 이력 기록 + completed_at 관리
create or replace function public.log_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_status_history (ticket_id, from_status, to_status, changed_by)
    values (new.ticket_id, null, new.status, auth.uid());
    if new.status = 'done' and new.completed_at is null then
      new.completed_at := now();
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.ticket_status_history (ticket_id, from_status, to_status, changed_by)
    values (new.ticket_id, old.status, new.status, auth.uid());

    if new.status = 'done' then
      new.completed_at := coalesce(new.completed_at, now());
    else
      -- 완료를 되돌리면 완료 시각도 지웁니다. 리드타임 통계가 오염되지 않도록.
      new.completed_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_meta_status_insert on public.ticket_meta;
create trigger trg_meta_status_insert before insert on public.ticket_meta
  for each row execute function public.log_status_change();

drop trigger if exists trg_meta_status_update on public.ticket_meta;
create trigger trg_meta_status_update before update on public.ticket_meta
  for each row execute function public.log_status_change();

-- 9.3 관리자가 아니면 role 을 바꿀 수 없습니다.
--
-- 단, auth.uid() 가 null 인 경로(SQL Editor, service_role 키, 마이그레이션)는
-- 통과시킵니다. 그쪽은 이미 DB 전체 권한을 가지고 있어 이 트리거로 막을 것이 없고,
-- 막으면 **최초 관리자를 만들 방법이 사라집니다** — 관리자가 되려면 관리자가
-- 필요해지는 교착이 생깁니다. 이 트리거가 실제로 막아야 하는 것은
-- 로그인한 팀원이 API 로 자기 역할을 올리는 경우입니다.
create or replace function public.guard_role_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception '역할 변경은 관리자만 가능합니다';
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. 권한 헬퍼
--     security definer 로 두어야 users 테이블 RLS 와 재귀하지 않습니다.
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and is_active
  );
$$;

-- 이 티켓을 내가 수정할 수 있는가 (관리자이거나, 나에게 할당된 티켓)
create or replace function public.can_edit_ticket(p_ticket_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.ticket_meta
    where ticket_id = p_ticket_id and assignee_id = auth.uid()
  );
$$;

drop trigger if exists trg_users_guard_role on public.users;
create trigger trg_users_guard_role before update on public.users
  for each row execute function public.guard_role_change();

-- ----------------------------------------------------------------------------
-- 11. RLS
--     기본 원칙: 로그인한 활성 사용자는 전부 읽는다. 쓰기는 역할에 따라 갈린다.
--     service_role 키(에이전트)는 RLS 를 우회하므로 별도 정책이 필요 없습니다.
-- ----------------------------------------------------------------------------
alter table public.users                 enable row level security;
alter table public.tickets               enable row level security;
alter table public.ticket_meta           enable row level security;
alter table public.ticket_status_history enable row level security;
alter table public.comments              enable row level security;
alter table public.attachments           enable row level security;
alter table public.outbound_emails       enable row level security;

-- 11.1 users
drop policy if exists users_read       on public.users;
drop policy if exists users_update_self on public.users;
drop policy if exists users_update_admin on public.users;
drop policy if exists users_insert_admin on public.users;
drop policy if exists users_delete_admin on public.users;

create policy users_read on public.users
  for select using (auth.uid() is not null);

-- 본인 행은 수정 가능하지만 role 은 트리거가 막습니다
create policy users_update_self on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy users_update_admin on public.users
  for update using (public.is_admin()) with check (public.is_admin());

create policy users_insert_admin on public.users
  for insert with check (public.is_admin() or id = auth.uid());

create policy users_delete_admin on public.users
  for delete using (public.is_admin());

-- 11.2 tickets
drop policy if exists tickets_read         on public.tickets;
drop policy if exists tickets_insert_admin on public.tickets;
drop policy if exists tickets_update       on public.tickets;
drop policy if exists tickets_delete_admin on public.tickets;

create policy tickets_read on public.tickets
  for select using (public.is_member());

create policy tickets_insert_admin on public.tickets
  for insert with check (public.is_admin());

-- 관리자 전체, 팀원은 본인에게 할당된 티켓만 (기획서 3.2 권한 관리)
create policy tickets_update on public.tickets
  for update using (public.can_edit_ticket(id)) with check (public.can_edit_ticket(id));

create policy tickets_delete_admin on public.tickets
  for delete using (public.is_admin());

-- 11.3 ticket_meta
drop policy if exists meta_read         on public.ticket_meta;
drop policy if exists meta_insert_admin on public.ticket_meta;
drop policy if exists meta_update       on public.ticket_meta;
drop policy if exists meta_delete_admin on public.ticket_meta;

create policy meta_read on public.ticket_meta
  for select using (public.is_member());

create policy meta_insert_admin on public.ticket_meta
  for insert with check (public.is_admin());

create policy meta_update on public.ticket_meta
  for update using (public.can_edit_ticket(ticket_id))
  with check (
    public.is_admin()
    -- 팀원은 담당자를 바꿀 수 없습니다. 본인에게 할당된 상태를 유지해야 합니다
    or assignee_id = auth.uid()
  );

create policy meta_delete_admin on public.ticket_meta
  for delete using (public.is_admin());

-- 11.4 ticket_status_history — 읽기 전용. 쓰기는 트리거(security definer)만
drop policy if exists history_read on public.ticket_status_history;
create policy history_read on public.ticket_status_history
  for select using (public.is_member());

-- 11.5 comments
drop policy if exists comments_read   on public.comments;
drop policy if exists comments_insert on public.comments;
drop policy if exists comments_update on public.comments;
drop policy if exists comments_delete on public.comments;

create policy comments_read on public.comments
  for select using (public.is_member());

create policy comments_insert on public.comments
  for insert with check (public.is_member() and user_id = auth.uid());

create policy comments_update on public.comments
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy comments_delete on public.comments
  for delete using (user_id = auth.uid() or public.is_admin());

-- 11.6 attachments
drop policy if exists att_read         on public.attachments;
drop policy if exists att_insert_admin on public.attachments;
drop policy if exists att_delete_admin on public.attachments;

create policy att_read on public.attachments
  for select using (public.is_member());

create policy att_insert_admin on public.attachments
  for insert with check (public.is_admin());

create policy att_delete_admin on public.attachments
  for delete using (public.is_admin());

-- 11.7 outbound_emails — 발송 요청은 관리자만 (되돌릴 수 없는 동작)
drop policy if exists out_read         on public.outbound_emails;
drop policy if exists out_insert_admin on public.outbound_emails;
drop policy if exists out_update_admin on public.outbound_emails;
drop policy if exists out_delete_admin on public.outbound_emails;

create policy out_read on public.outbound_emails
  for select using (public.is_member());

create policy out_insert_admin on public.outbound_emails
  for insert with check (public.is_admin() and requested_by = auth.uid());

create policy out_update_admin on public.outbound_emails
  for update using (public.is_admin()) with check (public.is_admin());

create policy out_delete_admin on public.outbound_emails
  for delete using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 12. Storage — 첨부파일 버킷
--     비공개 버킷입니다. 다운로드는 signed URL 로만 가능합니다.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('ticket-attachments', 'ticket-attachments', false)
on conflict (id) do nothing;

drop policy if exists att_storage_read   on storage.objects;
drop policy if exists att_storage_write  on storage.objects;
drop policy if exists att_storage_delete on storage.objects;

create policy att_storage_read on storage.objects
  for select using (bucket_id = 'ticket-attachments' and public.is_member());

create policy att_storage_write on storage.objects
  for insert with check (bucket_id = 'ticket-attachments' and public.is_admin());

create policy att_storage_delete on storage.objects
  for delete using (bucket_id = 'ticket-attachments' and public.is_admin());

-- ----------------------------------------------------------------------------
-- 13. 통계 뷰 — 리드타임 (기획서 3.2 통계 대시보드)
--     화면에서 직접 집계하지 않고 이 뷰를 씁니다.
-- ----------------------------------------------------------------------------
-- 15.6 과 16.4 가 이 뷰를 더 넓은 컬럼으로 다시 만듭니다. `create or replace view`
-- 는 컬럼을 **줄이지 못하므로**, 파일을 두 번째로 실행하면 여기서
-- "cannot drop columns from view" 로 멈춥니다. 그래서 지우고 다시 만듭니다.
drop view if exists public.ticket_lead_times;

create view public.ticket_lead_times as
select
  t.id                                                   as ticket_id,
  t.subject,
  t.received_at,
  m.status,
  m.severity,
  m.system_type,
  m.category,
  m.assignee_id,
  m.completed_at,
  case when m.completed_at is not null
       then extract(epoch from (m.completed_at - t.received_at)) / 3600.0
  end                                                    as lead_time_hours
from public.tickets t
join public.ticket_meta m on m.ticket_id = t.id;

-- 뷰는 기반 테이블의 RLS 를 따릅니다 (security_invoker)
alter view public.ticket_lead_times set (security_invoker = on);

-- ----------------------------------------------------------------------------
-- 14. 확인 쿼리
-- ----------------------------------------------------------------------------
-- 정책이 다 붙었는지:
--   select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public' order by tablename, cmd;
--
-- 나를 관리자로 지정 (최초 로그인 후 1회):
--   update public.users set role = 'admin' where email = 'admin@example.com';
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 15. 확장 — 대분류 · 시스템 등록 · 메일 스크리닝 · MTTR
--
-- 여기부터는 14장까지가 만든 것 위에 얹는 변경입니다.
-- 앞부분과 마찬가지로 여러 번 실행해도 안전합니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 15.1 시스템 종류 등록 (하드코딩 제거)
--
-- 초기값을 넣지 않습니다. 운영자가 설정 화면에서 직접 등록합니다.
-- ticket_meta.system_type 은 이 표의 code 를 담지만 **외래키를 걸지 않습니다.**
-- 시스템을 목록에서 지웠다고 과거 티켓의 분류가 사라지면 안 되기 때문입니다.
-- 등록되지 않은 코드는 화면에서 '미분류' 로 보입니다.
-- ----------------------------------------------------------------------------
create table if not exists public.systems (
  id          bigserial primary key,
  code        text unique not null,   -- LLM 이 고르는 값. 영문 소문자·숫자·밑줄 권장
  name        text not null,          -- 화면 표시명
  description text,                   -- LLM 에게 주는 판단 기준. 비워도 됩니다
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.systems is
  '시스템 종류 등록표. 초기값 없음 — 운영자가 설정 화면에서 등록합니다';
comment on column public.systems.description is
  'LLM 이 이 시스템을 고를 기준. 예: "회계·인사·재고 등 기간계 ERP". 비워도 동작합니다';

create index if not exists idx_systems_active on public.systems (is_active, sort_order);

-- ----------------------------------------------------------------------------
-- 15.2 ticket_meta 확장
-- ----------------------------------------------------------------------------

-- 대분류. 라이프사이클 6단계는 셋 다 동일하고, 관리 방식만 갈립니다.
--   incident    장애      — MTTR 측정 대상
--   maintenance 유지보수  — 단순 수정·개선. 주간 현황 대상
--   development 신규개발  — 공수 1주일 이상. 관리자가 수동 승격. Gantt 대상
alter table public.ticket_meta
  add column if not exists work_type text not null default 'maintenance';

do $$
begin
  alter table public.ticket_meta
    add constraint ticket_meta_work_type_check
    check (work_type in ('incident', 'maintenance', 'development'));
exception when duplicate_object then null;
end $$;

-- 공수(사람일). '1주일 이상이면 신규개발' 판단의 근거이자 Gantt 의 입력값입니다.
alter table public.ticket_meta add column if not exists estimated_days numeric(5,1);

-- 신규개발 승격 시점. "접수 후 며칠 만에 프로젝트가 됐는지" 를 답합니다.
alter table public.ticket_meta add column if not exists promoted_at timestamptz;
alter table public.ticket_meta
  add column if not exists promoted_by uuid references public.users(id) on delete set null;

-- system_type 은 이제 등록표를 따르므로 고정 목록 제약을 걷어냅니다.
-- 미분류를 표현해야 하므로 null 도 허용합니다.
alter table public.ticket_meta drop constraint if exists ticket_meta_system_type_check;
alter table public.ticket_meta alter column system_type drop not null;
alter table public.ticket_meta alter column system_type drop default;

-- 기존 데이터의 대분류 백필: 오류는 장애로, 나머지는 유지보수로.
-- (신규개발 승격은 사람이 판단하므로 자동으로 올리지 않습니다)
update public.ticket_meta
set work_type = case when category = 'error' then 'incident' else 'maintenance' end
where work_type = 'maintenance' and category = 'error';

create index if not exists idx_meta_work_type on public.ticket_meta (work_type);

-- 승격 시점 자동 기록
-- INSERT 트리거에서는 OLD 가 없으므로 TG_OP 로 갈라야 합니다.
-- (log_status_change 와 같은 이유로 같은 형태를 씁니다)
create or replace function public.stamp_promotion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  was_development boolean;
begin
  was_development := (tg_op = 'UPDATE' and old.work_type = 'development');

  if new.work_type = 'development' and not was_development then
    new.promoted_at := coalesce(new.promoted_at, now());
    new.promoted_by := coalesce(new.promoted_by, auth.uid());
  elsif new.work_type <> 'development' then
    -- 되돌리면 승격 기록도 지웁니다. 남겨 두면 통계가 오염됩니다.
    new.promoted_at := null;
    new.promoted_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_meta_promotion on public.ticket_meta;
create trigger trg_meta_promotion before insert or update on public.ticket_meta
  for each row execute function public.stamp_promotion();

-- ----------------------------------------------------------------------------
-- 15.3 tickets 확장 — 계획 일정 (Gantt 입력값)
-- ----------------------------------------------------------------------------
alter table public.tickets add column if not exists planned_start_date date;
alter table public.tickets add column if not exists planned_end_date date;

-- ----------------------------------------------------------------------------
-- 15.4 메일 스크리닝 — 스캔한 메일을 전부 남깁니다
--
-- 지금까지는 LLM 이 '요청 아님' 으로 판정한 메일이 어디에도 남지 않았습니다.
-- 오판이 있어도 아무도 알 수 없었습니다. 스캔한 것을 모두 여기 적재하고,
-- 사람이 검토 화면에서 티켓으로 전환하거나 제외를 확정합니다.
-- ----------------------------------------------------------------------------
create table if not exists public.scanned_mails (
  id             bigserial primary key,
  message_id     text unique not null,        -- Outlook EntryID. 중복 스캔 차단
  subject        text not null default '',
  body           text not null default '',
  body_html      text,
  sender_email   text not null default '',
  sender_name    text,
  received_at    timestamptz,
  folder         text,
  scanned_at     timestamptz not null default now(),

  -- LLM 판정 결과 (티켓이 되지 않은 건도 근거를 남깁니다)
  llm_is_request boolean,
  llm_category   text,
  llm_severity   text,
  llm_system     text,
  llm_confidence numeric(3,2),
  llm_reason     text,
  llm_error      text,
  llm_model      text,

  -- 처리 결과 (18장에서 'pending' 이 붙습니다)
  outcome     text not null default 'excluded'
                check (outcome in ('ticketed', 'excluded', 'pending')),
  ticket_id   bigint references public.tickets(id) on delete set null,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text
);

comment on table public.scanned_mails is
  '스캔한 메일 전부. LLM 이 걸러낸 것도 남겨 사람이 오판을 구제할 수 있게 합니다';
comment on column public.scanned_mails.reviewed_at is
  'null 이면 사람이 아직 보지 않은 것. 검토 화면의 기본 필터입니다';

create index if not exists idx_scanned_outcome on public.scanned_mails (outcome, scanned_at desc);
create index if not exists idx_scanned_unreviewed
  on public.scanned_mails (scanned_at desc) where (reviewed_at is null);

-- ----------------------------------------------------------------------------
-- 15.5 RLS — 기존과 같은 패턴
-- ----------------------------------------------------------------------------
alter table public.systems       enable row level security;
alter table public.scanned_mails enable row level security;

drop policy if exists systems_read         on public.systems;
drop policy if exists systems_write_admin  on public.systems;
drop policy if exists systems_update_admin on public.systems;
drop policy if exists systems_delete_admin on public.systems;

create policy systems_read on public.systems
  for select using (public.is_member());
create policy systems_write_admin on public.systems
  for insert with check (public.is_admin());
create policy systems_update_admin on public.systems
  for update using (public.is_admin()) with check (public.is_admin());
create policy systems_delete_admin on public.systems
  for delete using (public.is_admin());

drop policy if exists scanned_read         on public.scanned_mails;
drop policy if exists scanned_update_admin on public.scanned_mails;
drop policy if exists scanned_delete_admin on public.scanned_mails;

create policy scanned_read on public.scanned_mails
  for select using (public.is_member());
-- 적재는 에이전트(service_role)만 합니다. 검토 결과 갱신은 관리자.
create policy scanned_update_admin on public.scanned_mails
  for update using (public.is_admin()) with check (public.is_admin());
create policy scanned_delete_admin on public.scanned_mails
  for delete using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 15.6 통계 뷰 갱신 — MTTA(대기) / MTTR(수리) 분리
--
--   접수 → 착수 = 대기 시간 (MTTA)  : 메일이 들어온 뒤 손대기까지
--   착수 → 완료 = 수리 시간 (MTTR)  : 팀이 실제로 고치는 데 걸린 시간
--   접수 → 완료 = 리드타임          : 요청자가 겪은 전체 시간
--
-- 하나만 재면 "우리가 느린 건지, 접수가 늦게 전달된 건지" 를 구분할 수 없습니다.
-- 착수 시점은 상태가 처음 in_progress 로 바뀐 때입니다.
-- ----------------------------------------------------------------------------
drop view if exists public.ticket_lead_times;

create view public.ticket_lead_times as
with first_progress as (
  select ticket_id, min(changed_at) as started_at
  from public.ticket_status_history
  where to_status = 'in_progress'
  group by ticket_id
)
select
  t.id                          as ticket_id,
  t.subject,
  t.received_at,
  t.due_date,
  t.planned_start_date,
  t.planned_end_date,
  m.status,
  m.work_type,
  m.severity,
  m.system_type,
  m.category,
  m.assignee_id,
  m.estimated_days,
  m.promoted_at,
  m.completed_at,
  f.started_at,
  case when f.started_at is not null
       then extract(epoch from (f.started_at - t.received_at)) / 3600.0
  end                           as wait_hours,
  case when m.completed_at is not null and f.started_at is not null
       then extract(epoch from (m.completed_at - f.started_at)) / 3600.0
  end                           as repair_hours,
  case when m.completed_at is not null
       then extract(epoch from (m.completed_at - t.received_at)) / 3600.0
  end                           as lead_time_hours
from public.tickets t
join public.ticket_meta m on m.ticket_id = t.id
left join first_progress f on f.ticket_id = t.id;

alter view public.ticket_lead_times set (security_invoker = on);

-- ----------------------------------------------------------------------------
-- 15.7 접수 판정 기준 — 코드에서 설정으로
--
-- 지금까지 "무엇을 요청 메일로 볼 것인가" 는 에이전트 프롬프트 문자열에
-- 박혀 있었습니다. 운영자는 기준을 볼 수도, 고칠 수도 없었습니다.
-- 조직마다 '요청' 의 범위가 다르므로(단순 문의를 티켓으로 볼 것인가 등)
-- 시스템 종류와 같은 이유로 설정으로 뺍니다.
--
-- 에이전트는 스캔할 때마다 읽어 프롬프트에 넣습니다. 재시작이 필요 없습니다.
-- ----------------------------------------------------------------------------
create table if not exists public.intake_rules (
  id         bigserial primary key,
  kind       text not null check (kind in ('include', 'exclude')),
  content    text not null,
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  unique (kind, content)
);

comment on table public.intake_rules is
  'LLM 이 요청 메일을 판정하는 기준. include=접수 대상, exclude=제외 대상';

create index if not exists idx_intake_rules_active on public.intake_rules (kind, is_active, sort_order);

-- 기준 변경 이력. "언제부터 판정이 달라졌는지" 를 추적합니다.
-- 판정 품질이 갑자기 나빠졌을 때 기준 변경 때문인지 확인할 근거입니다.
create table if not exists public.intake_rule_history (
  id         bigserial primary key,
  rule_id    bigint,
  action     text not null check (action in ('created', 'updated', 'deleted')),
  kind       text,
  content    text,
  is_active  boolean,
  changed_by uuid references public.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists idx_rule_history_at on public.intake_rule_history (changed_at desc);

create or replace function public.log_intake_rule_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into public.intake_rule_history (rule_id, action, kind, content, is_active, changed_by)
    values (old.id, 'deleted', old.kind, old.content, old.is_active, auth.uid());
    return old;
  end if;

  insert into public.intake_rule_history (rule_id, action, kind, content, is_active, changed_by)
  values (
    new.id,
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    new.kind, new.content, new.is_active, auth.uid()
  );
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_intake_rules_log_ins on public.intake_rules;
create trigger trg_intake_rules_log_ins after insert on public.intake_rules
  for each row execute function public.log_intake_rule_change();

drop trigger if exists trg_intake_rules_log_upd on public.intake_rules;
create trigger trg_intake_rules_log_upd before update on public.intake_rules
  for each row execute function public.log_intake_rule_change();

drop trigger if exists trg_intake_rules_log_del on public.intake_rules;
create trigger trg_intake_rules_log_del after delete on public.intake_rules
  for each row execute function public.log_intake_rule_change();

-- 지금까지 코드에 박혀 있던 기준을 그대로 초기값으로 넣습니다.
-- 시스템 종류와 달리 비워 두면 LLM 이 아무 근거 없이 판정하게 되므로,
-- 현재 동작하는 기준을 보이게 만들어 두고 운영자가 고치도록 합니다.
insert into public.intake_rules (kind, content, sort_order) values
  ('include', '시스템 오류·장애 신고', 10),
  ('include', '기능 개선, 수정, 신규 개발 요청', 20),
  ('include', '데이터 정정, 권한 부여처럼 IT팀의 작업이 필요한 요청', 30),
  ('exclude', '일상 대화, 인사, 회식·일정 공지', 10),
  ('exclude', '광고, 뉴스레터, 스팸, 자동 발송 알림', 20),
  ('exclude', '이미 처리된 건에 대한 단순 감사 인사', 30),
  ('exclude', '회의록·자료 공유처럼 작업 요청이 아닌 것', 40)
on conflict (kind, content) do nothing;

-- ----------------------------------------------------------------------------
-- 15.8 일반 설정 (키-값)
-- ----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,
  value       text,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users(id) on delete set null
);

insert into public.app_settings (key, value, description) values
  ('intake_ambiguous_policy', 'include',
   '판단이 애매할 때. include=접수한다(권장) / exclude=제외한다. '
   '메일은 놓치면 복구되지 않고, 잘못 접수된 티켓은 지우면 되므로 include 를 권합니다.'),
  ('development_threshold_days', '5',
   '신규개발로 볼 공수 기준(사람일). 화면에서 승격 안내에 쓰입니다. 판단 자체는 사람이 합니다.')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 15.9 RLS — 설정은 읽기 전원, 쓰기는 관리자
-- ----------------------------------------------------------------------------
alter table public.intake_rules        enable row level security;
alter table public.intake_rule_history enable row level security;
alter table public.app_settings        enable row level security;

drop policy if exists rules_read         on public.intake_rules;
drop policy if exists rules_write_admin  on public.intake_rules;
drop policy if exists rules_update_admin on public.intake_rules;
drop policy if exists rules_delete_admin on public.intake_rules;

create policy rules_read on public.intake_rules
  for select using (public.is_member());
create policy rules_write_admin on public.intake_rules
  for insert with check (public.is_admin());
create policy rules_update_admin on public.intake_rules
  for update using (public.is_admin()) with check (public.is_admin());
create policy rules_delete_admin on public.intake_rules
  for delete using (public.is_admin());

drop policy if exists rule_history_read on public.intake_rule_history;
create policy rule_history_read on public.intake_rule_history
  for select using (public.is_member());

drop policy if exists settings_read         on public.app_settings;
drop policy if exists settings_write_admin  on public.app_settings;
drop policy if exists settings_update_admin on public.app_settings;

create policy settings_read on public.app_settings
  for select using (public.is_member());
create policy settings_write_admin on public.app_settings
  for insert with check (public.is_admin());
create policy settings_update_admin on public.app_settings
  for update using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 15.10 수동 등록 큐 — 본문을 붙여넣으면 시스템이 성격을 판단해 티켓으로
--
-- 메일로 오지 않은 요청(구두·전화·메신저)을 등록하는 경로입니다.
-- 웹은 **큐에 넣기만** 하고, 분류는 에이전트가 합니다.
-- LLM API 키가 에이전트 PC 한 곳에만 있어야 하기 때문입니다 —
-- 브라우저에 넣으면 그대로 노출됩니다. 회신 발송 큐와 같은 구조입니다.
--
-- ⚠️ 여기 들어온 건은 **is_request 판정을 하지 않습니다.**
--    사람이 직접 등록한 이상 요청이라는 판단은 이미 끝난 것이고,
--    LLM 은 분류(대분류·등급·시스템·기한)만 합니다.
-- ----------------------------------------------------------------------------
create table if not exists public.manual_intake (
  id             bigserial primary key,
  raw_text       text not null,              -- 붙여넣은 본문 (구두 요청이면 받아적은 내용)
  subject        text,                       -- 비우면 LLM 이 제목을 만듭니다
  reporter_email text,                       -- 구두 요청이면 비어 있을 수 있습니다
  reporter_name  text,
  received_at    timestamptz not null default now(),  -- 요청받은 시점
  channel        text not null default 'verbal'
                   check (channel in ('verbal', 'phone', 'messenger', 'mail', 'etc')),
  note           text,                       -- 등록자 메모 (티켓 본문에 들어가지 않습니다)

  status       text not null default 'queued'
                 check (status in ('queued', 'done', 'failed')),
  ticket_id    bigint references public.tickets(id) on delete set null,
  error        text,
  attempts     int not null default 0,

  requested_by uuid references public.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  processed_at timestamptz
);

comment on table public.manual_intake is
  '수동 등록 큐. 웹이 본문을 넣고 에이전트가 분류해 티켓으로 만듭니다';
comment on column public.manual_intake.channel is
  '요청받은 경로. 통계에서 "구두 요청이 몇 %인지" 를 보기 위한 값입니다';

create index if not exists idx_manual_queued
  on public.manual_intake (requested_at) where (status = 'queued');

alter table public.manual_intake enable row level security;

drop policy if exists manual_read         on public.manual_intake;
drop policy if exists manual_insert       on public.manual_intake;
drop policy if exists manual_update_admin on public.manual_intake;
drop policy if exists manual_delete_admin on public.manual_intake;

create policy manual_read on public.manual_intake
  for select using (public.is_member());
-- 등록은 **팀원 전원**이 할 수 있습니다. 구두 요청은 누구나 받습니다.
create policy manual_insert on public.manual_intake
  for insert with check (public.is_member() and requested_by = auth.uid());
create policy manual_update_admin on public.manual_intake
  for update using (public.is_admin()) with check (public.is_admin());
create policy manual_delete_admin on public.manual_intake
  for delete using (public.is_admin());

-- 티켓이 어느 경로로 들어왔는지. 메일이 아닌 건을 구분합니다.
alter table public.tickets add column if not exists intake_channel text;
comment on column public.tickets.intake_channel is
  'null=메일 수집. 그 외에는 manual_intake.channel 값이 들어갑니다';

-- ============================================================================
-- 16. 상태 모델 보강 — 보류(on_hold)와 종료 방식(resolution)
--
-- 두 가지를 고칩니다.
--
--  (1) 보류가 없어서 MTTR 이 거짓말을 합니다.
--      요청자 회신을 2주 기다린 건이 "수리에 2주 걸림" 으로 집계됩니다.
--      팀이 손을 놓고 있던 시간과 팀이 일한 시간은 다른 사실입니다.
--
--  (2) done 이 "고쳐서 끝남" 과 "오접수라 반려" 를 같은 값에 뭉쳐 놓았습니다.
--      접수 판정을 일부러 느슨하게 잡았으므로(놓치는 것보다 잘못 접수되는 게 낫다)
--      오접수는 반드시 들어옵니다. 그런데 지금은 처리할 방법이 삭제뿐이고,
--      삭제하면 중복 판정 근거인 tickets.source_message_id 가 사라져
--      **다음 스캔에서 같은 메일이 다시 티켓이 됩니다.**
--      반려는 삭제가 아니라 종료 방식이어야 합니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 16.1 on_hold 상태
--
-- 보류는 파이프라인의 한 단계가 아니라 **옆길**입니다. 어느 단계에서든 들어갔다
-- 원래 자리로 돌아옵니다. 그래서 돌아갈 자리를 hold_from_status 에 적어 둡니다 —
-- 이력에서 계산할 수도 있지만, 보드에서 카드를 끌 때도 필요하므로 컬럼으로 둡니다.
-- ----------------------------------------------------------------------------
alter table public.ticket_meta drop constraint if exists ticket_meta_status_check;
alter table public.ticket_meta add constraint ticket_meta_status_check
  check (status in ('intake','triage','in_progress','on_hold','testing','deploy','done'));

alter table public.ticket_meta add column if not exists hold_reason      text;
alter table public.ticket_meta add column if not exists hold_from_status text;

comment on column public.ticket_meta.hold_reason is
  '무엇을 기다리는지. 사유 없는 보류는 왜 멈췄는지 아무도 모르게 됩니다';
comment on column public.ticket_meta.hold_from_status is
  '보류 직전 단계. 보류를 풀 때 돌아갈 자리이고, 보류를 거쳐 단계를 건너뛰는 것을 막습니다';

-- ----------------------------------------------------------------------------
-- 16.2 종료 방식(resolution)
--
-- 상태는 "지금 누가 무엇을 하고 있는가", 종료 방식은 "어떻게 끝났는가" 입니다.
-- 둘을 한 필드에 담으면 "완료 12건" 이 몇 건을 실제로 고친 것인지 알 수 없습니다.
--
-- 기본값을 두지 않습니다. 값이 없으면 '미지정' 이지 'fixed' 가 아닙니다 —
-- 없는 값을 채우면 통계가 사실이 아니게 됩니다.
-- ----------------------------------------------------------------------------
alter table public.ticket_meta add column if not exists resolution text;

alter table public.ticket_meta drop constraint if exists ticket_meta_resolution_check;
alter table public.ticket_meta add constraint ticket_meta_resolution_check
  check (resolution is null
         or resolution in ('fixed','rejected','duplicate','wontfix','cancelled'));

comment on column public.ticket_meta.resolution is
  'done 일 때만 뜻이 있습니다. rejected/duplicate/cancelled 는 실제 작업이 아니므로 MTTA·MTTR 모수에서 빠집니다';

-- ----------------------------------------------------------------------------
-- 16.3 상태 이력 트리거 — 보류·종료 방식 뒷정리
--
-- 상태를 되돌렸는데 값이 남아 있으면 통계가 조용히 틀립니다.
--   · done 을 벗어나면 resolution 을 지웁니다 (안 지우면 반려로 계속 빠집니다)
--   · on_hold 를 벗어나면 hold_reason 을 지웁니다 (안 지우면 지금 보류 중으로 보입니다)
-- ----------------------------------------------------------------------------
create or replace function public.log_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_status_history (ticket_id, from_status, to_status, changed_by)
    values (new.ticket_id, null, new.status, auth.uid());
    if new.status = 'done' and new.completed_at is null then
      new.completed_at := now();
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.ticket_status_history (ticket_id, from_status, to_status, changed_by)
    values (new.ticket_id, old.status, new.status, auth.uid());

    if new.status = 'done' then
      new.completed_at := coalesce(new.completed_at, now());
    else
      -- 완료를 되돌리면 완료 시각도 종료 방식도 지웁니다.
      new.completed_at := null;
      new.resolution   := null;
    end if;

    if new.status = 'on_hold' then
      -- 돌아갈 자리를 적어 둡니다. 보류에서 보류로는 올 수 없으므로 old.status 가 맞습니다.
      new.hold_from_status := old.status;
    elsif old.status = 'on_hold' then
      new.hold_from_status := null;
      new.hold_reason      := null;
    end if;
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 16.4 통계 뷰 — 보류 시간을 빼고 MTTA/MTTR 을 다시 계산합니다
--
-- 착수 전 보류는 대기(MTTA)에서, 착수 후 보류는 수리(MTTR)에서 뺍니다.
-- 리드타임(접수→완료)은 **빼지 않습니다** — 요청자가 실제로 겪은 시간이고,
-- 그 안에 보류가 있었다는 사실은 hold_hours 로 따로 드러냅니다.
--
-- 보류 구간은 이력에서 이어 붙입니다. 아직 보류 중이면 지금까지로 셉니다.
-- ----------------------------------------------------------------------------
drop view if exists public.ticket_lead_times;

create view public.ticket_lead_times as
with first_progress as (
  select ticket_id, min(changed_at) as started_at
  from public.ticket_status_history
  where to_status = 'in_progress'
  group by ticket_id
),
spans as (
  select
    h.ticket_id,
    h.to_status,
    h.changed_at as span_from,
    coalesce(
      lead(h.changed_at) over (partition by h.ticket_id order by h.changed_at),
      now()
    ) as span_to
  from public.ticket_status_history h
),
holds as (
  select
    s.ticket_id,
    sum(extract(epoch from (s.span_to - s.span_from))) / 3600.0 as hold_hours,
    -- 구간은 착수 시각을 걸치지 못합니다. 착수하려면 상태가 바뀌어야 하고,
    -- 그 순간 보류 구간이 끝나기 때문입니다. 그래서 둘로 정확히 갈립니다.
    sum(case when f.started_at is null or s.span_to <= f.started_at
             then extract(epoch from (s.span_to - s.span_from)) else 0 end) / 3600.0
      as hold_before_hours,
    sum(case when f.started_at is not null and s.span_from >= f.started_at
             then extract(epoch from (s.span_to - s.span_from)) else 0 end) / 3600.0
      as hold_after_hours
  from spans s
  left join first_progress f on f.ticket_id = s.ticket_id
  where s.to_status = 'on_hold'
  group by s.ticket_id
)
select
  t.id                          as ticket_id,
  t.subject,
  t.received_at,
  t.due_date,
  t.planned_start_date,
  t.planned_end_date,
  m.status,
  m.work_type,
  m.severity,
  m.system_type,
  m.category,
  m.assignee_id,
  m.estimated_days,
  m.promoted_at,
  m.completed_at,
  m.resolution,
  m.hold_reason,
  f.started_at,
  coalesce(hd.hold_hours, 0)    as hold_hours,
  case when f.started_at is not null
       then greatest(0, extract(epoch from (f.started_at - t.received_at)) / 3600.0
                        - coalesce(hd.hold_before_hours, 0))
  end                           as wait_hours,
  case when m.completed_at is not null and f.started_at is not null
       then greatest(0, extract(epoch from (m.completed_at - f.started_at)) / 3600.0
                        - coalesce(hd.hold_after_hours, 0))
  end                           as repair_hours,
  case when m.completed_at is not null
       then extract(epoch from (m.completed_at - t.received_at)) / 3600.0
  end                           as lead_time_hours
from public.tickets t
join public.ticket_meta m on m.ticket_id = t.id
left join first_progress f on f.ticket_id = t.id
left join holds hd on hd.ticket_id = t.id;

alter view public.ticket_lead_times set (security_invoker = on);

-- ----------------------------------------------------------------------------
-- 16.5 상태 전이를 DB 가 막습니다
--
-- 지금까지 인접 단계 규칙은 웹(workflow.ts)에만 있었습니다. RLS 는 **누가**
-- 고칠 수 있는지(관리자 또는 담당자)만 봤고, **어디로** 옮기는지는 안 봤습니다.
-- 보류를 넣으면서 그 구멍이 커집니다 — 보류를 한 번 거치는 것만으로 팀원이
-- 단계를 건너뛸 수 있으면 인접 이동 규칙이 있으나 마나입니다.
--
-- auth.uid() 가 null 인 경로(에이전트의 service_role, SQL Editor)와 관리자는
-- 통과시킵니다. 에이전트는 사람의 실수를 막을 대상이 아니고, 관리자는 오접수
-- 티켓을 바로 닫을 수 있어야 합니다.
--
-- 이 규칙은 web/src/lib/workflow.ts 의 allowedTransitions 와 **같은 내용**입니다.
-- 한쪽만 고치면 화면에서는 되는데 저장이 실패합니다.
-- ----------------------------------------------------------------------------
create or replace function public.guard_status_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pipeline text[] := array['intake','triage','in_progress','testing','deploy','done'];
  old_idx  int;
  new_idx  int;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  -- 보류를 풀 때는 들어갈 때의 자리로만 돌아갑니다.
  if old.status = 'on_hold' then
    if old.hold_from_status is null then
      raise exception '보류를 풀 자리를 알 수 없습니다. 관리자가 옮겨야 합니다';
    end if;
    if new.status is distinct from old.hold_from_status then
      raise exception '보류는 직전 단계(%)로만 풀 수 있습니다', old.hold_from_status;
    end if;
    return new;
  end if;

  -- 보류로 들어가기 — 완료된 건은 기다릴 것이 없습니다.
  if new.status = 'on_hold' then
    if old.status = 'done' then
      raise exception '완료된 건은 보류할 수 없습니다';
    end if;
    return new;
  end if;

  old_idx := array_position(pipeline, old.status);
  new_idx := array_position(pipeline, new.status);
  if old_idx is null or new_idx is null or abs(new_idx - old_idx) <> 1 then
    raise exception '팀원은 인접 단계로만 옮길 수 있습니다 (% → %)', old.status, new.status;
  end if;

  return new;
end;
$$;

-- 이름이 trg_meta_status_update 보다 앞서므로 이력을 남기기 전에 먼저 걸러집니다.
drop trigger if exists trg_meta_guard_status on public.ticket_meta;
create trigger trg_meta_guard_status before update on public.ticket_meta
  for each row execute function public.guard_status_transition();

-- ----------------------------------------------------------------------------
-- 16.6 보류에는 사유가 있어야 합니다
--
-- 사유 없는 보류는 왜 멈췄는지 아무도 모른 채 남습니다. 화면에서도 받고 있지만,
-- 실제로 막는 것은 여기입니다.
--
-- **종료 방식(resolution)에는 같은 제약을 걸지 않습니다.** 이미 완료된 옛 티켓이
-- 전부 null 이라 제약을 걸면 그 행들이 즉시 위반이 됩니다. 값이 없는 건은
-- '미지정' 으로 드러내고, 통계에서 'fixed' 로 채우지 않습니다.
-- ----------------------------------------------------------------------------
alter table public.ticket_meta drop constraint if exists ticket_meta_hold_reason_check;
alter table public.ticket_meta add constraint ticket_meta_hold_reason_check
  check (status <> 'on_hold' or (hold_reason is not null and btrim(hold_reason) <> ''));

-- ============================================================================
-- 17. 시스템 설정 — 비밀값(Gemini API 키)
--
-- 지금까지 Gemini 키는 Windows PC 의 agent/.env 에만 있었습니다. 키를 바꾸려면
-- 그 PC 에 붙어야 했습니다. 운영자가 화면에서 등록·교체할 수 있게 옮깁니다.
--
-- **app_settings 에 넣으면 안 됩니다.** 그 표는 `settings_read` 정책이
-- is_member() 이라 팀원 누구나 값을 읽습니다. API 키가 거기 있으면 로그인한
-- 팀원 아무나 REST 로 긁어갈 수 있습니다.
--
-- 그래서 별도 표를 두고 **정책을 하나도 만들지 않습니다.** RLS 가 켜져 있는데
-- 정책이 없으면 anon·authenticated 는 읽기도 쓰기도 전부 막힙니다.
-- 접근 경로는 둘뿐입니다:
--
--   · 에이전트  — service_role 키. RLS 를 우회합니다.
--   · 웹        — 아래 security definer 함수. 값을 **되돌려주지 않습니다.**
--
-- 즉 한 번 넣은 키는 화면으로 다시 꺼낼 수 없습니다. 확인이 필요하면 교체하세요.
-- ============================================================================

create table if not exists public.app_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

comment on table public.app_secrets is
  '비밀값. 정책이 없으므로 웹에서 직접 읽을 수 없습니다 — 아래 함수만 경유합니다';

alter table public.app_secrets enable row level security;

-- 혹시 예전에 만들어 둔 정책이 있으면 지웁니다. 정책이 하나라도 있으면 뚫립니다.
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies
             where schemaname = 'public' and tablename = 'app_secrets'
  loop
    execute format('drop policy %I on public.app_secrets', pol.policyname);
  end loop;
end;
$$;

-- 표 권한을 명시적으로 정합니다.
--
-- Supabase 는 public 스키마의 새 표에 anon·authenticated·service_role 로
-- 기본 권한을 자동으로 답니다. 그러면 이 표를 막는 것이 **RLS 하나뿐**이 됩니다.
-- 나중에 누가 정책을 하나 잘못 만들면 그 순간 뚫립니다.
-- GRANT 자체를 걷어내면 정책이 생겨도 못 읽습니다 (이중 방어).
--
-- security definer 함수는 소유자 권한으로 돌아가므로 이 REVOKE 의 영향을 받지
-- 않습니다. 에이전트(service_role)에게는 명시적으로 권한을 줍니다 — 기본 권한에
-- 기대면 다른 환경에서 조용히 안 읽힙니다.
do $$
begin
  revoke all on table public.app_secrets from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.app_secrets from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.app_secrets from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on table public.app_secrets to service_role';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 17.1 등록 상태만 돌려줍니다 — 값은 절대 나가지 않습니다
--
-- 마지막 4글자만 보여줍니다. 어느 키를 넣었는지 확인하기에는 충분하고,
-- 그것만으로 키를 복원할 수는 없습니다.
-- ----------------------------------------------------------------------------
create or replace function public.app_secret_status()
returns table (
  key        text,
  is_set     boolean,
  hint       text,
  length     int,
  updated_at timestamptz,
  updated_by text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 볼 수 있습니다';
  end if;

  return query
  select
    s.key,
    true,
    -- 값 자체는 나가지 않습니다. 끝 4글자만.
    repeat('•', greatest(0, length(s.value) - 4)) || right(s.value, 4),
    length(s.value),
    s.updated_at,
    coalesce(u.name, u.email)
  from public.app_secrets s
  left join public.users u on u.id = s.updated_by;
end;
$$;

-- ----------------------------------------------------------------------------
-- 17.2 등록·교체
-- ----------------------------------------------------------------------------
create or replace function public.set_app_secret(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 등록할 수 있습니다';
  end if;
  if p_key is null or btrim(p_key) = '' then
    raise exception '키 이름이 비어 있습니다';
  end if;
  if p_value is null or btrim(p_value) = '' then
    raise exception '값이 비어 있습니다. 지우려면 clear_app_secret 을 쓰세요';
  end if;

  insert into public.app_secrets (key, value, updated_by)
  values (btrim(p_key), btrim(p_value), auth.uid())
  on conflict (key) do update
    set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
end;
$$;

-- ----------------------------------------------------------------------------
-- 17.3 삭제 — 지우면 에이전트는 .env 의 값으로 돌아갑니다
-- ----------------------------------------------------------------------------
create or replace function public.clear_app_secret(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 지울 수 있습니다';
  end if;
  delete from public.app_secrets where key = btrim(p_key);
end;
$$;

-- anon 에게는 실행 권한을 주지 않습니다. 함수 안에서 is_admin() 을 보지만,
-- 로그인하지 않은 요청이 애초에 함수에 닿지 않게 합니다.
revoke all on function public.app_secret_status()               from public, anon;
revoke all on function public.set_app_secret(text, text)        from public, anon;
revoke all on function public.clear_app_secret(text)            from public, anon;
grant execute on function public.app_secret_status()            to authenticated;
grant execute on function public.set_app_secret(text, text)     to authenticated;
grant execute on function public.clear_app_secret(text)         to authenticated;

-- ----------------------------------------------------------------------------
-- 17.4 모델 등 비밀이 아닌 설정은 app_settings 에 둡니다
-- ----------------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('gemini_model', 'gemini-2.5-flash',
   '분류에 쓸 Gemini 모델. 비워 두면 에이전트가 .env 의 GEMINI_MODEL 을 씁니다.')
on conflict (key) do nothing;

-- ============================================================================
-- 18. 분류에 **실패한** 메일은 티켓이 아니라 '판단 대기' 로 갑니다
-- ============================================================================
-- 기획서 3.1 의 예외 처리는 "내용이 **부실**해도 반려하지 않는다" 입니다 —
-- LLM 이 요청이라고 **판단은 했는데** 세부를 못 뽑은 경우입니다. 그건 지금처럼
-- 티켓을 만들고 triage 로 보냅니다.
--
-- 그런데 API 오류·안전필터·스키마 위반은 다릅니다. 이때는 요청인지 아닌지를
-- **판단한 적이 없습니다.** 예전 코드는 그 경우에도 is_request 를 참으로 찍어
-- 넣어 티켓을 만들었는데, 그건 판단이 아니라 추측입니다. 추측으로 만든 티켓은
-- 통계 모수에 들어가고 담당자에게 할당되고 요청자에게 회신까지 나갑니다.
--
-- 그래서 세 번째 결과를 둡니다. 티켓도 아니고 제외도 아닌, **사람이 아직 정하지
-- 않은** 상태입니다. 스크리닝 화면에서 사람이 접수할지 버릴지 고릅니다.
--
-- 이 상태를 안 보고 지나치면 메일이 조용히 묻힙니다. 그래서 스크리닝 화면의
-- 기본 필터를 'pending' 으로 두고, 남은 건수를 사이드바에 띄웁니다.
-- ----------------------------------------------------------------------------
alter table public.scanned_mails drop constraint if exists scanned_mails_outcome_check;
alter table public.scanned_mails add constraint scanned_mails_outcome_check
  check (outcome in ('ticketed', 'excluded', 'pending'));

comment on column public.scanned_mails.outcome is
  'ticketed=티켓이 됨 · excluded=요청이 아니라 걸러짐 · pending=분류 실패라 사람이 정해야 함';

-- 판단 대기 목록은 화면을 열 때마다 조회합니다. 부분 인덱스로 충분합니다.
create index if not exists idx_scanned_pending
  on public.scanned_mails (scanned_at desc) where (outcome = 'pending');

-- ============================================================================
-- 19. 본문에 딸려 온 이미지는 첨부로 담지 않습니다
-- ============================================================================
-- 서명의 회사 로고, 명함 이미지, 본문에 끼워 넣은 그림은 아웃룩이 보기에 첨부와
-- 똑같습니다. 그대로 담으면 티켓마다 로고가 하나씩 쌓이고 첨부 목록에서 정작
-- 필요한 파일이 묻힙니다. 판정은 에이전트의 attachments.is_inline 이 합니다.
--
-- 뺀 것은 **이름만** 남깁니다. 내용은 안 담으므로 Storage 도 안 씁니다.
-- 이름이라도 남기는 이유는 판정이 틀릴 수 있기 때문입니다 — 잘못 뺀 사실이
-- 어디에도 안 남으면 요청자가 다시 보내 줄 때까지 아무도 모릅니다.
-- ----------------------------------------------------------------------------
alter table public.tickets add column if not exists skipped_inline_attachments text[];

comment on column public.tickets.skipped_inline_attachments is
  '본문에 딸려 있어 첨부에서 제외한 파일 이름들. 내용은 저장하지 않습니다';
