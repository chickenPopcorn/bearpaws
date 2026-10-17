"""Package the MIDI catalog with reproducible ZIP entry metadata."""

import json
from pathlib import Path
import sys
import zipfile


def write_library_zip(directory: Path) -> Path:
    catalog = json.loads((directory / "catalog.json").read_text(encoding="utf-8"))
    filenames = ["README.txt", "catalog.json", *[song["filename"] for song in catalog]]
    output = directory / "cadence-starter-library.zip"
    with zipfile.ZipFile(output, "w") as archive:
        for filename in sorted(filenames):
            entry = zipfile.ZipInfo(filename, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3  # Unix, regardless of the build host.
            entry.external_attr = 0o100644 << 16
            archive.writestr(
                entry,
                (directory / filename).read_bytes(),
                compress_type=zipfile.ZIP_DEFLATED,
                compresslevel=9,
            )
    return output


if __name__ == "__main__":
    write_library_zip(Path(sys.argv[1]))
