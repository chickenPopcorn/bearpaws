"""Offline regression coverage for publishing the generated piano manifest."""

import importlib.util
import json
from pathlib import Path
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
REGIONS = IMPORTER.build_manifest(SOURCE_SFZ.decode())["regions"]
SAMPLES = {"48khz24bit/" + region["file"] for region in REGIONS}
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
            self.assertEqual(len(metadata["regions"]), 704)
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
            self.assertEqual(len(manifest["files"]), 240)
            self.assertEqual(len(manifest["regions"]), 704)
            self.assertFalse((output / "manifest.json.part").exists())
            for region in manifest["regions"]:
                self.assertAlmostEqual(region["offset"], region["offsetFrames"] / 47917)
                self.assertTrue((output / region["file"]).exists())


if __name__ == "__main__":
    unittest.main()
