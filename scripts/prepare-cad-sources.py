#!/usr/bin/env python3
"""Prepare pinned corresponding source and notices beside the experimental WASM.

Run explicitly before bundling the CAD experiments. Source archives are split
below the static-host asset limit; no runtime design information is uploaded.
"""
import argparse
import hashlib
import html
import io
import json
import pathlib
import tarfile
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
ARCHIVE_SHA256 = {
    "replicad": "92180710da11a6e67ab75eaac8b494b29d32011415c22e29f7fecb1c796da783",
    "ocjs": "1e0342c8dbdc04d1835c776d5e95ab25fcad56a5f4cafcbecad92a959b6b00b7",
    "occt": "dba62b81078dd43cec23feba89432be301582341001edad1b93342ad8bda35ea",
    "freetype": "14791d34053acf30394912a8b963277bee60b35fbb3038795d86555ba0415a44",
    "rapidjson": "2d2601a82d2d3b7e143a3c8d43ef616671391034bc46891a9816b79cf2d3e7a8",
    "emscripten": "4612f72f59b383d270ea17cc4b4e5b3837b83e42362733a127cc149298cbd77e",
}


def fetch(url):
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def write_changed(path, data):
    if not path.exists() or path.read_bytes() != data:
        path.write_bytes(data)


def archive_data(name, url, offline):
    cache = DEST / f"{name}.tar.gz"
    parts = sorted(DEST.glob(f"{name}.tar.gz.part*"))
    if cache.exists():
        data = cache.read_bytes()
    elif parts:
        data = b"".join(part.read_bytes() for part in parts)
    elif offline:
        raise ValueError(f"Missing local {name} source archive in offline mode")
    else:
        data = fetch(url)
    if hashlib.sha256(data).hexdigest() != ARCHIVE_SHA256[name]:
        raise ValueError(f"{name} source archive does not match its pinned SHA-256")
    return data


def member_bytes(archive, relative_path):
    matches = [m for m in archive.getmembers()
               if m.isfile() and m.name.partition("/")[2] == relative_path]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one archived source file: {relative_path}")
    return archive.extractfile(matches[0]).read()


def file_record(archive, path):
    data = member_bytes(archive, path)
    return {"path": path, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def emscripten_components(archive, allocator):
    prefix = "system/lib/mimalloc/"
    records = []
    for member in archive.getmembers():
        relative = member.name.partition("/")[2]
        if member.isfile() and relative.startswith(prefix):
            record = file_record(archive, relative)
            record["path"] = relative[len(prefix):]
            records.append(record)
    records.sort(key=lambda record: pathlib.PurePosixPath(record["path"]).parts)
    tree = "".join(f"{r['path']}\0{r['sha256']}\n" for r in records).encode()
    license_data = member_bytes(archive, prefix + "LICENSE")
    write_changed(DEST / "mimalloc-LICENSE", license_data)
    return [
        {"name": "mimalloc", "version": "2.1.7", "repository": "microsoft/mimalloc",
         "upstreamRevision": "8c532c32c3c96e5ba1f2283e032f69ead8add00f",
         "modifications": "Emscripten-specific port as shipped in Emscripten 5.0.1",
         "compiledInCurrentBuild": allocator == "mimalloc",
         "role": "Current allocator" if allocator == "mimalloc" else "Retained source and license for original upstream and pocketry.1 baseline builds",
         "sourcePath": "system/lib/mimalloc", "license": "MIT",
         "notice": "mimalloc-LICENSE", "noticeSha256": hashlib.sha256(license_data).hexdigest(),
         "sourceFiles": len(records), "sourceBytes": sum(r["bytes"] for r in records),
         "sourceTreeSha256": hashlib.sha256(tree).hexdigest(),
         "sourceTreeHashFormat": "SHA-256 of UTF-8 relative-path + NUL + file-SHA256 + LF, sorted by POSIX path components",
         "files": records},
        {"name": "emmalloc", "version": "Emscripten 5.0.1",
         "compiledInCurrentBuild": allocator in ("mimalloc", "emmalloc"),
         "role": "Direct current allocator" if allocator == "emmalloc" else "mimalloc's underlying Emscripten system allocator",
         "license": "MIT OR NCSA", "notice": "emscripten-LICENSE",
         **file_record(archive, "system/lib/emmalloc.c")},
        {"name": "sbrk", "version": "Emscripten 5.0.1",
         "compiledInCurrentBuild": allocator in ("mimalloc", "emmalloc"),
         "role": "linear-memory allocation used by emmalloc",
         "license": "MIT OR NCSA", "notice": "emscripten-LICENSE",
         **file_record(archive, "system/lib/libc/sbrk.c")},
    ]


def render_index(manifest):
    escape = html.escape
    lines = ["<!doctype html>", '<html lang="en"><meta charset="utf-8">',
             '<meta name="viewport" content="width=device-width, initial-scale=1">',
             "<title>Pocketry CAD engine source and notices</title><body>",
             "<h1>Pocketry CAD engine source and notices</h1>",
             '<p><a href="NOTICE.txt">Notices</a> | <a href="BUILD-INFO.txt">Build information and compatibility review</a> | <a href="sources.json">Source and SHA-256 manifest</a></p>',
             f"<p>Upstream library: {escape(manifest.get('upstreamPackage', 'replicad-opencascadejs@1.1.0'))}, LGPL-2.1-only. Pocketry's adapter is AGPL-3.0-only. Individual components retain their listed terms.</p>",
             "<p>Concatenate each archive's numbered parts in order, verify its SHA-256 against the manifest, then extract it. Sources include upstream wrappers, build recipes and compiler patches. Designs remain on your device.</p>"]
    repair = manifest.get("localRepair")
    if repair:
        lines += ["<h2>Pocketry binding repair</h2>",
                  f"<p>Package: {escape(repair['package'])}. Status: {escape(repair['status'])}. See build information for the qualification status and reproducibility limits.</p>"]
        for filename in [repair.get("patch"), repair.get("allocatorPatch"), repair.get("buildRecipe")]:
            if filename:
                label = escape(filename)
                lines.append(f'<p><a href="{label}">{label}</a></p>' if (DEST / filename).is_file()
                             else f"<p>{label} (candidate preparation pending)</p>")
        if repair.get("supportFiles"):
            lines += ["<p>Rebuild support files and native qualification evidence:</p>", "<ul>"]
            for filename, record in sorted(repair["supportFiles"].items()):
                name = escape(filename)
                lines.append(f'<li><a href="{name}">{name}</a> ({record["bytes"]} bytes), SHA-256 {record["sha256"]}</li>')
            lines.append("</ul>")
    for source in manifest["sources"]:
        lines += [f"<h2>{escape(source['name'])}</h2>", f"<p>Revision {escape(source['revision'])}</p>", "<ul>"]
        for part in source["parts"]:
            name = escape(part["file"])
            lines.append(f'<li><a href="{name}">{name}</a> ({part["bytes"]} bytes), SHA-256 {part["sha256"]}</li>')
        for filename in source["notices"]:
            name = escape(filename)
            lines.append(f'<li><a href="{name}">{name}</a></li>')
        lines.append("</ul>")
        if source.get("embeddedComponents"):
            lines.append("<p>This archive contains mimalloc 2.1.7 with its Emscripten port, emmalloc and sbrk sources, and their component licenses. The manifest distinguishes the current compiled allocator from retained baseline evidence. No separate allocator source download is needed.</p>")
    return "\n".join(lines + ["</body></html>", ""]).encode()


def main(offline=False):
    DEST.mkdir(parents=True, exist_ok=True)
    manifest_path = DEST / "sources.json"
    # Preserve the local repair, artifact identities and any future provenance
    # fields. Preparing upstream sources must not turn a repaired build back
    # into an apparently unmodified npm package.
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest.setdefault("package", "replicad-opencascadejs@1.1.0")
    existing_sources = {source["name"]: source for source in manifest.get("sources", [])}
    manifest["sources"] = []
    for name, repo, revision, licenses in SOURCES:
        archive_url = f"https://codeload.github.com/{repo}/tar.gz/{revision}"
        data = archive_data(name, archive_url, offline)
        chunks = []
        for i, start in enumerate(range(0, len(data), 20 * 1024 * 1024)):
            chunk = data[start:start + 20 * 1024 * 1024]
            filename = f"{name}.tar.gz.part{i:02d}"
            write_changed(DEST / filename, chunk)
            chunks.append({"file": filename, "sha256": hashlib.sha256(chunk).hexdigest(), "bytes": len(chunk)})
        notices = []
        source = dict(existing_sources.get(name, {}))
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            for license_path in licenses:
                prefix = "package-" if license_path.startswith("packages/") else "root-" if name == "replicad" else ""
                filename = f"{name}-{prefix}{pathlib.Path(license_path).name}"
                write_changed(DEST / filename, member_bytes(archive, license_path))
                notices.append(filename)
            if name == "emscripten":
                allocator = manifest.get("localRepair", {}).get("allocator", "mimalloc")
                source["embeddedComponents"] = emscripten_components(archive, allocator)
                source["allocatorBuildDefinition"] = file_record(archive, "tools/system_libs.py")
                source["runtimeLicenseFiles"] = [file_record(archive, path) for path in (
                    "LICENSE", "system/lib/libc/musl/COPYRIGHT",
                    "system/lib/libcxx/LICENSE.TXT", "system/lib/libcxxabi/LICENSE.TXT",
                    "system/lib/compiler-rt/LICENSE.TXT")]
                notices.append("mimalloc-LICENSE")
        source.update({"name": name, "repository": repo, "revision": revision,
            "upstreamArchive": archive_url, "archiveSha256": hashlib.sha256(data).hexdigest(),
            "parts": chunks, "notices": notices})
        manifest["sources"].append(source)
        print(f"{name}: {len(data)} bytes, {len(chunks)} parts", flush=True)
    write_changed(manifest_path, (json.dumps(manifest, indent=2) + "\n").encode())
    write_changed(DEST / "index.html", render_index(manifest))
    write_changed(DEST / "NOTICE.txt", (ROOT / "NOTICE").read_bytes())
    write_changed(DEST / "BUILD-INFO.txt", (ROOT / "docs/cad-engine-review.md").read_bytes())
    print("Source archives and notices prepared. Verify the served files before public distribution.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Use only verified local source archives")
    main(offline=parser.parse_args().offline)
