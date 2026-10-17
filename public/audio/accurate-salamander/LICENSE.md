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

This app uses eight of the original sixteen attack layers: 1, 3, 5, 7, 9, 11, 13,
and 16. All 88 key mappings retain the live preset's per-key pitch correction,
sample root, offset, volume, and release settings. The velocity boundaries are
adapted to cover the reduced layer set; they are midpoints between the centres of
the selected original layers. Velocity 1 is silent in the upstream live preset.

The FLAC audio files are byte-for-byte unchanged from the official nominal 48 kHz,
24-bit stereo release, including slight per-sample rate adjustments used for
tuning. File names replace `#` with `s` for browser URLs. The app's playback
engine is a browser adaptation, not a complete SFZ player: optional sampled
release, hammer and pedal noise, and SFZ pedal-resonance voices are not included.

Reproduce the import with `python3 scripts/fetch-accurate-salamander.py` from the
repository root. It downloads selected archive members with HTTP range requests,
checks their original ZIP CRCs, and records SHA-256 checksums. Existing valid
files are reused, and the full archive is not downloaded.
