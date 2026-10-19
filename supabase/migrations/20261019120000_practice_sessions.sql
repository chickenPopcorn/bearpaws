-- PawPal practice time: one row per practice session, so the studio can mark
-- each day the daily goal was met. A session is one page visit on one local
-- calendar day; the browser makes up its id and re-sends its running total,
-- so a repeated upload never counts twice and two devices add up.

create table public.practice_sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The player's local calendar day, which the browser decides.
  day date not null,
  started_at timestamptz not null,
  seconds integer not null check (seconds between 0 and 86400),
  -- Seconds per song id.
  songs jsonb not null default '{}'::jsonb
    check (jsonb_typeof(songs) = 'object' and octet_length(songs::text) <= 16384),
  updated_at timestamptz not null default now()
);
create index practice_sessions_user_day on public.practice_sessions (user_id, day);

create trigger practice_sessions_stamp before insert or update on public.practice_sessions
  for each row execute function public.stamp_updated_at();

alter table public.practice_sessions enable row level security;

create policy "Users manage their own practice sessions" on public.practice_sessions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.practice_sessions from anon;
grant select, insert, update, delete on public.practice_sessions to authenticated;
