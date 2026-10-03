"""Create inert, line-addressable Java text snapshots. Never run archive content."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile


def snapshot(archive, output):
    archive, output = Path(archive).resolve(), Path(output).resolve()
    if output.exists():
        raise ValueError("Use a new output directory; audit snapshots are immutable")
    entries = []
    total = 0
    with zipfile.ZipFile(archive) as source:
        seen = set()
        for info in source.infolist():
            marker = "/src/main/java/"
            if marker not in info.filename or not info.filename.endswith(".java"):
                continue
            relative = PurePosixPath(info.filename.split(marker, 1)[1])
            if relative.is_absolute() or any(p in ("..", ".") or ":" in p or "\\" in p for p in relative.parts):
                raise ValueError("Unsafe archive source path")
            key = str(relative).casefold()
            if key in seen:
                raise ValueError("Duplicate archive source path")
            seen.add(key)
            total += info.file_size
            if info.file_size > 8_000_000 or total > 128_000_000:
                raise ValueError("Source size limit exceeded")
            data = source.read(info)
            text = data.decode("utf-8-sig", errors="strict")
            target = output / (str(relative) + ".txt")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8", newline="")
            entries.append({"source": str(relative), "archiveEntry": info.filename,
                            "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
                            "lines": len(text.splitlines())})
    with archive.open("rb") as archive_file:
        archive_hash = hashlib.file_digest(archive_file, "sha256").hexdigest()
    manifest = {"archive": str(archive), "archiveSha256": archive_hash,
                "execution": "none; Java source bytes decoded as text only", "files": entries}
    output.mkdir(parents=True, exist_ok=True)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"javaSources": len(entries), "bytes": total, "output": str(output),
                      "archiveSha256": manifest["archiveSha256"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    parser.add_argument("output")
    args = parser.parse_args()
    snapshot(args.archive, args.output)
