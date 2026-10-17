# Verification record

Updated October 17, 2026 for the BearPaws library, practice controls, full An Jing arrangement, and Natural piano sound.

## Automated checks

- `npm test`: 456 tests across 26 suites passed.
- `python3 -m unittest discover -s tests -p 'test_*.py'`: 6 offline importer and ZIP tests passed.
- `npm run build`: TypeScript validation and the Vite production build passed.
- `node scripts/check-built-fonts.mjs`: all three built fonts resolve under a nested deployment path.
- `npm audit --audit-level=moderate`: no known vulnerabilities reported after updating the test runner.
- `git diff --check`: passed.

Coverage includes MIDI permissions and reconnect races; event timestamps and
inclusive timing boundaries at every supported speed/tolerance; stale async
play/preview cancellation; decoded-sample cache and voice limits; retention of
active recordings through speed, seek and loop changes; repeated loop edits and
sustained notes at loop boundaries; quiet-mode startup without sample loading;
cancelled downloads/decodes and same-file retries within the memory limit;
recovery from unrelated sample-loading failures; complete
soundbank hashes and SFZ mappings; atomic importer publication; score scrolling,
seeking geometry and label bounds; hand-guide preferences; fullscreen fallback,
Escape, focus restoration, tab trapping and audio-before-fullscreen ordering.
Imported 3/4, 6/8 and changing meters are verified through parsing, score layout,
displayed signatures, keyboard seeking and the waterfall beat grid.
The library checks cover collection search and selection, native keyboard
activation, score-slider shortcuts, loop preference persistence, all 15 MIDI
exports and catalog entries, and exact ZIP contents with CRC verification.
ZIP bytes remain identical when source timestamps, permissions or file creation
order change, and search casing remains consistent across browser locales.
Exported pieces use a full-bar count-in to retain musical bar alignment.
The full An Jing arrangement preserves all 1,369 source notes and original
timing/velocities, with suggested hands split at middle C. Tests cover saved
selection, separate-hand practice, all score notes, and seeking across the
99-measure arrangement. A real export in a temporary workspace verifies the
original MIDI download and byte-identical regeneration of the 15-song starter
pack; full arrangements remain outside that pack.

The sample bank contains 240 lossless FLACs, about 358 MiB compressed. Checks
verify all hashes against the recorded source metadata. Runtime loading remains
selective, with a 512 MiB decoded cache limit; a full-bank download is not needed
to open the page. The CI artifact includes the complete bank.

The sound tests cover preference migration and validation, live updates without
restarting playback or cancelling sample preparation, one shared sound bus,
deterministic sample-rate-aware stereo room responses, post-mix peak protection,
room-tail flushing, and recovery after allocation failures.

## Local browser checks

The Natural sound development build was checked at `http://127.0.0.1:4189/`:
Natural/Original switches and Room adjustments kept playback running; preferences
are global; the native sound popover remains visible in fullscreen; Escape
closes it without leaving fullscreen. A native OfflineAudioContext rendered the
same Ode passage through both sound profiles and a 64-voice chord with maximum
room. All three renders had finite samples and no samples exceeding full scale
(peak levels approximately -6.91, -7.00 and -0.04 dBFS respectively). These are
measurements of those fixtures, not a universal true-peak guarantee or a claim
of subjective sound quality. The comparison WAVs use the same recordings and
input gain, without loudness normalization.

The preceding production build was checked in the in-app browser at
`http://127.0.0.1:4188/nested/piano/`: composer search finds An Jing, the source
credit and individual download are visible, fullscreen starts practice, and
score seeking reaches the last of 99 measures.

The preceding production build was checked at
`http://127.0.0.1:4187/nested/piano/`: the logo and MIDI downloads resolve below
the deployment path; accent-insensitive search finds Frère Jacques; Enter
activates library controls; score arrows seek without changing songs; and the
fullscreen controls remain visible. HTTP checks returned 200 for the logo,
individual MIDI files and ZIP.

Earlier desktop Chrome checks at `http://127.0.0.1:5173/` covered:

- Automatic connection to `USB func for MIDI MIDI IN 1` after refresh, without
  clicking Connect piano again.
- Fullscreen entry starts the selected practice mode. Score/waterfall and
  playback controls remain visible; Escape returns to the page.
- Score seeking, centered note/finger labels, dimmed played notes and disabled
  hands, and the flat note styling with subtle shadows.
- The optional bear-paw guide, saved separately in each browser, retains its
  selection after refresh. Its animation includes a shared pause and honors
  reduced-motion settings.

Connected-device status confirms the input opened; it is not a claim that every
physical key, velocity, pedal and latency path has been verified. Automated MIDI
and audio tests use controlled events and fake AudioContext implementations.

## Remaining hardware and deployment checks

At a published HTTPS origin, verify its MIDI permissions policy and repeat the
local-browser checks. Public deployment has not been completed; earlier Sites
registration returned `Project owner is not linked to an account`.

With the physical piano, check chords, repeated-note releases, CC64 sustain,
disconnect/reconnect while holding keys, and timing feedback at multiple speeds.
Confirm there are no stuck inputs and reconnection does not start practice by
itself. Check reference audio through the intended speakers/headphones.

The GitHub PR's CI and review results are tracked on the PR; local success is
not a substitute for those checks passing on its final revision.
