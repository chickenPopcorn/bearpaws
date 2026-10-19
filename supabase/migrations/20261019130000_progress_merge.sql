-- Progress from two devices merges on the server, so a late upload from one
-- device never undoes practice saved from another: the best score and the
-- number of starts only grow, and the rest (position, passage, hands) follows
-- whichever copy was saved later.

create function public.merge_progress() returns trigger
language plpgsql set search_path = '' as $$
declare
  best numeric := greatest(
    case when jsonb_typeof(old.data->'best') = 'number'
      then (old.data->>'best')::numeric else 0 end,
    case when jsonb_typeof(new.data->'best') = 'number'
      then (new.data->>'best')::numeric else 0 end);
  attempts numeric := greatest(
    case when jsonb_typeof(old.data->'attempts') = 'number'
      then (old.data->>'attempts')::numeric else 0 end,
    case when jsonb_typeof(new.data->'attempts') = 'number'
      then (new.data->>'attempts')::numeric else 0 end);
begin
  if coalesce(old.data->>'updated', '') > coalesce(new.data->>'updated', '') then
    new.data := old.data;
  end if;
  new.data := new.data || jsonb_build_object('best', best, 'attempts', attempts);
  return new;
end;
$$;

create trigger progress_merge before update on public.progress
  for each row execute function public.merge_progress();
