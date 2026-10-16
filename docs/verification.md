# Verification record

Validated in the cloud environment on 2026-10-16. All checks below distinguish synthetic execution from actual browser/device validation.

| Check                     | State                   | Evidence / limit                                                                                                                                                                                          |
| ------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automated tests           | Passed                  | 117 passing Vitest tests in 9 suites: engine/import, MIDI lifecycle, controller integration, storage validation, fake Canvas and Web Audio scheduling.                                                    |
| Tempo conversion          | Passed                  | Default tempo, nonzero first change, conductor-track changes, chronological normalization and historical timestamp mapping.                                                                               |
| Pairing and chords        | Passed                  | Overlapping same-pitch FIFO pairs, channels, velocity-zero releases, simultaneous/repeated notes and duplicate selected-track pitches.                                                                    |
| Transport                 | Passed                  | Clock-driven sparse/dense updates, speed, pause/resume, seek/restart, loop overshoot and pending Wait gates across dropped frames.                                                                        |
| Note/timing matching      | Passed                  | Correct/wrong/early/late notes, configurable real-time tolerance at different speeds, delayed timestamp reconciliation and pre-seek exclusion.                                                            |
| Wait for me               | Passed (synthetic)      | Whole physical chord, no pedal substitution, fresh repeated presses, separate hands, pause/seek/loop reset.                                                                                               |
| Sustain and lifecycle     | Passed (synthetic)      | CC64/channel isolation, physical vs sounding notes, selection/disconnect cleanup, reconnect, stale handler rejection, denied/unsupported/no-device/open failure states.                                   |
| Persistence               | Passed (synthetic)      | Song selection restoration, settings/progress, assignments, passage, quota/invalid-storage handling. IndexedDB persistence still needs real-browser QA.                                                   |
| Production build          | Passed                  | TypeScript check and Vite static bundle.                                                                                                                                                                  |
| Production HTTP smoke     | Pending final packaging | Static preview, HTML/assets/example fixture requests. This is not interactive browser QA.                                                                                                                 |
| Interactive browser QA    | Unavailable             | No browser-control/JS tool exposed in this session. No claim about real Canvas rendering, browser audio, permission prompts, or reload behavior in a browser.                                             |
| Sites private deployment  | Blocked / pending       | Native Sites registration returned `SitesConnectorError: Project owner is not linked to an account` (`INVALID_ARGUMENT`, project invariant error). No Site ID/URL returned; no retry with an invented ID. |
| Published-origin Web MIDI | Unverified              | Requires successful publication and a local Chrome/Edge check at that exact HTTPS URL, including permissions policy.                                                                                      |
| Physical USB piano        | Unverified              | No actual USB piano is attached to this cloud environment. Synthetic events cannot establish hardware compatibility.                                                                                      |

## Local browser and hardware acceptance

After private deployment, open the exact published URL in local desktop Chrome/Edge:

1. Import `public/examples/first-steps.mid` without a piano. Assign the two tracks explicitly, use Listen, verify notes align to keys and audio, change speed, seek/restart, and select A/B passage looping.
2. Reload. Confirm the imported song, selection, position, assignments, speed, tolerance and passage survive. Deny storage in a controlled session and confirm the session-only message.
3. Click Connect piano; test denied permission, then allow MIDI in site settings and retry. Check any iframe/host MIDI permissions policy. Select the real USB input and press individual notes, varying velocity.
4. Play chords and repeated notes in Wait for me. Hold one chord tone, release it, play another: the gate must wait for the complete physically held chord. Repeated notes need release/re-press even with pedal down. Test one hand, then both.
5. Use Rhythm at several speeds/tolerances. Check plausible early/late/missed feedback. Replay a missed-note passage. Verify playback and waterfall remain aligned after a brief dropped-frame/stall condition.
6. Press CC64, release a key, then release the pedal. Physical key highlight should release immediately; pedal-sustained indication should clear with the pedal. Listen reference must stop on pause/seek/restart.
7. Unplug while holding notes and pedal. Verify no stuck input, practice pauses, a clear disconnected message appears, and reconnect/select accepts fresh notes without automatically resuming. Listen should continue without the device.
8. Test malformed files, no-device state, and a browser without Web MIDI. Import/Listen must remain usable. Check keyboard-only controls, narrow desktop layout, and accessibility labels.

Record browser/OS, piano model, connection/driver, published URL, date, and each result before marking hardware or published Web MIDI verified.

## Codex review follow-up

Codex code review of `623e165` completed with six findings; its security review completed with no findings. The follow-up adds early bounded import scanning, cached hand selection, correct pass reset when pausing/changing speed across a loop boundary, timestamp-based Wait gating, best-effort progress cleanup after song deletion, and cancellation of stale asynchronous Play requests. A follow-up regression also verifies that delayed input during the first Wait gate after a loop wrap is accepted; the pass is re-anchored at its actual clock boundary. New regression cases pass in the 117-test suite. Review of the follow-up commit is requested separately; the PR remains a draft.

Permanent merge enforcement is not configured. GitHub returned a private-repository ruleset plan restriction (Pro required) and denied this integration access to branch-protection administration. Draft status blocks the current PR while it remains a draft; marking it ready is not protected by a required Codex check.

Codex code review of `11f7d9a` identified four additional resource-bound findings. Follow-up limits declared tracks to 256 before parsing, caches tempo bounds between frames, coalesces duplicate reference attacks with a 64-voice cap, and retains at most 256 detailed feedback entries while preserving aggregate totals. Tests cover 65,535-track input rejection, 50,000 simultaneous note attacks, audio allocation failure, repeated cached draws, 10,000 wrong physical presses and full-session timing/miss reconciliation. These are synthetic resource-bound tests, not browser or hardware verification. Canvas rendering additionally coalesces duplicate geometry, caps visible note rectangles at 4,096 per frame, and caches Wait-group membership while retaining complete active keyboard pitches. Dense 50,000-note fixtures verify these limits. Fresh review is requested for the follow-up head.
