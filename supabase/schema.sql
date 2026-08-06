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
-- status      : intake | triage | in_progress | testing | deploy | done
-- severity    : critical | high | medium | low
-- category    : error | improve | fix | new
-- system_type : erp | api | web_app | infra | etc

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
create or replace view public.ticket_lead_times as
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
