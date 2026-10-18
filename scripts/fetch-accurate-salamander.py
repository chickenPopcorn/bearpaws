#!/usr/bin/env python3
"""Fetch a pinned, lossless sixteen-layer Accurate-Salamander browser bank.

Includes the preset's optional voices: sampled release, hammer (key release)
noise, pedal noise and pseudo pedal resonance.

Uses HTTP ranges to extract only selected ZIP members. The archive is never
downloaded in full. Python 3 standard library only; reruns verify/reuse files.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
import struct
import time
import urllib.request
import zlib


ARCHIVE_URL = (
    "https://archive.org/download/httpswww.ir.isas.jaxa.jpcyamauchaccuratesalamander/"
    "AccurateSalamanderGrandPianoV6.2a_48khz24bit_flac.zip"
)
ARCHIVE_BYTES = 784289077
SFZ_MEMBER = "sfz_live/Accurate-SalamanderGrandPiano_flat.Recommended.sfz"
# Every recorded attack layer, with the live preset's own velocity bands.
# MIDI velocity 1 is silent in that preset.
SOURCE_LAYERS = list(range(1, 17))
# Voices the preset leaves off (set_cc=0), keyed by the controller that
# enables each one: (manifest name, SFZ label, expected region count).
OPTIONAL_VOICES = {
    20: ("release", "Sampled Release", 69),
    21: ("keyNoise", "Hammer Noise", 88),
    22: ("pedalNoise", "Pedal Noise", 4),
    23: ("resonance", "Pedal Resonance", 135),
}
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "public/audio/accurate-salamander"


def get_range(url, start, end):
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={
                "Range": f"bytes={start}-{end}",
                "User-Agent": "Cadence-MIDI-Accurate-Salamander-import/1.0",
            })
            with urllib.request.urlopen(request, timeout=90) as response:
                if response.status != 206:
                    raise ValueError(f"Server ignored byte range: HTTP {response.status}")
                data = response.read()
                if len(data) != end - start + 1:
                    raise ValueError("Incomplete byte range")
                return data
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def read_index(url):
    tail = get_range(url, ARCHIVE_BYTES - 131072, ARCHIVE_BYTES - 1)
    position = tail.rfind(b"PK\x05\x06")
    if position < 0:
        raise ValueError("ZIP end record missing")
    end = struct.unpack("<4s4H2LH", tail[position:position + 22])
    count, length, offset = end[4:7]
    central = get_range(url, offset, offset + length - 1)
    result = {}
    position = 0
    while position < len(central):
        fields = struct.unpack("<4s6H3L5H2L", central[position:position + 46])
        if fields[0] != b"PK\x01\x02":
            raise ValueError("Unexpected ZIP central directory signature")
        name_length, extra_length, comment_length = fields[10:13]
        name = central[position + 46:position + 46 + name_length].decode("utf-8")
        result[name] = {
            "compressed": fields[8], "size": fields[9], "compression": fields[4],
            "crc32": fields[7], "offset": fields[16],
        }
        position += 46 + name_length + extra_length + comment_length
    if len(result) != count:
        raise ValueError("Incomplete ZIP central directory")
    return result


def extract_member(url, name, entry):
    # This archive has short local headers; reserve 1024 bytes for name/extra.
    start = entry["offset"]
    data = get_range(url, start, min(start + entry["compressed"] + 1023, ARCHIVE_BYTES - 1))
    header = struct.unpack("<4s5H3L2H", data[:30])
    if header[0] != b"PK\x03\x04":
        raise ValueError(f"Missing local header: {name}")
    body_start = 30 + header[-2] + header[-1]
    body = data[body_start:body_start + entry["compressed"]]
    if len(body) != entry["compressed"]:
        raise ValueError(f"Unexpected large ZIP local header: {name}")
    if entry["compression"] == 8:
        body = zlib.decompress(body, -15)
    elif entry["compression"] != 0:
        raise ValueError(f"Unsupported ZIP compression: {name}")
    verify(body, entry, name)
    return body


def verify(data, entry, name):
    if len(data) != entry["size"] or zlib.crc32(data) != entry["crc32"]:
        raise ValueError(f"ZIP size/CRC mismatch: {name}")


def browser_filename(name):
    return name.rsplit("/", 1)[-1].replace("#", "s")


def flac_info(data):
    if data[:4] != b"fLaC" or data[4] & 0x7f != 0 or int.from_bytes(data[5:8], "big") != 34:
        raise ValueError("FLAC STREAMINFO block missing")
    packed = int.from_bytes(data[18:26], "big")
    sample_rate = packed >> 44
    channels = ((packed >> 41) & 7) + 1
    bit_depth = ((packed >> 36) & 31) + 1
    frames = packed & ((1 << 36) - 1)
    # Upstream embeds part of the tuning in slightly adjusted sample rates.
    # Preserve those original headers; decoding resamples them correctly.
    if not 40000 <= sample_rate <= 60000 or channels != 2 or bit_depth != 24 or frames == 0:
        raise ValueError("Unexpected FLAC sample format")
    return {"duration": frames / sample_rate, "channels": channels,
            "sampleRate": sample_rate, "bitDepth": bit_depth, "bytes": len(data)}


def optional_region(voice, merged, file):
    """One region of a voice the preset leaves off by default (see OPTIONAL_VOICES)."""
    trigger = merged.get("trigger", "attack")
    if "on_locc64" in merged:
        # Pedal noise starts on a pedal change rather than on a key.
        trigger = "pedalDown" if int(merged["on_locc64"]) >= 64 else "pedalUp"
    # The CC64 range a key-triggered region needs: resonance only sounds with
    # the pedal down (locc64=22), sampled release only with it up (hicc64=32).
    key_triggered = trigger in ("attack", "release", "release_key")
    pedal = None
    if key_triggered:
        if int(merged.get("locc64", 0)) > 0:
            pedal = "down"
        elif int(merged.get("hicc64", 127)) < 64:
            pedal = "up"
    # Pedal noise has no key to track.
    keytrack = float(merged.get("pitch_keytrack", 100)) if key_triggered else 0
    if keytrack not in (0, 100):
        raise ValueError(f"Unsupported pitch_keytrack={keytrack}: {file}")
    return {
        "voice": voice, "group": int(merged.get("group", 0)), "trigger": trigger,
        "pedal": pedal,
        "pitchMin": int(merged.get("lokey", 0)), "pitchMax": int(merged.get("hikey", 127)),
        "velocityMin": int(merged.get("lovel", 0)), "velocityMax": int(merged.get("hivel", 127)),
        "randomMin": float(merged.get("lorand", 0)), "randomMax": float(merged.get("hirand", 1)),
        "file": file,
        # Without key tracking the recording plays at its own pitch.
        "rootPitch": int(merged.get("pitch_keycenter", 60)) if keytrack else None,
        "tune": float(merged.get("tune", 0)),
        "offsetFrames": int(merged.get("offset", 0)),
        "offset": int(merged.get("offset", 0)) / 48000,
        # SFZ adds a group's group_volume to the region's own volume.
        "gainDb": float(merged.get("volume", 0)) + float(merged.get("group_volume", 0)),
        "attackSeconds": float(merged.get("ampeg_attack", 0)),
        "releaseSeconds": float(merged.get("ampeg_release", .5)),
        # off_time: how fast off_by silences the other pedal noise.
        "cutSeconds": float(merged.get("off_time", .5)),
        "decayDbPerSecond": float(merged.get("rt_decay", 0)),
    }


def build_manifest(sfz):
    # Strip comments before reading opcodes, especially commented offset maths.
    sfz = re.sub(r"//[^\n]*", "", sfz)
    global_opcodes, master, group = {}, {}, {}
    regions = []
    optional = {voice: [] for voice, *_ in OPTIONAL_VOICES.values()}
    controls, controller_gain = {}, {}
    for section, body in re.findall(r"<(\w+)>([^<]*)", sfz):
        values = dict(re.findall(r"(\w+)=([^\s]+)", body))
        if section == "control":
            controls = values
        elif section == "global":
            global_opcodes = values
        elif section == "master":
            master, group = values, {}
        elif section == "group":
            group = values
        elif section == "region":
            merged = {**global_opcodes, **master, **group, **values}
            source_name = merged.get("sample", "").replace("\\", "/").removeprefix("../")
            # The release, noise and resonance groups are each enabled by
            # their own controller (locc20..23); the notes need none.
            enabled_by = [cc for cc in OPTIONAL_VOICES if f"locc{cc}" in merged]
            if enabled_by:
                cc = enabled_by[0]
                voice = OPTIONAL_VOICES[cc][0]
                if merged.get(f"volume_curvecc{cc}") != "2":
                    raise ValueError(f"Expected a 1-to-0 level curve on CC{cc}")
                gain = float(merged[f"volume_oncc{cc}"])
                if controller_gain.setdefault(voice, gain) != gain:
                    raise ValueError(f"Inconsistent CC{cc} level")
                optional[voice].append(optional_region(voice, merged, browser_filename(source_name)))
                continue
            match = re.search(r"v(\d+)\.flac$", source_name)
            if not match or int(match[1]) not in SOURCE_LAYERS:
                continue
            layer = int(match[1])
            if merged["lokey"] != merged["hikey"]:
                raise ValueError("Expected exact, per-key SFZ mapping")
            regions.append({
                "pitch": int(merged["lokey"]),
                "velocityMin": int(merged["lovel"]),
                "velocityMax": int(merged.get("hivel", 127)),
                "sourceLayer": layer, "file": browser_filename(source_name),
                "rootPitch": int(merged["pitch_keycenter"]),
                "tune": float(merged.get("tune", 0)),
                "offsetFrames": int(merged.get("offset", 0)),
                "offset": int(merged.get("offset", 0)) / 48000,
                "gainDb": float(merged.get("volume", 0)),
                "releaseSeconds": float(merged.get("ampeg_release", .5)),
            })
    if len(regions) != 88 * len(SOURCE_LAYERS):
        raise ValueError(f"Expected {88 * len(SOURCE_LAYERS)} regions, got {len(regions)}")
    for pitch in range(21, 109):
        if [r["sourceLayer"] for r in regions if r["pitch"] == pitch] != SOURCE_LAYERS:
            raise ValueError(f"Incomplete key: {pitch}")
    voices = {}
    note_files = {r["file"] for r in regions}
    for cc, (voice, label, count) in OPTIONAL_VOICES.items():
        if len(optional[voice]) != count:
            raise ValueError(f"Expected {count} {voice} regions, got {len(optional[voice])}")
        if voice == "resonance" and not {r["file"] for r in optional[voice]} <= note_files:
            raise ValueError("Pedal resonance must reuse the note recordings")
        voices[voice] = {
            "label": label, "controller": cc,
            # Off by default upstream (set_cc=0). Any value 1..127 enables the
            # voice; volume_oncc/curve 2 then lowers it from 0 dB at 127.
            "defaultController": int(controls.get(f"set_cc{cc}", 0)),
            "controllerGainDb": controller_gain[voice],
            "regions": optional[voice],
        }
    return {
        "name": "Accurate-Salamander Grand Piano", "version": "6.2a",
        "sampleRate": 48000, "bitDepth": 24, "format": "FLAC",
        "sourceUrl": "https://www.ir.isas.jaxa.jp/~cyamauch/AccurateSalamander/",
        "archiveUrl": ARCHIVE_URL, "sourcePreset": SFZ_MEMBER,
        "license": "CC-BY-3.0",
        "amplitudeVelocityTracking": 98.5,
        "sourceLayers": SOURCE_LAYERS, "regions": regions,
        "optionalVoices": voices,
    }


def all_regions(manifest):
    """The note regions, then every optional voice's regions."""
    return manifest["regions"] + [
        region for voice in manifest["optionalVoices"].values() for region in voice["regions"]
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--metadata-only", action="store_true",
                        help="write source metadata without replacing the playable manifest")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    # Resolve the canonical download URL once so individual range requests do
    # not each pay the redirect round trip.
    with urllib.request.urlopen(urllib.request.Request(ARCHIVE_URL, method="HEAD"), timeout=90) as response:
        if int(response.headers["Content-Length"]) != ARCHIVE_BYTES:
            raise ValueError("Pinned archive size changed; review source before importing")
        url = response.url
    index = read_index(url)
    sfz = extract_member(url, SFZ_MEMBER, index[SFZ_MEMBER])
    manifest = build_manifest(sfz.decode("utf-8"))
    wanted = {r["file"] for r in all_regions(manifest)}
    sample_entries = {name: entry for name, entry in index.items()
                      if name.startswith("48khz24bit/") and browser_filename(name) in wanted}
    if len(sample_entries) != len(wanted):
        raise ValueError(f"Expected {len(wanted)} unique samples, got {len(sample_entries)}")
    total = sum(entry["size"] for entry in sample_entries.values())
    print(f"{len(manifest['regions'])} key/velocity regions, {len(sample_entries)} FLAC samples, {total:,} bytes", flush=True)
    if args.dry_run:
        return
    output = args.output.resolve()
    source = output / "source"
    source.mkdir(parents=True, exist_ok=True)
    (source / Path(SFZ_MEMBER).name).write_bytes(sfz)
    (source / "README-upstream.txt").write_bytes(extract_member(url, "README.txt", index["README.txt"]))
    provenance = {"archiveUrl": ARCHIVE_URL, "archiveBytes": ARCHIVE_BYTES,
                  "files": {browser_filename(name): {"member": name, **entry}
                            for name, entry in sample_entries.items()}}
    (source / "archive-members.json").write_text(json.dumps(provenance, indent=2) + "\n")
    if args.metadata_only:
        # These offsets still use the nominal sample rate. The playable bank
        # needs each FLAC header's corrected rate and must remain intact.
        (source / "regions.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
        return

    def fetch(item):
        name, entry = item
        path = output / browser_filename(name)
        reused = False
        if path.exists():
            data = path.read_bytes()
            try:
                verify(data, entry, name)
                reused = True
            except ValueError:
                pass
        if not reused:
            data = extract_member(url, name, entry)
            if not data.startswith(b"fLaC"):
                raise ValueError(f"Missing FLAC signature: {name}")
            temporary = path.with_suffix(".part")
            temporary.write_bytes(data)
            temporary.replace(path)
        return path.name, hashlib.sha256(data).hexdigest(), flac_info(data)

    checksums = {}
    file_info = {}
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 12))) as pool:
        futures = [pool.submit(fetch, item) for item in sample_entries.items()]
        for number, future in enumerate(as_completed(futures), 1):
            name, checksum, info = future.result()
            checksums[name] = checksum
            file_info[name] = info
            if number % 20 == 0 or number == len(futures):
                print(f"Verified {number}/{len(futures)} samples", flush=True)
    (source / "sha256.json").write_text(json.dumps(dict(sorted(checksums.items())), indent=2) + "\n")
    manifest["files"] = dict(sorted(file_info.items()))
    for region in all_regions(manifest):
        region["offset"] = region["offsetFrames"] / file_info[region["file"]]["sampleRate"]
    # Publish only a completely verified bank. A failed or interrupted import
    # must not replace a working manifest with nominal offsets or missing sizes.
    temporary_manifest = output / "manifest.json.part"
    temporary_manifest.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    temporary_manifest.replace(output / "manifest.json")
    print(f"Complete: {output}", flush=True)


if __name__ == "__main__":
    main()
