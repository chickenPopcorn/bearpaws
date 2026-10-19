-- Each account keeps progress for at most 200 songs, each record at most
-- 16 KiB. The library is far smaller and the app imports nothing, so more
-- can only come from calling the Data API directly; without a limit, one
-- account could fill the database for everyone. Saving a song the account
-- already has progress for always works.

alter table public.progress drop constraint progress_data_check;
alter table public.progress
  add constraint progress_data_check check (octet_length(data::text) <= 16384);

create function public.limit_progress_rows() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- One insert at a time per account, so concurrent ones cannot both slip
  -- under the limit.
  perform pg_advisory_xact_lock(hashtext('progress:' || new.user_id::text));
  if exists (
    select 1 from public.progress
    where user_id = new.user_id and song_id = new.song_id
  ) then
    return new;
  end if;
  if (select count(*) from public.progress where user_id = new.user_id) >= 200
  then
    raise exception 'This account already has progress for 200 songs.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger progress_quota before insert on public.progress
  for each row execute function public.limit_progress_rows();
