# Verification record

Updated October 16, 2026 for the sampled-piano and practice-studio changes.

## Automated checks

- `npm test`: 343 tests across 20 suites passed.
- `python3 -m unittest discover -s tests -p 'test_*.py'`: 4 offline importer tests passed.
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

The sample bank contains 240 lossless FLACs, about 358 MiB compressed. Checks
verify all hashes against the recorded source metadata. Runtime loading remains
selective, with a 512 MiB decoded cache limit; a full-bank download is not needed
to open the page. The CI artifact includes the complete bank.

## Local browser checks

Desktop Chrome at `http://127.0.0.1:5173/` was used to check:

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
