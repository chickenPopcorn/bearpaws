# Accurate-Salamander Grand Piano 6.2a

The audio recordings and upstream SFZ mapping are licensed under
[Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/).
See the [full license](https://creativecommons.org/licenses/by/3.0/legalcode).

- Original Salamander Grand Piano recordings and original SFZ: **Alexander Holm**.
- Accurate-Salamander remastering and SFZ: **Chisato Yamauchi** and the
  [Accurate-Salamander Project](https://www.ir.isas.jaxa.jp/~cyamauch/AccurateSalamander/).
- Version 6 piano retuning: **Hiroharu Narikawa**.

The unmodified upstream README and recommended live SFZ are preserved in `source/`.
The exact source archive, member names, sizes, and checksums are recorded there.

## Browser adaptation

This app uses all sixteen original attack layers. All 88 key mappings retain the
live preset's velocity bands and per-key pitch correction, sample root, offset,
volume, and release settings. Velocity 1 is silent in the upstream live preset.

The FLAC audio files are byte-for-byte unchanged from the official nominal 48 kHz,
24-bit stereo release, including slight per-sample rate adjustments used for
tuning. File names replace `#` with `s` for browser URLs. The app's playback
engine is a browser adaptation, not a complete SFZ player.

### Optional voices

The live preset includes four voices that are off by default (`set_cc20` to
`set_cc23` are 0). This app includes all four, on by default, and each can be
turned off. They add 161 FLAC files (about 30 MiB); pedal resonance reuses the
note recordings. Their regions keep the preset's key and velocity ranges,
sample roots, tuning, volumes and `group_volume`, `rt_decay`, attack and
`off_time`. Each voice plays at the level its controller sets at 127, where
`volume_onccN` lowers it by 0 dB; the preset lowers it by up to 12 dB at lower
values. The adaptations are:

- **Sampled release** (CC20, `harmL`, `harmS`, `harmV3`): string harmonics at
  key-up, only when the sustain pedal is up (`hicc64=32`). The app treats the
  pedal as up when a note's sound ends with its key and no pedal is still down
  where the file ends. Each recording plays to
  its end, less `rt_decay` for each second the note sounded before its key-up,
  in real time, so speed changes count.
- **Hammer noise** (CC21, `rel1` to `rel88`): the key's release noise at every
  key-up, pedal or not (`trigger=release_key`), unpitched.
- **Pedal noise** (CC22, `pedalD1`, `pedalD2`, `pedalU1`, `pedalU2`): sounds at
  each sustain-pedal press and lift. The preset triggers these only at CC64
  values of exactly 127 and 0; the app uses each press and lift of its CC64
  threshold of 64, merges all channels into one pedal, and alternates the two
  recordings of each kind in a fixed pattern instead of drawing at random. The
  next pedal change cuts the previous noise after `off_time` (0.1 s). The
  noise has no key velocity, so it plays at its group volume. A file that ends
  with the pedal down has no lift noise.
- **Pseudo pedal resonance** (CC23): a note struck with the pedal down
  (`locc64=22`) adds one or two softest-layer recordings of neighbouring
  strings, retuned to the struck key, with a 50 ms attack. They are damped
  with the note, rather than by the preset's CC64 release curve. A note that
  playback or a loop pass starts partway through is struck again with its
  resonance.

Half pedalling is not modelled: the pedal is either down or up. A key or pedal
that comes up exactly as a loop pass ends still sounds in that pass; one that
comes up exactly as playback or a pass begins belongs to the music before it. Optional voices
take at most half of the 64 voices, never take a voice from a note, and give up
their own first when a note needs one. Their recordings load with a passage's
notes, and only those that fit within the decoded-sample memory limit load.

Reproduce the import with `python3 scripts/fetch-accurate-salamander.py` from the
repository root. It downloads selected archive members with HTTP range requests,
checks their original ZIP CRCs, and records SHA-256 checksums. Existing valid
files are reused, and the full archive is not downloaded.
