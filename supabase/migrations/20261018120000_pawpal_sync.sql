-- PawPal account sync: each signed-in user's practice progress and settings.
-- Imported MIDI files stay in the user's browser and are never uploaded.
-- Row-level security limits every row to the user who owns it.

-- Practice progress per song, from the library or imported: the same record
-- the browser keeps under cadence:progress:<songId>.
create table public.progress (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  song_id text not null check (song_id ~ '^[A-Za-z0-9._-]{1,128}$'),
  data jsonb not null check (octet_length(data::text) <= 65536),
  updated_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

-- The user's studio settings: the record the browser keeps under
-- cadence:settings.
create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null check (octet_length(data::text) <= 16384),
  updated_at timestamptz not null default now()
);

-- The server stamps every write, so no device's clock decides anything.
create function public.stamp_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger progress_stamp before insert or update on public.progress
  for each row execute function public.stamp_updated_at();
create trigger settings_stamp before insert or update on public.settings
  for each row execute function public.stamp_updated_at();

alter table public.progress enable row level security;
alter table public.settings enable row level security;

create policy "Users manage their own progress" on public.progress
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage their own settings" on public.settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Only signed-in users reach these tables through the Data API.
revoke all on public.progress, public.settings from anon;
grant select, insert, update, delete
  on public.progress, public.settings to authenticated;
