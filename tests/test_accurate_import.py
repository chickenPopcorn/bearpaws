"""Offline regression coverage for publishing the generated piano manifest."""

import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "accurate_import", ROOT / "scripts/fetch-accurate-salamander.py"
)
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)
SOURCE_SFZ = (
    ROOT / "public/audio/accurate-salamander/source" / Path(IMPORTER.SFZ_MEMBER).name
).read_bytes()
MANIFEST = IMPORTER.build_manifest(SOURCE_SFZ.decode())
REGIONS = IMPORTER.all_regions(MANIFEST)
# Upstream names keep "#"; the browser files replace it with "s".
SAMPLES = {
    "48khz24bit/" + re.sub(r"([A-G])s(\d)", r"\1#\2", region["file"])
    for region in REGIONS
}
# A compact, valid STREAMINFO header with a deliberately corrected sample rate.
PACKED_INFO = (47917 << 44) | (1 << 41) | (23 << 36) | 48000
FLAC = b"fLaC\x80\x00\x00\x22" + b"\x00" * 10 + PACKED_INFO.to_bytes(8, "big") + b"\x00" * 16


class ManifestPublicationTests(unittest.TestCase):
    def run_import(self, output, *, metadata_only=False, fail_download=False):
        index = {
            name: {"size": len(FLAC)}
            for name in SAMPLES | {IMPORTER.SFZ_MEMBER, "README.txt"}
        }
        response = mock.MagicMock()
        response.__enter__.return_value.headers = {
            "Content-Length": str(IMPORTER.ARCHIVE_BYTES)
        }
        response.__enter__.return_value.url = "https://example.invalid/piano.zip"

        def extract(_url, name, _entry):
            if name == IMPORTER.SFZ_MEMBER:
                return SOURCE_SFZ
            if name == "README.txt":
                return b"Upstream attribution"
            if fail_download:
                raise OSError("Download interrupted")
            return FLAC

        args = ["fetch-accurate-salamander.py", "--output", str(output), "--workers", "1"]
        if metadata_only:
            args.append("--metadata-only")
        with (
            mock.patch("sys.argv", args),
            mock.patch.object(IMPORTER.urllib.request, "urlopen", return_value=response),
            mock.patch.object(IMPORTER, "read_index", return_value=index),
            mock.patch.object(IMPORTER, "extract_member", side_effect=extract) as extraction,
            mock.patch("builtins.print"),
        ):
            IMPORTER.main()
            return extraction

    def test_interrupted_download_preserves_previous_playable_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            previous = b'{"previous":"fully verified bank"}\n'
            (output / "manifest.json").write_bytes(previous)
            with self.assertRaisesRegex(OSError, "Download interrupted"):
                self.run_import(output, fail_download=True)
            self.assertEqual((output / "manifest.json").read_bytes(), previous)
            self.assertFalse((output / "manifest.json.part").exists())

    def test_metadata_only_does_not_replace_the_playable_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            previous = b'{"previous":"fully verified bank"}\n'
            (output / "manifest.json").write_bytes(previous)
            extraction = self.run_import(output, metadata_only=True)
            self.assertEqual((output / "manifest.json").read_bytes(), previous)
            self.assertEqual(extraction.call_count, 2)
            metadata = json.loads((output / "source/regions.json").read_text())
            self.assertEqual(len(metadata["regions"]), 1408)
            self.assertEqual(len(IMPORTER.all_regions(metadata)), 1704)
            self.assertNotIn("files", metadata)

    def test_fresh_metadata_only_import_does_not_publish_an_incomplete_bank(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            self.run_import(output, metadata_only=True)
            self.assertFalse((output / "manifest.json").exists())

    def test_success_publishes_all_samples_with_their_corrected_offsets(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "manifest.json").write_text('{"previous":true}')
            self.run_import(output)
            manifest = json.loads((output / "manifest.json").read_text())
            self.assertEqual(len(manifest["files"]), 641)
            self.assertEqual(len(manifest["regions"]), 1408)
            self.assertFalse((output / "manifest.json.part").exists())
            for region in IMPORTER.all_regions(manifest):
                self.assertAlmostEqual(region["offset"], region["offsetFrames"] / 47917)
                self.assertTrue((output / region["file"]).exists())


class OptionalVoiceTests(unittest.TestCase):
    def voice(self, name):
        return MANIFEST["optionalVoices"][name]

    def test_records_each_optional_voice_with_its_controller(self):
        self.assertEqual(
            [(name, voice["controller"], voice["defaultController"], len(voice["regions"]))
             for name, voice in MANIFEST["optionalVoices"].items()],
            [("release", 20, 0, 69), ("keyNoise", 21, 0, 88),
             ("pedalNoise", 22, 0, 4), ("resonance", 23, 0, 135)],
        )
        for voice in MANIFEST["optionalVoices"].values():
            self.assertEqual(voice["controllerGainDb"], -12)

    def test_resonance_regions_stay_out_of_the_note_bank(self):
        # They reuse note recordings, so only the controller tells them apart.
        self.assertEqual(len(MANIFEST["regions"]), 88 * 16)
        self.assertTrue(all(region["sourceLayer"] for region in MANIFEST["regions"]))
        files = {region["file"] for region in self.voice("resonance")["regions"]}
        self.assertTrue(files <= {region["file"] for region in MANIFEST["regions"]})

    def test_reads_the_trigger_and_pedal_rules(self):
        release = self.voice("release")["regions"]
        self.assertEqual({(r["trigger"], r["pedal"], r["gainDb"]) for r in release},
                         {("release", "up", -21.0)})
        self.assertEqual({r["decayDbPerSecond"] for r in release}, {2, 6, 7, 8, 9})
        noise = self.voice("keyNoise")["regions"]
        self.assertEqual({(r["trigger"], r["pedal"], r["rootPitch"], r["gainDb"]) for r in noise},
                         {("release_key", None, None, -37.0)})
        self.assertEqual([r["pitchMin"] for r in noise], list(range(21, 109)))
        pedal = self.voice("pedalNoise")["regions"]
        self.assertEqual(
            [(r["file"], r["trigger"], r["randomMin"], r["randomMax"], r["gainDb"], r["cutSeconds"])
             for r in pedal],
            [("pedalD1.flac", "pedalDown", 0, .5, -39, .1), ("pedalD2.flac", "pedalDown", .5, 1, -39, .1),
             ("pedalU1.flac", "pedalUp", 0, .5, -45, .1), ("pedalU2.flac", "pedalUp", .5, 1, -45, .1)],
        )
        resonance = self.voice("resonance")["regions"]
        self.assertEqual({(r["trigger"], r["pedal"], r["attackSeconds"]) for r in resonance},
                         {("attack", "down", .05)})
        # group_volume adds to each region's own volume.
        first = resonance[0]
        self.assertEqual((first["group"], first["gainDb"], first["file"]), (301, -6.0, "021_A0v01.flac"))

    def test_rejects_an_unexpected_optional_voice_count(self):
        sfz = SOURCE_SFZ.decode().replace(
            "<region> sample=..\\48khz24bit\\rel88.flac lokey=108 hikey=108\n", "")
        with self.assertRaisesRegex(ValueError, "Expected 88 keyNoise regions, got 87"):
            IMPORTER.build_manifest(sfz)


if __name__ == "__main__":
    unittest.main()
