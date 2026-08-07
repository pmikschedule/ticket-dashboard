-- ════════════════════════════════════════════════════════════════════════════
--  팀원 계정 일괄 등록
--
--  Supabase 대시보드에서 한 명씩 만드는 대신 SQL 로 한 번에 만듭니다.
--  **schema.sql 을 먼저 적용한 뒤에** 실행하세요 — on_auth_user_created 트리거가
--  있어야 public.users 행이 자동으로 따라 만들어집니다.
--
--  여러 번 실행해도 안전합니다. 이미 있는 메일 주소는 건너뜁니다.
--
--  ── 왜 auth.users 에 직접 넣는가 ──────────────────────────────────────────
--  public.users.id 는 auth.users(id) 를 참조합니다. 인증 계정 없이 팀원 행만
--  만들 수는 없습니다. 그래서 인증 계정부터 만들고, 나머지는 트리거에 맡깁니다.
--
--  ── 비밀번호 ──────────────────────────────────────────────────────────────
--  전원 같은 임시 비밀번호로 만듭니다. 각자 첫 로그인 뒤 바꾸게 하세요.
--  이 파일은 저장소에 들어가므로 **실제로 쓸 비밀번호를 여기 적어 두지 마세요.**
--  실행할 때 아래 v_password 만 바꿔서 SQL Editor 에 붙여넣습니다.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  -- ⚠️ 실행 직전에 바꾸세요. 이 값 그대로 두고 돌리지 마세요.
  v_password text := 'CHANGE-ME-BEFORE-RUNNING';

  v_row  record;
  v_id   uuid;
  v_made int := 0;
  v_skip int := 0;
begin
  if v_password = 'CHANGE-ME-BEFORE-RUNNING' then
    raise exception 'v_password 를 실제 임시 비밀번호로 바꾼 뒤 실행하세요';
  end if;

  for v_row in
    select * from (values
      ('alexa.kang@pm-international.kr',      'Alexa',      'member'),
      ('elon.park@pm-international.kr',       'Elon',       'member'),
      ('jacqueline.hwang@pm-international.kr','Jacqueline', 'member'),
      ('jayce.jung@pm-international.kr',      'Jayce',      'member'),
      ('ji.park@pm-international.kr',         'Ji',         'member'),
      ('jin.song@pm-international.kr',        'Jin',        'member'),
      ('sloan.im@pm-international.kr',        'Sloan',      'member'),
      ('steven.hwang@pm-international.kr',    'Steven',     'admin')
    ) as t(email, name, role)
  loop
    if exists (select 1 from auth.users u where lower(u.email) = lower(v_row.email)) then
      v_skip := v_skip + 1;
      continue;
    end if;

    v_id := gen_random_uuid();

    -- 토큰 칼럼들에 null 대신 빈 문자열을 넣습니다. GoTrue 의 일부 버전이
    -- null 을 만나면 로그인 경로에서 터집니다.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_id, 'authenticated', 'authenticated',
      lower(v_row.email),
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      -- 트리거가 여기서 이름을 꺼내 public.users 에 넣습니다.
      jsonb_build_object('name', v_row.name),
      '', '', '', ''
    );

    -- 이메일/비밀번호 로그인은 identities 행이 있어야 동작합니다.
    -- 이것 없이 auth.users 만 만들면 계정은 보이는데 로그인이 안 됩니다.
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_id,
      jsonb_build_object('sub', v_id::text, 'email', lower(v_row.email)),
      'email', v_id::text,
      now(), now(), now()
    );

    -- 트리거는 role 을 항상 member 로 넣습니다. 관리자는 여기서 올립니다.
    if v_row.role = 'admin' then
      update public.users set role = 'admin' where id = v_id;
    end if;

    v_made := v_made + 1;
  end loop;

  raise notice '새로 만든 계정 %건 · 이미 있어서 건너뛴 계정 %건', v_made, v_skip;
end $$;

-- ── 확인 ────────────────────────────────────────────────────────────────────
-- 여덟 명이 모두 나오고, Steven 만 admin 이면 정상입니다.
select u.email, u.name, u.role, u.is_active,
       (select count(*) from auth.identities i where i.user_id = u.id) as 로그인수단
  from public.users u
 order by u.role, u.name;
