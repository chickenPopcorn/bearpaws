# Accounts and data

[← Back to the README](../README.md)

## Sign-in

Sign-in with Google is required to open the studio. Supabase (project `pawpal`) handles the sign-in and returns to the page it started from; it only returns to addresses in the project's redirect allow list (`https://piano.pollos.us/**` and localhost). **Sign out** in the header signs out this browser only; other devices stay signed in.

Any Google account can sign in: sign-up is open, and no list limits it to particular accounts. Everything that needs sign-in, including the song library and the course CD's audio, is therefore open to anyone with a Google account who signs in.

## What the account keeps

Supabase holds each user's settings and practice progress, and row-level security limits every row to the user who owns it:

- `settings`: one row per user, the studio settings.
- `progress`: per song, the position, track assignments, passage, number of starts, and best matched-note proportion. Each account keeps at most 200 songs' progress, 16 KiB each (`progress_quota`), which a direct Data API caller cannot exceed either.

The account is the record. At sign-in the browser takes the account's settings and progress (the first account on a browser also takes progress saved there before sign-in, where the account has none). Changes upload about two seconds after they happen, one upload at a time; a failed upload stays queued in localStorage, survives a reload and is retried, and a request that takes over 30 seconds is aborted. The server merges progress uploads (`progress_merge` trigger): the best proportion and the number of starts only grow, and position, passage and hands follow whichever copy was saved later, so a late upload from one device never undoes practice from another. Only one tab runs the studio at a time; another tab offers to move it there. Signing out uploads what is waiting first and asks before dropping anything that could not upload; it then clears this browser's copy of the account's settings and progress (the calendar's practice history stays on the browser). Signing in with a different account clears the previous one's copy, including anything it had not uploaded. Best proportion uses all eligible notes in the current passage, including upcoming notes.

The songs come from the shared library bucket (see [the song library](library.md)), the same for everyone, read-only, and readable only when signed in. The app has no MIDI import. Songs imported by earlier versions stay in this browser's IndexedDB, untouched; the app no longer reads them. MIDI input from your piano is never uploaded. There is no analytics, billing, Bluetooth integration, sheet-music recognition, or teacher dashboard.

After a refresh, the page as it was left shows again at once, but only while this browser still holds an unexpired sign-in for the same account (`index.html`, `src/reloadSnapshot.ts`).

## Supabase setup

The app needs two public values: the Supabase project URL and its publishable key (Supabase dashboard → Project Settings → API Keys). For local development, put them in `.env.local`, which git ignores:

```sh
VITE_SUPABASE_URL=https://ochjekqgxkojrilgsqud.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Deployment reads the same two names from the repository's GitHub Actions variables. The publishable key only allows what row-level security allows; never use the secret key here. The schema, including the buckets and who can read them, is in `supabase/migrations/`. Nothing applies the migrations automatically: run each new one's SQL once, in order, in the Supabase dashboard's SQL Editor or through the Management API (`POST https://api.supabase.com/v1/projects/ochjekqgxkojrilgsqud/database/query` with an account token). `20261019160000_private_library.sql` waits for the app that reads the library as the signed-in user; see [the song library](library.md#who-can-read-the-buckets).
