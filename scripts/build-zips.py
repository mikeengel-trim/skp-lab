#!/usr/bin/env python3
"""Build one install zip per extension into zips/<manifest id>.zip.

Each zip has manifest.json at its root (what the Extension Manager expects)
and contains only runtime files: tests, docs and dev leftovers are skipped.
Output is byte-for-byte reproducible (sorted entries, fixed timestamps), so
a zip only changes in git when the extension's shipped files change.

Usage: python3 scripts/build-zips.py
"""
import fnmatch
import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "zips")
SKIP_DIRS = {"verify", "node_modules", ".git"}
SKIP_FILES = ["*.md", ".gitignore", ".DS_Store", "* Old.*"]
FIXED_TIME = (2020, 1, 1, 0, 0, 0)


def shipped_files(ext_dir):
    for dirpath, dirnames, filenames in os.walk(ext_dir):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            if any(fnmatch.fnmatch(name, p) for p in SKIP_FILES):
                continue
            full = os.path.join(dirpath, name)
            yield full, os.path.relpath(full, ext_dir).replace(os.sep, "/")


def build(ext_dir):
    with open(os.path.join(ext_dir, "manifest.json")) as f:
        ext_id = json.load(f)["id"]
    path = os.path.join(OUT, ext_id + ".zip")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for full, arc in shipped_files(ext_dir):
            info = zipfile.ZipInfo(arc, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(full, "rb") as f:
                z.writestr(info, f.read())
    return path


def main():
    os.makedirs(OUT, exist_ok=True)
    built = set()
    for name in sorted(os.listdir(ROOT)):
        d = os.path.join(ROOT, name)
        if name.startswith("sketchup-") and os.path.isfile(os.path.join(d, "manifest.json")):
            built.add(os.path.basename(build(d)))
    for stale in os.listdir(OUT):  # extension renamed or removed
        if stale.endswith(".zip") and stale not in built:
            os.remove(os.path.join(OUT, stale))
    print("Built:", ", ".join(sorted(built)))


if __name__ == "__main__":
    main()
