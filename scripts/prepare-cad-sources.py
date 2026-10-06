#!/usr/bin/env python3
"""Prepare pinned corresponding source and notices beside the experimental WASM.

Run explicitly before bundling the CAD experiments. Source archives are split
below the static-host asset limit; no runtime design information is uploaded.
"""
import hashlib
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / "client/public/licenses/cad"
SOURCES = [
    ("replicad", "sgenoud/replicad", "e4b05f67dc4e2393a876ce8c5064a9c93db05bf1", ["packages/replicad-opencascadejs/LICENSE", "LICENSE"]),
    ("ocjs", "taucad/opencascade.js", "ebd263f15337b440b391492af073662707e86482", ["LICENSE", "LICENSE.OCCT-Exception"]),
    ("occt", "Open-Cascade-SAS/OCCT", "b8f597c677811d1f9f4d8a97f5ae2825c0353a42", ["LICENSE_LGPL_21.txt", "OCCT_LGPL_EXCEPTION.txt"]),
    ("freetype", "freetype/freetype", "de8b92dd7ec634e9e2b25ef534c54a3537555c11", ["docs/FTL.TXT"]),
    ("rapidjson", "Tencent/rapidjson", "24b5e7a8b27f42fa16b96fc70aade9106cf7102f", ["license.txt"]),
    ("emscripten", "emscripten-core/emscripten", "5.0.1", ["LICENSE"]),
]


def fetch(url):
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    manifest = {"package": "replicad-opencascadejs@1.1.0", "sources": []}
    for name, repo, revision, licenses in SOURCES:
        archive_url = f"https://codeload.github.com/{repo}/tar.gz/{revision}"
        cache = DEST / f"{name}.tar.gz"
        data = cache.read_bytes() if cache.exists() else fetch(archive_url)
        chunks = []
        for i, start in enumerate(range(0, len(data), 20 * 1024 * 1024)):
            chunk = data[start:start + 20 * 1024 * 1024]
            filename = f"{name}.tar.gz.part{i:02d}"
            (DEST / filename).write_bytes(chunk)
            chunks.append({"file": filename, "sha256": hashlib.sha256(chunk).hexdigest(), "bytes": len(chunk)})
        notices = []
        for license_path in licenses:
            prefix = "package-" if license_path.startswith("packages/") else "root-" if name == "replicad" else ""
            filename = f"{name}-{prefix}{pathlib.Path(license_path).name}"
            (DEST / filename).write_bytes(fetch(f"https://raw.githubusercontent.com/{repo}/{revision}/{license_path}"))
            notices.append(filename)
        manifest["sources"].append({"name": name, "repository": repo, "revision": revision,
            "upstreamArchive": archive_url, "archiveSha256": hashlib.sha256(data).hexdigest(),
            "parts": chunks, "notices": notices})
        print(f"{name}: {len(data)} bytes, {len(chunks)} parts", flush=True)
    (DEST / "sources.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("Source archives and notices prepared. Verify the served files before public distribution.")


if __name__ == "__main__":
    main()
