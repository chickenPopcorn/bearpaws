-- The shared song library. Anyone can read it through its public URLs;
-- only `npm run library:push`, using the project's secret key, writes to it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'library', 'library', true, 5242880,
  array['application/json', 'audio/midi']
);
