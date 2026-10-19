-- The song library becomes private: only signed-in users read it, through
-- the policy in 20261019150000_signed_in_storage.sql. Its public URLs stop
-- working.
--
-- Apply this only once the app that reads the library as the signed-in user
-- (authenticated Storage requests, src/session.ts) is live on
-- piano.pollos.us, and its earlier pages have expired from browsers (GitHub
-- Pages lets them keep index.html for 10 minutes). The app before it reads
-- the public URLs, and would load no songs.
update storage.buckets set public = false where id = 'library';
