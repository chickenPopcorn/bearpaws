# BearPaws · MIDI piano practice

A desktop-first, static piano-learning app built with React, TypeScript, Vite, Canvas, Web MIDI, Web Audio, and local browser storage. Practice in a falling-note studio with teal left-hand notes and lavender right-hand notes. The implementation replaces the simulated design concept in `docs/design/`.

## Run locally

Use Node.js 22.12+ (validated in this environment with Node 24.19) and npm.

```sh
npm ci
npm run dev
```

Open the printed local URL, normally `http://localhost:5173`. Desktop Chrome or Edge is the initial USB MIDI target. Web MIDI requires a secure context: localhost is allowed for development; hosted use requires HTTPS and a permissions policy that allows MIDI.

```sh
npm test               # Deterministic engine, MIDI lifecycle, controller, storage, audio/Canvas checks
python3 -m unittest discover -s tests -p 'test_*.py' # Offline importer and ZIP checks
npm run test:watch     # Watch tests
npm run build          # TypeScript validation and static production build in dist/
npm run preview        # Serve the production build, normally localhost:4173
npm run example        # Regenerate the original downloadable MIDI exercise
npm run midi:build     # Regenerate the beginner MIDI collection (Python 3 for ZIP)
npm run format         # Format source, tests and documentation
```

## Practice

The library includes **15 beginner arrangements**, keeping **Ode to Joy** and
**Dancing Raindrops** and adding familiar melodies such as Mary Had a Little Lamb,
Twinkle, Twinkle, Little Star, London Bridge, Frère Jacques, and Jingle Bells.
Each includes suggested finger numbers on the score, falling notes, active keys
and Wait for me coach, plus starting hand positions. The simplest pieces stay
in C position; melodies with position changes explain the moves. Short themes
and the Jingle Bells chorus are labelled as such. New arrangements use one held
bass note per bar; Dancing Raindrops retains its supplied chords and articulation.
Mama Bear’s Pops includes **好一朵茉莉花 (Jasmine Flower)** as an eight-bar chorus
in C major, with suggested finger numbers and a simple left-hand accompaniment.
It also includes **安静 · 周杰伦 (Silence / An Jing)** as a complete piano MIDI
from [Shaivan’s Online Sequencer upload](https://onlinesequencer.net/1677315).
Its original notes and timing are preserved, with suggested hands split at middle
C and no added finger numbers. The source MIDI is kept in `src/assets/an-jing.mid`
and is available through the song’s individual download, outside the starter pack.

Search the library by title or composer. **Download starter MIDI pack** saves the
15 standard MIDI files as a ZIP; **Download MIDI** saves the selected arrangement.
The files have separate left/right tracks, one full silent count-in bar, tempo,
and finger numbers as text events. The count-in keeps musical downbeats aligned
with barlines. The ZIP also includes a fingering manifest with `countInBeats`.
General MIDI players may ignore these text events; the built-in lessons retain their fingering,
but reimporting a MIDI treats it as an ordinary import without lesson metadata.
The generated collection lives in `public/midi/`; melody references are recorded
in `src/starterPieces.ts` and `src/popsPieces.ts`.
The sheet-music timeline above the waterfall follows the current bar. Accepted
notes fade to 50% opacity in practice modes; Listen marks the notes played by
the reference audio. Disabled hands remain visible at half opacity. Written
rhythms and rests are preserved for the built-in pieces; imported MIDI uses
approximate note values derived from performed timing.
Click a note or drag across the score to change playback position. The focused
score also supports Shift+arrow for a bar and Home/End. Left/Right arrow keys
select the previous/next song in the current collection and start playback,
as do the Previous/Next buttons in full screen. Mode,
restart, playback, speed and time controls share the row above the score.
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
2. Click **Connect piano** to grant MIDI permission the first time. On later visits, saved browser permission automatically connects the first available MIDI input. You can choose a different input when more than one is available. Plugging the selected device back in rebinds it; reconnecting does not resume practice automatically. Browsers without MIDI permission queries keep the Connect button.
3. Import `.mid` / `.midi` files. Assign each note-bearing track to **Left**, **Right**, or **Skip** under _Make it yours_. Multiple-track imports start unassigned. A single-track import starts assigned to Right; a single track cannot be split by pitch in this MVP.
4. Choose **Listen**, **Wait for me**, or **Rhythm**, enable one or both hands, and press Play. Import and Listen work without a piano. Computer shortcuts and clickable on-screen keys also provide practice input.
5. Slow down (25–150%), seek or restart, and set passage boundaries in song seconds using A/B or the numeric fields. Looping is on by default and repeats the full song or selected passage. Turn it off with the loop button; that choice and the passage bounds are remembered for each song.

**Listen** uses browser reference sound. **Wait for me** accepts correct notes up to the selected timing tolerance early and holds the shared timeline at each remaining note/chord until every chord pitch has been pressed and is physically held. Accepting an early note does not jump the timeline forward. Repeated notes need a release and fresh press; a sustain pedal cannot satisfy a physical chord. “Hear next notes” provides a reference without accepting the notes for you.

**Rhythm** keeps moving and matches note onsets using MIDI event timestamps. Timing tolerance is configurable (±120, ±220 or ±350 ms of real time, independent of playback speed). Feedback identifies missed/wrong notes and early/late matched notes; click a missed note to loop a short passage around it. This MVP scores pitch and onset timing, not fingering or held-note duration.

Reference audio coalesces duplicate pitches at the same onset and allows at most 64 active or scheduled voices, including previews. Extremely dense material can omit excess reference voices; MIDI input and scoring remain independent. The waterfall coalesces duplicate note shapes and draws at most 4,096 distinct visible rectangles per frame; the full note set still drives scoring. Recent feedback is limited to 256 entries and six missed-note replay anchors, with full-passage note counts, wrong-press totals and average timing retained separately.

Your physical piano supplies live piano sound. The browser does not echo incoming USB notes; Listen, optional Rhythm reference, and on-screen previews use Accurate-Salamander Grand Piano 6.2a: eight recorded intensity layers of a Yamaha C5, in lossless 24-bit stereo FLAC. The player preserves the source preset’s per-key tuning, attack offsets and volume balance, with natural release tails. Only the recordings needed for the selected notes and velocities load before playback; decoded samples are reused within a 512 MiB cache. Very large selections may need one hand or a shorter loop. The complete bundled sample bank is about 358 MiB, but it is not downloaded in full on page load. No external audio service is contacted. Recording credits, adaptation details and the CC BY 3.0 license are in [the sample credits](public/audio/accurate-salamander/CREDITS.md). Key-down highlights are separate from pedal-sustained sound (teal dots). Switching inputs or disconnecting clears key/pedal state and pauses Wait/Rhythm; Listen continues. Seek/restart and loop transitions clear transient input and cancel scheduled reference audio. Leaving the page hidden pauses playback to avoid invisible practice and background scheduling gaps.

### Piano sound

Open **Piano sound** above the score in either normal or fullscreen view.
**Natural** is the only piano sound, with gentler compression and subtle stereo
room ambience. Adjust **Room** while listening; its level is remembered in this
browser, across songs.
Changes do not restart notes or the practice timeline. Pause, seek and song changes
clear the room tail as well as scheduled notes.

This first tuning pass retains the same eight-layer recordings. The room is a
small synthetic convolution ambience, not additional piano release samples or
physical pedal/string resonance. Full 16-layer playback and sampled resonance
remain separate enhancements.

## Local data and file support

Settings and per-song position, track assignments, passage, number of starts, and best matched-note proportion are stored in localStorage. Best proportion uses all eligible notes in the current passage, including upcoming notes. Imported normalized songs are stored in IndexedDB, keyed by a SHA-256 hash of their contents. Removing a local song removes its stored song/progress. Storage failures show a message and allow session-only use. Browser storage is specific to the origin/browser/profile; clearing it removes your library and progress.

No songs or MIDI input are uploaded. There is no backend, account, analytics, billing, cloud sync, Bluetooth integration, sheet-music recognition, or teacher dashboard.

Standard MIDI formats **0 and 1** with ticks-per-beat division are supported, including tempo changes across tracks, FIFO pairing of overlapping notes, velocity-zero releases, and channel-wide CC64 sustain. Imported notes keep physical release and sound end separately. Format 2 and SMPTE division produce actionable unsupported-file errors. Imports are limited to 10 MB, 256 declared tracks (including empty tracks), 50,000 positive-velocity note attacks, and 500,000 MIDI events. A bounded byte scanner checks both event budgets before the full MIDI parser allocates event objects. Missing note-offs are closed at the track boundary with a warning. Track names do not establish hand assignment; normalized display names are limited to 160 characters. Reference sound does not reproduce General MIDI instruments, effects, or drum kits.

## Architecture

- `src/song.ts`: SMF parsing, validation, binary-search tempo conversion, note normalization, original exercise.
- `src/engine.ts`: deterministic transport, chord grouping, onset matching, and physical/sustained MIDI state.
- `src/audio.ts`: Web Audio clock, timestamp conversion and cancellable reference scheduling.
- `src/midi.ts`: explicit Web MIDI permission/device selection and connection lifecycle.
- `src/controller.ts`: shared practice timeline, transport actions and local progress.
- `src/render.ts`: Canvas waterfall and keyboard using the same pitch geometry.
- `src/storage.ts`: validated settings/progress and IndexedDB song library.
- `src/main.tsx`: Practice studio with the beginner Wait for me coach.
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
