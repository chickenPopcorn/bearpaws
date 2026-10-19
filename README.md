# Paw Pal · MIDI piano practice

A desktop-first, static piano-learning app built with React, TypeScript, Vite, Canvas, Web MIDI, Web Audio, browser storage, and Supabase accounts with Google sign-in. Practice in a falling-note studio with teal left-hand notes and lavender right-hand notes. The implementation replaces the simulated design concept in `docs/design/`.

## Run locally

Use Node.js 22.12+ (validated in this environment with Node 24.19) and npm.

```sh
npm ci
npm run dev
```

Open the printed local URL, normally `http://localhost:5173`. Desktop Chrome or Edge is the initial USB MIDI target. Web MIDI requires a secure context: localhost is allowed for development; hosted use requires HTTPS and a permissions policy that allows MIDI.

```sh
npm test               # Deterministic engine, MIDI lifecycle, controller, storage, audio/Canvas checks
python3 -m unittest discover -s tests -p 'test_*.py' # Offline sample importer checks
npm run test:watch     # Watch tests
npm run build          # TypeScript validation and static production build in dist/
npm run preview        # Serve the production build, normally localhost:4173
npm run example        # Regenerate the original downloadable MIDI exercise
npm run library:pull   # Download the shared song library into ./library
npm run library:push   # Check ./library and upload it to the library bucket
npm run format         # Format source, tests and documentation
```

## Practice

Paw Pal is for one learner: the library is **George Bear’s Classes**, one
section per class book of _Music for Little Mozarts_:

- **Music Recital Book 3**: all 21 personal-practice pieces in the book (pages
  4–31), in C and Middle C positions. Dancing Raindrops keeps its supplied
  chords and articulation. The other twenty are transcriptions that keep the
  student parts' printed rests, chords, staccato, dynamics, repeats and finger
  numbers, without lyrics. Each piece also has its printed teacher duet.
- **Music Lesson Book 3**: all 42 pieces in the book (pages 5–47), in C and
  Middle C positions, transcribed the same way, each with its printed teacher
  duet.

Each song includes suggested finger numbers on the score, falling notes, active
keys and Wait for me practice, plus starting hand positions. The library
bucket (below) holds every song, its book and the order within each book.

Books start folded; click one to open it. Searching opens them all, and moving
to a song in another book opens that one.
Search the classes by title or composer. **Download MIDI** saves the selected
song as a standard MIDI file.
The files have separate left/right tracks, one full silent count-in bar, tempo,
and finger numbers as text events. The count-in keeps musical downbeats aligned
with barlines. General MIDI players may ignore these text events.

### The song library

The songs live in the public Supabase bucket `library`, not in this repository.
The app loads them after sign-in:

- `index.json` lists the songs in order, with each one's title, collection
  (`classes`, `songs` or `pops`) and file names. The app loads only `classes`,
  George Bear’s Classes; the bucket also keeps the other two collections. A
  `classes` song may name its `book`: `recital-3` (the default) or `lesson-3`.
  Browsers check the index on every load; it is cached for 60 seconds.
- `songs/<id>.<hash>.json` is each song in the app's format: notes, tracks,
  tempo, suggested fingering and lesson text, and for Recital Book 3 the
  teacher duet (`duet`: its notes, and how many octaves the student part moves
  with it).
- `songs/<id>.<hash>.mid` is each song's MIDI file, for its Download button.

Each file is named after its content hash and cached for a year, so a repeat
visit downloads only `index.json`; a changed song gets a new name.

To change the library, run `npm run library:pull`, edit `./library` (ignored by
git), then run `npm run library:push`. To add a song, put its MIDI file at
`library/songs/<id>.mid` and add an entry to `library/index.json` with its `id`,
`title`, `collection: "classes"`, an optional `book`, `song: "songs/<id>.json"`
and `midi: "songs/<id>.mid"`; push converts the MIDI into the song file. Each
song file records the hash of the MIDI file it was built from (`sourceMidi`),
and push refuses a MIDI file that a song file was not built from. `./library`
uses plain names; push adds the hashes. Push checks every song (and the 5 MiB
file limit) before it uploads anything, uploads the index last, and removes a
file only 24 hours after the index stops listing it, since a browser may still
be loading it from an earlier index (`retired.json` in the bucket records when
each file left). Uploading needs the project's secret key, in
`SUPABASE_SECRET_KEY`, or a Supabase account token in `MUSIC_API_KEY` to look it
up. The app itself only reads the bucket. A copy of three songs in
`tests/fixtures/` serves the tests.

The sheet-music timeline above the waterfall follows the current bar. Accepted
notes fade to 50% opacity in practice modes; Listen marks the notes played by
the reference audio. Disabled hands remain visible at half opacity. Written
rhythms and rests are preserved for the lessons; a song built from plain MIDI
uses approximate note values derived from performed timing.
Click a note or drag across the score to change playback position. The focused
score also supports Shift+arrow for a bar and Home/End. Left/Right arrow keys
select the previous/next song in the current book and start playback,
as do the Previous/Next buttons in full screen. Mode,
restart, playback, speed, time and full-screen controls share the row above the
score.
Full screen expands the score and waterfall and starts the selected practice
mode. Enter opens full screen and starts playback; it also resumes a paused
full-screen session. Space pauses or resumes in either view. These
shortcuts stay inactive while editing a field. Escape returns to the page;
playback controls remain available in either view. The finger guide always shows
animated bear paws directly from the source, with no saved display preference.
Reduced-motion settings disable their animation.
On both hands, 1 means thumb and 5 means little finger. Changing a track to the
opposite hand hides its original fingering; a song built from plain MIDI gets
no guessed finger numbers.

1. Choose a piece from George Bear’s Classes; use **Find a song** to filter them.
2. Click **Connect your piano** in the header to grant MIDI permission the first time; it changes to **Piano connected**. On later visits, saved browser permission automatically connects the first available MIDI input. When more than one input is available, a menu beside it chooses one. If the chosen input is unplugged, clicking Connect your piano picks any available input. Plugging the selected device back in rebinds it; reconnecting does not resume practice automatically. Browsers without MIDI permission queries keep the Connect button.
3. Choose **Listen**, **Wait for me**, or **Rhythm**, enable one or both hands, and press Play. Listen works without a piano. Computer shortcuts and clickable on-screen keys also provide practice input. Turn on **Duet** beside the hands to hear the book's teacher part play along. As the book asks, the student part then usually moves up one octave; some pieces move it up two octaves or down one, and a few keep it as written. The waterfall, keyboard shortcuts and finger guide follow it, and the score keeps the written notes under an 8va, 15ma or 8vb mark. The waterfall shows the duet in yellow at quarter opacity behind your notes, and widens its keyboard to fit it; the duet is never fingered or scored, and Wait for me holds it at each of your notes until you play them.
4. Slow down (20–140%, in 20% steps), seek or restart, and set passage boundaries in song seconds using A/B or the numeric fields. Looping is on by default and repeats the full song or selected passage. Turn it off with the loop button; that choice and the passage bounds are remembered for each song.

**Listen** uses browser reference sound. **Wait for me** accepts correct notes up to the selected timing tolerance early and holds the shared timeline at each remaining note/chord until every chord pitch has been pressed and is physically held. Accepting an early note does not jump the timeline forward. Repeated notes need a release and fresh press; a sustain pedal cannot satisfy a physical chord. The keys to play are highlighted on the keyboard and the score, and announced to screen readers.

**Rhythm** keeps moving and matches note onsets using MIDI event timestamps. Timing tolerance is configurable (±120, ±220 or ±350 ms of real time, independent of playback speed). Feedback identifies missed/wrong notes and early/late matched notes; click a missed note to loop a short passage around it. This MVP scores pitch and onset timing, not fingering or held-note duration.

Reference audio coalesces duplicate pitches at the same onset and allows at most 64 active or scheduled voices, including previews. Extremely dense material can omit excess reference voices; MIDI input and scoring remain independent. The waterfall coalesces duplicate note shapes and draws at most 4,096 distinct visible rectangles per frame; the full note set still drives scoring. Recent feedback is limited to 256 entries and six missed-note replay anchors, with full-passage note counts, wrong-press totals and average timing retained separately.

Your physical piano supplies live piano sound. The browser does not echo incoming USB notes; Listen, optional Rhythm reference, and on-screen previews use Accurate-Salamander Grand Piano 6.2a: all sixteen recorded intensity layers of a Yamaha C5, in lossless 24-bit stereo FLAC. The player preserves the source preset’s per-key tuning, attack offsets and volume balance, with natural release tails. Only the recordings needed for the selected notes and velocities load before playback; decoded samples are reused within a 512 MiB cache. Very large selections may need one hand or a shorter loop. The player also includes the preset's optional recorded details: string harmonics when a key is released with the pedal up, key release noise, pedal noise, and pseudo pedal resonance for notes struck with the pedal down. These load only for the notes and pedal changes that trigger them. The complete bundled sample bank is about 753 MiB, but it is not downloaded in full on page load. No external audio service is contacted. Recording credits, adaptation details and the CC BY 3.0 license are in [the sample credits](public/audio/accurate-salamander/CREDITS.md). Key-down highlights are separate from pedal-sustained sound (teal dots). Switching inputs or disconnecting clears key/pedal state and pauses Wait/Rhythm; Listen continues. Seek/restart and loop transitions clear transient input and cancel scheduled reference audio. Leaving the page hidden pauses playback to avoid invisible practice and background scheduling gaps.

### Piano sound

Open **Piano sound** in the settings row below the keyboard, beside Note names.
**Natural** is the only piano sound, with gentler compression and subtle stereo
room ambience. Adjust **Room** while listening; its level is remembered in this
browser, across songs.
Changes do not restart notes or the practice timeline. Pause, seek and song changes
clear the room tail as well as scheduled notes.

Playback uses all sixteen recorded layers. The room is a small synthetic
convolution ambience. Under **Recorded details**, turn the preset's optional
release harmonics, key release noise, pedal noise and pedal resonance on or
off; these are remembered in this browser. Turning one off stops it at once.
Turning one on during playback restarts playback at the same place so that its
recordings can load. These
voices follow a song's sustain pedal (CC64); built-in lessons have
no pedal, so they use only release harmonics and key noise. See the
[adaptation notes](public/audio/accurate-salamander/LICENSE.md) for how each
voice follows the SFZ preset.

## Accounts, data and file support

Sign-in with Google is required to open the studio. Supabase (project `pawpal`) handles the sign-in and returns to the page it started from; it only returns to addresses in the project's redirect allow list (`https://piano.pollos.us/**` and localhost). **Sign out** in the header signs out this browser only; other devices stay signed in.

Supabase holds each user's settings and practice progress, and row-level security limits every row to the user who owns it:

- `settings`: one row per user, the studio settings.
- `progress`: per song, the position, track assignments, passage, number of starts, and best matched-note proportion. Each account keeps at most 200 songs' progress, 16 KiB each (`progress_quota`), which a direct Data API caller cannot exceed either.

The account is the record. At sign-in the browser takes the account's settings and progress (the first account on a browser also takes progress saved there before sign-in, where the account has none). Changes upload about two seconds after they happen, one upload at a time; a failed upload stays queued in localStorage, survives a reload and is retried, and a request that takes over 30 seconds is aborted. The server merges progress uploads (`progress_merge` trigger): the best proportion and the number of starts only grow, and position, passage and hands follow whichever copy was saved later, so a late upload from one device never undoes practice from another. Only one tab runs the studio at a time; another tab offers to move it there. Signing out uploads what is waiting first and asks before dropping anything that could not upload; it then clears this browser's copy of the account's settings and progress (the calendar's practice history stays on the browser). Signing in with a different account clears the previous one's copy, including anything it had not uploaded. Best proportion uses all eligible notes in the current passage, including upcoming notes.

The songs come from the shared library bucket (see above), the same for everyone and read-only. The app has no MIDI import. Songs imported by earlier versions stay in this browser's IndexedDB, untouched; the app no longer reads them. MIDI input from your piano is never uploaded. There is no analytics, billing, Bluetooth integration, sheet-music recognition, or teacher dashboard.

The app needs two public values: the Supabase project URL and its publishable key (Supabase dashboard → Project Settings → API Keys). For local development, put them in `.env.local`, which git ignores:

```sh
VITE_SUPABASE_URL=https://ochjekqgxkojrilgsqud.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Deployment reads the same two names from the repository's GitHub Actions variables. The publishable key only allows what row-level security allows; never use the secret key here. The schema, including the bucket, is in `supabase/migrations/`.

After a refresh, the page as it was left shows again at once, but only while this browser still holds an unexpired sign-in for the same account (`index.html`, `src/reloadSnapshot.ts`).

The practice calendar at the top of the sidebar shows this month: a star on each day that met the daily goal, a dot on days with less, and a ring filling up for today, with the current streak. The goal is 5 minutes unless changed under **Edit** (5, 10, 15, 20 or 30), where the learner's name can also be set for the calendar's praise. Practice time counts only while a song plays in Wait for me or Rhythm and a key was pressed within the last 15 seconds; Listen, paused time and a Wait gate left waiting do not count. Days follow the device's local calendar. Playing time is kept in localStorage as sessions, one per page visit per day with seconds per song, for the last 92 days, today included. Each session has its own key, written only by the tab that plays it, so tabs on the same browser add up without overwriting each other.

`npm run library:push` converts library MIDI files with the app's parser. Standard MIDI formats **0 and 1** with ticks-per-beat division are supported, including tempo changes across tracks, FIFO pairing of overlapping notes, velocity-zero releases, and channel-wide CC64 sustain. Converted notes keep physical release and sound end separately. Format 2 and SMPTE division produce actionable unsupported-file errors. MIDI files are limited to 10 MB, 256 declared tracks (including empty tracks), 50,000 positive-velocity note attacks, and 500,000 MIDI events. A bounded byte scanner checks both event budgets before the full MIDI parser allocates event objects. Missing note-offs are closed at the track boundary with a warning. Track names do not establish hand assignment; normalized display names are limited to 160 characters. Reference sound does not reproduce General MIDI instruments, effects, or drum kits.

## Architecture

- `src/song.ts`: SMF parsing, validation, binary-search tempo conversion, note normalization, original exercise.
- `src/engine.ts`: deterministic transport, chord grouping, onset matching, and physical/sustained MIDI state.
- `src/audio.ts`: Web Audio clock, timestamp conversion and cancellable reference scheduling.
- `src/midi.ts`: explicit Web MIDI permission/device selection and connection lifecycle.
- `src/controller.ts`: shared practice timeline, transport actions and local progress.
- `src/render.ts`: Canvas waterfall and keyboard using the same pitch geometry.
- `src/storage.ts`: validated settings and progress.
- `src/library.ts`, `scripts/library.mjs`: the shared song library and its pull/push script.
- `src/supabase.ts`, `src/SignIn.tsx`: Google sign-in.
- `src/cloud.ts`, `src/studioClaim.ts`: account sync, one studio tab at a time.
- `src/main.tsx`: Practice studio: library, practice controls, piano and score.
- `src/notation.ts` and `src/SheetTimeline.tsx`: score layout, scrolling and seeking.
- `src/usePianoFullscreen.ts`: fullscreen entry, autoplay callback and focus restoration.

Once audio is unlocked, AudioContext time is the musical clock; MIDI event timestamps are mapped from the performance clock into it. Transport position is derived from anchors and speed, never accumulated frame deltas. Rendering, audio scheduling and scoring use that timeline. Audio uses a short look-ahead and cancels on discontinuities. Timestamp history preserves event positions across speed changes; queued events from before a seek/song/loop reset are excluded from the new passage. Rhythm reconciles a delayed in-window timestamp even if the current clock already marked that note missed.

## Verification and deployment

See [docs/verification.md](docs/verification.md) for checks run, limitations, and the local hardware acceptance procedure.

The production output is the static `dist/` directory. GitHub Pages deployment is
prepared for **https://piano.pollos.us/**: the Pages workflow validates and deploys
pushes to `main`, and Cloudflare supplies the subdomain’s DNS record. See
[the GitHub Pages setup](docs/github-pages.md) for the one-time repository settings,
exact DNS record, HTTPS and verification steps. **Deployment is pending**; these
changes do not enable Pages or update DNS on their own.

The separate checks workflow still uploads `dist/` and `.openai/hosting.json` as a
`cadence-static` artifact. That manifest remains available for ChatGPT Sites;
the earlier Sites registration attempt returned `Project owner is not linked to
an account`, with no deployed URL.

Local Chrome verification confirmed automatic connection to the available USB MIDI
input after refresh, fullscreen autoplay, score seeking and the bear-paw guide.
This does not establish end-to-end physical-key timing or published-origin MIDI
compatibility. See the verification document for that distinction.

The reference images and HTML remain unchanged in `docs/design/`.

### Play the teacher duet on a USB piano

In desktop Chrome or Edge, connect a piano that exposes a MIDI **output** as well
as an input. Choose **Connect your piano**, then choose that piano under
**Duet sound**. Turn **Duet** on and press Play. The teacher part goes to the
selected output on the same MIDI channel as the latest key played on the piano
(channel 1 until the first keypress); the student's physical keys remain live on
the piano. The teacher still waits at each **Wait for me** gate and resumes when
the student plays the requested note. Laptop mute does not mute MIDI output.
Choose **Laptop** to return the teacher part to browser audio. If the piano's
output disconnects or cannot open, playback stops and **Duet sound** goes back
to Laptop; choose the piano again to retry.

Keep the piano’s local keyboard sound enabled. The teacher follows the incoming
piano channel automatically, so no separate multichannel setup is needed.
Disable any MIDI-thru/loopback routing that returns outgoing teacher notes as
input. The app sends only teacher notes, not student echoes. A repeated note
that overlaps the one before it is played again, as written. The app sends
note-offs for its own sounding notes on pause, seek, loop restart, song/output
changes, and closing the studio, and closes an output it stops using. Teacher
notes go out on the 20 ms practice clock: each tick releases the notes it has
passed and strikes the ones it has reached, and a tick that runs late still
plays the notes it passed, for one tick. Hardware latency and piano sound depend
on the device. Output selection
is per session and requires an explicit choice. Test on the physical piano to
confirm its channel settings, tone, timing, and note releases.
