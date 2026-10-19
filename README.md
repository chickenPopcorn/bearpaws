# Paw Pal · MIDI piano practice

A desktop-first, static piano-learning app built with React, TypeScript, Vite, Canvas, Web MIDI, Web Audio, browser storage, and Supabase accounts. Practice in a falling-note studio with teal left-hand notes and lavender right-hand notes. The implementation replaces the simulated design concept in `docs/design/`.

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

The shared library has 27 songs, including **26 beginner arrangements** with **Ode to Joy** and
**Dancing Raindrops** and adding familiar melodies such as Mary Had a Little Lamb,
Twinkle, Twinkle, Little Star, London Bridge, Frère Jacques, and Jingle Bells.
Each includes suggested finger numbers on the score, falling notes, active keys
and Wait for me practice, plus starting hand positions. The simplest pieces stay
in C position; melodies with position changes explain the moves. Short themes
and the Jingle Bells chorus are labelled as such. New arrangements use one held
bass note per bar; Dancing Raindrops retains its supplied chords and articulation.
George Bear’s Classes adds eleven more personal-practice transcriptions from
your piano book, in C and Middle C positions. They keep the student parts'
printed rests, chords, staccato, dynamics, repeat and finger numbers, without
lyrics or teacher duet parts.
Mama Bear’s Pops includes **好一朵茉莉花 (Jasmine Flower)** as an eight-bar chorus
in C major, with suggested finger numbers and a simple left-hand accompaniment.
It also includes **安静 · 周杰伦 (Silence / An Jing)** as a complete piano MIDI
from [Shaivan’s Online Sequencer upload](https://onlinesequencer.net/1677315).
Its original notes and timing are preserved, with suggested hands split at middle
C and no added finger numbers. Its download is the original MIDI file.

Library collections start folded; click one to open it. Searching opens them
all, and moving to a song in another collection opens that one.
Search the library by title or composer. **Download MIDI** saves the selected
arrangement as a standard MIDI file.
The files have separate left/right tracks, one full silent count-in bar, tempo,
and finger numbers as text events. The count-in keeps musical downbeats aligned
with barlines. General MIDI players may ignore these text events; the library
songs retain their fingering, but reimporting a MIDI treats it as an ordinary
import without lesson metadata.

### The song library

The songs live in the public Supabase bucket `library`, not in this repository.
The app loads them after sign-in:

- `index.json` lists the songs in order, with each one's title, collection
  (`classes`, `songs` or `pops`) and file names. Browsers check it on every
  load; it is cached for 60 seconds.
- `songs/<id>.<hash>.json` is each song in the app's format: notes, tracks,
  tempo, suggested fingering and lesson text.
- `songs/<id>.<hash>.mid` is each song's MIDI file, for its Download button.

Each file is named after its content hash and cached for a year, so a repeat
visit downloads only `index.json`; a changed song gets a new name.

To change the library, run `npm run library:pull`, edit `./library` (ignored by
git), then run `npm run library:push`. To add a song, put its MIDI file at
`library/songs/<id>.mid` and add an entry to `library/index.json` with its `id`,
`title`, `collection`, `song: "songs/<id>.json"` and `midi: "songs/<id>.mid"`;
push converts the MIDI into the song file. `./library` uses plain names; push
adds the hashes. Push checks every song before it uploads anything, uploads the
index last, and removes a file only 24 hours after the index stops listing it,
since a browser may still be loading it from an earlier index (`retired.json` in
the bucket records when each file left).
Uploading needs the project's secret key, in `SUPABASE_SECRET_KEY`, or a
Supabase account token in `MUSIC_API_KEY` to look it up. The app itself only
reads the bucket. A copy of three songs in `tests/fixtures/` serves the tests.
The sheet-music timeline above the waterfall follows the current bar. Accepted
notes fade to 50% opacity in practice modes; Listen marks the notes played by
the reference audio. Disabled hands remain visible at half opacity. Written
rhythms and rests are preserved for the built-in pieces; imported MIDI uses
approximate note values derived from performed timing.
Click a note or drag across the score to change playback position. The focused
score also supports Shift+arrow for a bar and Home/End. Left/Right arrow keys
select the previous/next song in the current collection and start playback,
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
opposite hand hides its original fingering; imported MIDI is not assigned
guessed finger numbers.

1. Choose a beginner piece from the library; use **Find a song** to filter it.
2. Click **Connect your piano** in the header to grant MIDI permission the first time; it changes to **Piano connected**. On later visits, saved browser permission automatically connects the first available MIDI input. When more than one input is available, a menu beside it chooses one. If the chosen input is unplugged, clicking Connect your piano picks any available input. Plugging the selected device back in rebinds it; reconnecting does not resume practice automatically. Browsers without MIDI permission queries keep the Connect button.
3. Import `.mid` / `.midi` files. Assign each note-bearing track to **Left**, **Right**, or **Skip** under _Make it yours_. Multiple-track imports start unassigned. A single-track import starts assigned to Right; a single track cannot be split by pitch in this MVP.
4. Choose **Listen**, **Wait for me**, or **Rhythm**, enable one or both hands, and press Play. Import and Listen work without a piano. Computer shortcuts and clickable on-screen keys also provide practice input.
5. Slow down (20–140%, in 20% steps), seek or restart, and set passage boundaries in song seconds using A/B or the numeric fields. Looping is on by default and repeats the full song or selected passage. Turn it off with the loop button; that choice and the passage bounds are remembered for each song.

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
voices follow the imported MIDI's sustain pedal (CC64); built-in lessons have
no pedal, so they use only release harmonics and key noise. See the
[adaptation notes](public/audio/accurate-salamander/LICENSE.md) for how each
voice follows the SFZ preset.

## Accounts, data and file support

Sign-in with Google is required. Supabase (project `pawpal`) holds each user's settings and practice progress, and row-level security limits every row to the user who owns it:

- `settings`: one row per user, the studio settings.
- `progress`: per song, the position, track assignments, passage, number of starts, and best matched-note proportion.
- `practice_sessions`: playing time, one row per page visit per local calendar day, with seconds per song. The browser makes up each session's id and re-sends its running total, so a retried upload never counts twice and practice on two devices adds up.

The practice calendar in the sidebar shows this month: a star on each day with at least 5 minutes of practice, a dot on days with less, and a ring filling up for today. Practice time counts only while a song plays in Wait for me or Rhythm and a key was pressed within the last 15 seconds; Listen, paused time and a Wait gate left waiting do not count. Days follow the device's local calendar, and sign-in loads the last 92 days for the calendar and streak.

The songs themselves come from the shared library (see above), which is the same for everyone and read-only. MIDI files you import are stored only in this browser (IndexedDB, normalized and keyed by a SHA-256 hash of their contents); they are never uploaded and do not appear on other devices. Removing an imported song removes it from the browser and its progress from your account. Signing out keeps imported songs.

The browser keeps the working copy of settings and progress in localStorage, and remembers which changes the account has not confirmed yet. At sign-in those unconfirmed changes upload; everything else takes the account's copy, so no device's clock decides which version wins (the server stamps each write). Changes upload about two seconds after they happen, one upload at a time; a request that takes over 30 seconds is aborted and retried. Signing out uploads waiting changes, then clears this browser's copy of the account's settings and progress; if Supabase cannot end the session, you stay signed in. Best proportion uses all eligible notes in the current passage, including upcoming notes.

MIDI input from your piano is never uploaded. There is no analytics, billing, Bluetooth integration, sheet-music recognition, or teacher dashboard.

The schema is in `supabase/migrations/`. The app needs two public values: the project URL and its publishable key (Supabase dashboard → Project Settings → API Keys). For local development, put them in `.env.local`, which git ignores:

```sh
VITE_SUPABASE_URL=https://ochjekqgxkojrilgsqud.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Deployment reads the same two names from the repository's GitHub Actions variables. The publishable key only allows what row-level security allows; never use the secret key here.

Standard MIDI formats **0 and 1** with ticks-per-beat division are supported, including tempo changes across tracks, FIFO pairing of overlapping notes, velocity-zero releases, and channel-wide CC64 sustain. Imported notes keep physical release and sound end separately. Format 2 and SMPTE division produce actionable unsupported-file errors. Imports are limited to 10 MB, 256 declared tracks (including empty tracks), 50,000 positive-velocity note attacks, and 500,000 MIDI events. A bounded byte scanner checks both event budgets before the full MIDI parser allocates event objects. Missing note-offs are closed at the track boundary with a warning. Track names do not establish hand assignment; normalized display names are limited to 160 characters. Reference sound does not reproduce General MIDI instruments, effects, or drum kits.

## Architecture

- `src/song.ts`: SMF parsing, validation, binary-search tempo conversion, note normalization, original exercise.
- `src/engine.ts`: deterministic transport, chord grouping, onset matching, and physical/sustained MIDI state.
- `src/audio.ts`: Web Audio clock, timestamp conversion and cancellable reference scheduling.
- `src/midi.ts`: explicit Web MIDI permission/device selection and connection lifecycle.
- `src/controller.ts`: shared practice timeline, transport actions and local progress.
- `src/render.ts`: Canvas waterfall and keyboard using the same pitch geometry.
- `src/storage.ts`: validated settings/progress and IndexedDB song library.
- `src/cloud.ts`, `src/supabase.ts`, `src/SignIn.tsx`: Google sign-in and account sync.
- `src/library.ts`, `scripts/library.mjs`: the shared song library and its pull/push script.
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
