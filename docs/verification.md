# Verification record

Updated October 18, 2026 for the Accurate-Salamander optional voices: sampled
release, key release noise, pedal noise and pseudo pedal resonance.

## Automated checks

- `npm test`: 787 tests across 31 suites passed.
- `python3 -m unittest discover -s tests -p 'test_*.py'`: the offline importer tests passed.
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
activation, score-slider shortcuts, loop preference persistence, and search
casing remains consistent across browser locales.
The 27 library songs live in the Supabase `library` bucket. Tests check the
library index and song validation, loading with content hashes, collections,
and clear failures for missing files, using three fixture songs. `npm run
library:push` validates every song before uploading; a round trip through
`library:pull` returned identical files, and adding a song from a MIDI file
converted, uploaded and later removed it.

The sample bank contains 641 lossless FLACs, about 753 MiB compressed: 480 note
recordings and 161 for the optional voices (69 release harmonics, 88 key
release noises and 4 pedal noises, about 30 MiB). The importer fetched them with
the same ZIP CRC and SHA-256 checks, and the tests verify every hash against the
recorded source metadata. Runtime loading remains selective, with a 512 MiB
decoded cache limit; a full-bank download is not needed to open the page. The
CI artifact includes the complete bank, and the built site is about 792 MB.

The optional voice tests cover the manifest's regions for each voice (key and
velocity ranges, sample roots, volumes, `rt_decay`, pedal conditions and the
pedal-noise random split) and the SFZ trigger rules: release harmonics only for
a key released with the pedal up, key noise at every key-up, resonance only for
notes struck with the pedal down and damped with them, and pedal noise at each
press and lift, cut by the next change. Player tests cover each voice's start
time, level and damping, turning each voice off, speed changes (including
`rt_decay` over the real time a key was held), a voice due where playback
starts or a full lookahead after a stall, key and pedal lifts at the end of a
loop pass but not at its start, lift noise cut by the next pass's press, a lift
and press at one instant on one channel or across two, a press and lift at one
instant, resonance damped after its attack when its note ends sooner, pitches
beyond the piano, notes released together decayed by the shorter hold,
duplicate tracks struck together released once at the last key-up (with only
the last keys' pedal holding back harmonics), strict alternation of the pedal
recordings, voices
taken only from the prepared passage, the event cache released on stop, a
press still down at the end ringing out, song length reaching the last pedal
action,
resonance for a note struck where playback starts, no pedal lift or release
harmonics where a file ends with the pedal down, stopping a voice turned off
(including sources waiting to start), restarting a passage still loading when a
voice is turned off, and the voice budget: optional voices take at most half
of the 64 voices, never a note's voice, and give up theirs first to a note,
including voices still waiting to start.
Loading tests cover lazy loading of only the enabled voices' recordings, none
for previews, a failed optional download, and optional recordings that do not
fit the memory limit leaving playback unaffected.

The sound tests cover preference migration and validation, live updates without
restarting playback or cancelling sample preparation, one shared sound bus,
deterministic sample-rate-aware stereo room responses, post-mix peak protection,
reuse of the room processor across short automatic loops, room-tail flushing,
and recovery after allocation failures. Legacy sound-profile selections are
discarded while their room amount is preserved. Natural is the only sound path.

## Local browser checks

The optional voices were checked in the in-app browser on the Vite development
server. **Piano sound** lists the four **Recorded details**, all on. Listening
to Ode to Joy fetched only its notes' recordings and their key-noise and
release-harmonic files. A generated MIDI with four pedalled chords also fetched
the pedal noises and the softest-layer recordings that resonance uses.
Instrumenting `AudioBufferSourceNode.start` showed resonance copies at plus and
minus three semitones with each pedalled note, key noise at each key-up,
harmonics only at the pedal-up release, and alternating pedal press and lift
noises. The console showed no errors. This confirms scheduling, not subjective
sound quality, which still needs a listening check through speakers or
headphones.

The Natural sound development build was checked at `http://127.0.0.1:4189/`:
Room adjustments kept playback running; the room preference is global; the native sound popover remains visible in fullscreen; Escape
closes it without leaving fullscreen, including after keyboard focus moves
to another toolbar control. Initial native OfflineAudioContext renders at
`b7267de` compared the
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
individual MIDI files.

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
