# Development

[← Back to the README](../README.md)

Paw Pal is a desktop-first, static piano-learning app built with React, TypeScript, Vite, Canvas, Web MIDI, Web Audio, browser storage, and Supabase accounts with Google sign-in. Practice in a falling-note studio with teal left-hand notes and lavender right-hand notes. The implementation replaces the simulated design concept in `docs/design/`; the reference images and HTML there remain unchanged.

## Run locally

Use Node.js 22.13+ (validated in this environment with Node 24.19) and npm. Put the Supabase values in `.env.local` first (see [Supabase setup](accounts.md#supabase-setup)).

```sh
npm ci
npm run dev
```

Open the printed local URL, normally `http://localhost:5173`. Desktop Chrome or Edge is the initial USB MIDI target. Web MIDI requires a secure context: localhost is allowed for development; hosted use requires HTTPS and a permissions policy that allows MIDI.

```sh
npm test               # Deterministic engine, MIDI lifecycle, controller, storage, audio/Canvas checks
python3 -m unittest discover -s tests -p 'test_*.py' # Offline sample importer checks
npm run test:watch     # Watch tests
npm run test:coverage  # Tests with a coverage report in coverage/; fails below the floor in vite.config.ts
npm run test:e2e       # Browser tests of the production build (see below)
npm run lint           # ESLint: TypeScript and React hook rules
npm run format:check   # Check formatting without writing
npm run build          # TypeScript validation and static production build in dist/
npm run preview        # Serve the production build, normally localhost:4173
npm run example        # Regenerate the original downloadable MIDI exercise
npm run library:pull   # Download the shared song library into ./library
npm run library:push   # Check ./library and upload it to the library bucket
npm run cd-audio:push -- <folder>  # Upload the course CD's MP3 files to the cd-audio bucket
npm run format         # Format source, tests and documentation
```

## Browser tests

`npm run test:e2e` builds the app into `e2e/.dist`, serves it on port 4174
and drives it in Chromium with Playwright: Google sign-in and sign-out, the
library and search, settings from and to the account, Listen and Wait for me
practice, the course CD's story, a workbook page, a library that fails to
load, and the one studio tab. The first run needs the browser: `npx playwright install
chromium`. The build talks to a fake Supabase project that
`e2e/fake-supabase.ts` answers inside the browser, with the three fixture
songs as the library, so the tests need no account or network. Like Storage, the fake answers library requests only when they carry
the signed-in user's access token. It answers the `cd-audio` bucket the same
way, with a cut-down manifest and generated silence for the CD's tracks.

The **E2E tests** workflow runs them in the merge queue only, on the merged
result. Pull requests show the check as skipped, so it can be a required
check; it can also be run by hand from the Actions tab.

## Architecture

- `src/song.ts`: SMF parsing, validation, binary-search tempo conversion, note normalization, original exercise.
- `src/engine.ts`: deterministic transport, chord grouping, onset matching, and physical/sustained MIDI state.
- `src/audio.ts`: Web Audio clock, timestamp conversion and cancellable laptop playback scheduling.
- `src/midi.ts`: explicit Web MIDI permission/device selection, automatic output choice and connection lifecycle.
- `src/midiPlayer.ts`: the app's sound on a MIDI output, on the 20 ms practice clock.
- `src/metronome.ts`: the beat grid from the tempo map and time signatures, the count-in, and its clicks on the laptop.
- `src/controller.ts`: shared practice timeline, transport actions and local progress.
- `src/render.ts`: Canvas waterfall and keyboard using the same pitch geometry.
- `src/storage.ts`: validated settings and progress.
- `src/library.ts`, `scripts/library.mjs`: the shared song library and its pull/push script.
- `scripts/cd-audio.mjs`: uploads the course CD's audio; `scripts/supabase-admin.mjs`: the secret-key client both scripts use.
- `src/story.ts`: the CD's story before each piece of Lesson Book 3, for the Story button.
- `src/supabase.ts`, `src/SignIn.tsx`: Google sign-in, and `signedInFetch` for Storage that only signed-in users read.
- `src/cloud.ts`, `src/studioClaim.ts`: account sync, one studio tab at a time.
- `src/main.tsx`, `src/session.ts`: page startup, and sign-in through to the open studio.
- `src/App.tsx`: Practice studio: library, practice controls, piano and score.
- `src/notation.ts` and `src/SheetTimeline.tsx`: score layout, scrolling and seeking.
- `src/usePianoFullscreen.ts`: fullscreen entry, autoplay callback and focus restoration.
- `src/workbook.ts`: Music Workbook 3's pages, the paint game, the piano's control keys and page stamps.
- `src/workbookHold.ts`: the workbook's Hold It! game, timing held keys and rests by the laptop's metronome.
- `src/WorkbookScreen.tsx`, `src/WorkbookPicture.tsx`, `src/workbookKeyboard.ts`: a workbook page, its Color by Note picture and its three-zone keyboard.

Once audio is unlocked, AudioContext time is the musical clock; MIDI event timestamps are mapped from the performance clock into it. Transport position is derived from anchors and speed, never accumulated frame deltas. Rendering, audio scheduling and scoring use that timeline. Audio uses a short look-ahead and cancels on discontinuities. Timestamp history preserves event positions across speed changes; queued events from before a seek/song/loop reset are excluded from the new passage. Rhythm reconciles a delayed in-window timestamp even if the current clock already marked that note missed.
