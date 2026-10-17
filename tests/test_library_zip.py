import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import zipfile


spec = importlib.util.spec_from_file_location(
    "library_zip", Path(__file__).resolve().parents[1] / "scripts/create-library-zip.py"
)
library_zip = importlib.util.module_from_spec(spec)
spec.loader.exec_module(library_zip)


class LibraryZipTests(unittest.TestCase):
    def make_library(self, directory, *, reverse=False, timestamp=946684800, mode=0o644):
        content = {
            "README.txt": b"Beginner practice collection\n",
            "catalog.json": json.dumps(
                [{"filename": "z-song.mid"}, {"filename": "a-song.mid"}]
            ).encode("utf-8"),
            "z-song.mid": b"MThd\x00\x00\x00\x06z song",
            "a-song.mid": b"MThd\x00\x00\x00\x06a song",
            "unused.mid": b"not in the catalog",
        }
        names = list(content)
        for name in reversed(names) if reverse else names:
            path = directory / name
            path.write_bytes(content[name])
            path.chmod(mode)
            os.utime(path, (timestamp, timestamp))
        return content

    def test_identical_content_ignores_file_times_permissions_and_creation_order(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = root / "first"
            second = root / "second"
            first.mkdir()
            second.mkdir()
            self.make_library(first, timestamp=946684800, mode=0o600)
            self.make_library(second, reverse=True, timestamp=1792195200, mode=0o755)

            first_bytes = library_zip.write_library_zip(first).read_bytes()
            second_bytes = library_zip.write_library_zip(second).read_bytes()

            self.assertEqual(first_bytes, second_bytes)
            # Replacing the output in the same directory is reproducible too.
            self.assertEqual(first_bytes, library_zip.write_library_zip(first).read_bytes())

    def test_sorted_entries_have_fixed_metadata_and_exact_catalog_content(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            content = self.make_library(directory)
            output = library_zip.write_library_zip(directory)
            with zipfile.ZipFile(output) as archive:
                self.assertIsNone(archive.testzip())
                self.assertEqual(
                    archive.namelist(),
                    ["README.txt", "a-song.mid", "catalog.json", "z-song.mid"],
                )
                for entry in archive.infolist():
                    self.assertEqual(entry.date_time, (1980, 1, 1, 0, 0, 0))
                    self.assertEqual(entry.create_system, 3)
                    self.assertEqual(entry.external_attr >> 16, 0o100644)
                    self.assertEqual(entry.compress_type, zipfile.ZIP_DEFLATED)
                    self.assertEqual(entry.extra, b"")
                    self.assertEqual(entry.comment, b"")
                    self.assertEqual(archive.read(entry), content[entry.filename])


if __name__ == "__main__":
    unittest.main()
