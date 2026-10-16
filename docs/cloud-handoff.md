# Cloud development handoff

## Outcome and architecture

Build an actual browser piano-learning app using the visual references in `design/`. Use TypeScript + Vite + React for the static app, Canvas for the waterfall/keyboard, Web MIDI for piano input, and Web Audio for listening playback and the shared musical clock. No backend, accounts, billing, or cloud sync is needed for the MVP.

The existing HTML is a concept fragment with simulated connection and practice behavior. Use it for appearance and interaction direction; implement the real app separately. The PNGs show the Practice studio and Guided lesson concepts.

## Milestones

1. **Connection and waterfall:** Add explicit Connect piano permission flow and an input-device picker for desktop Chrome/Edge. Handle note on/off, velocity-zero note off, CC64 sustain, disconnects, and reconnection without stuck keys. Import standard MIDI songs, preserve tempo-map changes, normalize note start/duration onto a deterministic timeline, and draw notes aligned to the on-screen keyboard. Let users assign MIDI tracks to left/right hands and select either hand or both.
2. **Practice engine:** Implement Listen, Wait for me, and Rhythm modes. Listen plays the song; Wait for me pauses at the next selected-hand note/chord until played; Rhythm runs continuously and provides note/timing feedback. Support speed adjustment, seek, restart, and a selectable passage loop. Use the same timeline for audio, graphics, and matching; animation frames must not advance musical time. Feedback should be forgiving, with a visible timing-tolerance setting. Physical key release and pedal-sustained sound should remain distinct.
3. **Local progress and Sites:** Save settings and per-song practice progress locally. Provide a small review of missed notes and timing, then make replaying a passage easy. Prepare the static production build for ChatGPT Sites and test USB MIDI permission/input at its actual published HTTPS URL in Chrome/Edge. Report local checks, cloud checks, deployment, and hardware verification separately.

## Implementation boundaries

- Keep MIDI parsing/tempo conversion, transport, note matching, and rendering separate enough to test independently.
- Support MIDI files with an explicit tempo map and use the MIDI default tempo when none is supplied. Explain unsupported or malformed files without crashing.
- Track names do not prove hand assignment; expose an explicit assignment UI instead of relying on automatic guesses.
- Request MIDI access only after a user action. Show actionable states for unsupported browser, denied permission, no device, and disconnected device. Import and Listen should remain usable without a piano.
- Treat USB MIDI input as local, low-latency events. Use their event timestamps for timing feedback; do not claim zero latency or require server round trips for practice.
- Use browser storage for settings and progress; imported files stay local. Avoid adding external song catalogs, licensing-dependent material, or services to this MVP.

## Acceptance checks

- Meaningful automated checks cover tempo changes, tick-to-time conversion, note pairing and chords, speed changes, pause/seek/loop behavior, and correct/wrong/early/late note matching.
- Synthetic MIDI input verifies velocity-zero note off, sustain press/release, repeated notes, hand selection, chord gating, disconnect cleanup, and no stuck notes after seek/restart.
- Browser checks cover importing a fixture song, smooth waterfall/keyboard alignment, all three practice modes, timing-tolerance changes, passage looping, and progress surviving reload.
- Exercise denied permissions, unsupported Web MIDI, malformed MIDI, and device disconnection through simulated or controlled browser tests where feasible.
- Verify the production static build. Test Web MIDI at the published Sites URL, including permission policy restrictions; local development success alone is insufficient.
- A person must connect the physical USB piano locally and test notes, chords, sustain, listening, and both practice modes. Until then, report physical hardware compatibility as unverified. A cloud agent cannot substitute synthetic MIDI tests for this check.

## Scope defaults

Desktop Chrome/Edge and USB MIDI are the initial target. The piano can provide its own live sound; browser audio supports Listen and reference playback. No mobile/Bluetooth promise, sheet-music recognition, lesson-authoring system, subscriptions, or teacher dashboard is included. Build a usable practice studio before expanding guided lessons.
