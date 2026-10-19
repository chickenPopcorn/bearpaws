-- A practice session only grows, but two tabs can upload copies of the same
-- session out of order. An update never lowers a session's time: an older,
-- smaller copy leaves the row as it was.

create function public.keep_practice_session_growing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.seconds < old.seconds then
    new.seconds := old.seconds;
    new.songs := old.songs;
  end if;
  return new;
end;
$$;

create trigger practice_sessions_never_shrink before update on public.practice_sessions
  for each row execute function public.keep_practice_session_growing();
