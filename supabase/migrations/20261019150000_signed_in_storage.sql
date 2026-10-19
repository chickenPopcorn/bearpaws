-- The song library and the course CD's audio are for signed-in users only.
--
-- Signed in means a session this project issued: the `authenticated` role.
-- Sign-up is open to every Google account, so this keeps the files from
-- visitors who have not signed in, not from strangers who sign in with
-- Google. Anonymous sessions also get the `authenticated` role; anonymous
-- sign-ins are off, and these policies leave such sessions out anyway.
-- Only the project's secret key (the scripts in scripts/) writes to either
-- bucket.
--
-- `cd-audio` is private from the start. `library` stays public for now, so
-- the app that reads its public URLs keeps working; the app that reads it as
-- the signed-in user goes through the policy below.
-- 20261019160000_private_library.sql then makes it private.

-- The MP3 files of the course CD, and a manifest of its tracks
-- (`npm run cd-audio:push`).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cd-audio', 'cd-audio', false, 20971520,
  array['audio/mpeg', 'application/json']
);

create policy "Signed-in users read the song library" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'library'
    and (select (auth.jwt() ->> 'is_anonymous')::boolean) is not true
  );

create policy "Signed-in users read the CD audio" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cd-audio'
    and (select (auth.jwt() ->> 'is_anonymous')::boolean) is not true
  );
