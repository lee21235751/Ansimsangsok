-- v0.7.4 운영 전 선택 적용용 초안
-- 공개 랜딩페이지 이벤트를 개인정보와 분리해 집계하기 위한 테이블입니다.
-- 실제 운영 전 RLS 정책과 API 경로를 다시 점검해야 합니다.

create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid null,
  event_type text not null,
  product_key text null,
  metadata jsonb not null default '{}'::jsonb,
  page_url text null,
  app_version text null
);

alter table public.lead_events enable row level security;

drop policy if exists "Allow public event insert" on public.lead_events;
create policy "Allow public event insert"
on public.lead_events
for insert
to anon
with check (true);

-- select/update/delete 정책은 운영 관리자 API에서만 열어야 합니다.
