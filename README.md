# Cadence · MIDI piano practice

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
npm run test:watch     # Watch tests
npm run build          # TypeScript validation and static production build in dist/
npm run preview        # Serve the production build, normally localhost:4173
npm run example        # Regenerate the original downloadable MIDI exercise
npm run format         # Format source, tests and documentation
```

## Practice

1. Start with **First steps**, an original exercise included in the app. A downloadable standard MIDI copy is at `public/examples/first-steps.mid` and in the library sidebar.
2. Click **Connect piano** to request MIDI permission. Choose an input when more than one is available. No permission is requested at page load. Plugging the selected device back in rebinds it; reconnecting does not resume practice automatically.
3. Import `.mid` / `.midi` files. Assign each note-bearing track to **Left**, **Right**, or **Skip** under _Make it yours_. Multiple-track imports start unassigned. A single-track import starts assigned to Right; a single track cannot be split by pitch in this MVP.
4. Choose **Listen**, **Wait for me**, or **Rhythm**, enable one or both hands, and press Play. Import and Listen work without a piano. Computer shortcuts and clickable on-screen keys also provide practice input.
5. Slow down (25–150%), seek or restart, and set passage boundaries in song seconds using A/B or the numeric fields. Enable the loop button to repeat that passage.

**Listen** uses browser reference sound. **Wait for me** holds the shared timeline at each selected note/chord until every chord pitch has been pressed and is physically held. Repeated notes need a release and fresh press; a sustain pedal cannot satisfy a physical chord. “Hear next notes” provides a reference without accepting the notes for you.

**Rhythm** keeps moving and matches note onsets using MIDI event timestamps. Timing tolerance is configurable (±120, ±220 or ±350 ms of real time, independent of playback speed). Feedback identifies missed/wrong notes and early/late matched notes; click a missed note to loop a short passage around it. This MVP scores pitch and onset timing, not fingering or held-note duration.

Your physical piano supplies live piano sound. The browser does not echo incoming USB notes; it supplies a simple synthesized reference for Listen, optional Rhythm reference, and on-screen previews. Key-down highlights are separate from pedal-sustained sound (teal dots). Switching inputs or disconnecting clears key/pedal state and pauses Wait/Rhythm; Listen continues. Seek/restart and loop transitions clear transient input and cancel scheduled reference audio. Leaving the page hidden pauses playback to avoid invisible practice and background scheduling gaps.

## Local data and file support

Settings and per-song position, track assignments, passage, number of starts, and best matched-note proportion are stored in localStorage. Best proportion uses all eligible notes in the current passage, including upcoming notes. Imported normalized songs are stored in IndexedDB, keyed by a SHA-256 hash of their contents. Removing a local song removes its stored song/progress. Storage failures show a message and allow session-only use. Browser storage is specific to the origin/browser/profile; clearing it removes your library and progress.

No songs or MIDI input are uploaded. There is no backend, account, analytics, billing, cloud sync, Bluetooth integration, sheet-music recognition, or teacher dashboard.

Standard MIDI formats **0 and 1** with ticks-per-beat division are supported, including tempo changes across tracks, FIFO pairing of overlapping notes, velocity-zero releases, and channel-wide CC64 sustain. Imported notes keep physical release and sound end separately. Format 2 and SMPTE division produce actionable unsupported-file errors. Imports are limited to 10 MB, 50,000 positive-velocity note attacks, and 500,000 MIDI events. A bounded byte scanner checks both event budgets before the full MIDI parser allocates event objects. Missing note-offs are closed at the track boundary with a warning. Track names do not establish hand assignment. Reference sound does not reproduce General MIDI instruments, effects, or drum kits.

## Architecture

- `src/song.ts`: SMF parsing, validation, binary-search tempo conversion, note normalization, original exercise.
- `src/engine.ts`: deterministic transport, chord grouping, onset matching, and physical/sustained MIDI state.
- `src/audio.ts`: Web Audio clock, timestamp conversion and cancellable reference scheduling.
- `src/midi.ts`: explicit Web MIDI permission/device selection and connection lifecycle.
- `src/controller.ts`: shared practice timeline, transport actions and local progress.
- `src/render.ts`: Canvas waterfall and keyboard using the same pitch geometry.
- `src/storage.ts`: validated settings/progress and IndexedDB song library.
- `src/main.tsx`: compact Practice studio with the beginner Wait for me coach.

Once audio is unlocked, AudioContext time is the musical clock; MIDI event timestamps are mapped from the performance clock into it. Transport position is derived from anchors and speed, never accumulated frame deltas. Rendering, audio scheduling and scoring use that timeline. Audio uses a short look-ahead and cancels on discontinuities. Timestamp history preserves event positions across speed changes; queued events from before a seek/song/loop reset are excluded from the new passage. Rhythm reconciles a delayed in-window timestamp even if the current clock already marked that note missed.

## Verification and deployment

See [docs/verification.md](docs/verification.md) for checks run, limitations, and the local hardware acceptance procedure.

The production output is the static `dist/` directory. The GitHub checks workflow uploads that directory and the hosting manifest as a `cadence-static` artifact after a successful CI build. `.openai/hosting.json` declares it for ChatGPT Sites. Sites registration was attempted but failed with `Project owner is not linked to an account`; no project ID or deployed URL was returned. **Deployment is pending**, with a prepared static archive. After account linkage is repaired, create an owner-private Site, persist its returned project ID, synchronize the exact source commit, package `.openai/hosting.json` plus `dist/`, and deploy that saved version privately.

Interactive browser QA was unavailable because this session exposed no browser-control tool. Fake Canvas/AudioContext and synthetic MIDI tests are not real browser or USB hardware validation. **Web MIDI at a published URL and the actual USB piano remain unverified.** Do not infer hardware compatibility from passing automated tests.

The reference images and HTML remain unchanged in `docs/design/`. The repository is delivered on a feature branch for a draft PR; it is not merged into main.
