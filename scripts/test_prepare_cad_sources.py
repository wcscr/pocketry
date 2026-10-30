"""Offline provenance regression checks; no source downloads or CAD runtime needed.

Run with: python3 -m unittest discover -s scripts -p test_prepare_cad_sources.py
"""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import pathlib
import tarfile
import tempfile
import unittest
from unittest import mock


SCRIPT = pathlib.Path(__file__).with_name("prepare-cad-sources.py")
SPEC = importlib.util.spec_from_file_location("prepare_cad_sources", SCRIPT)
cad_sources = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cad_sources)


def source_archive(files):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode="w:gz") as archive:
        for name, data in sorted(files.items()):
            info = tarfile.TarInfo("fixture/" + name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    return result.getvalue()


class PrepareCadSourcesTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="cad-source-test-")
        self.addCleanup(temporary.cleanup)
        self.root = pathlib.Path(temporary.name)
        self.dest = self.root / "client/public/licenses/cad"
        self.dest.mkdir(parents=True)
        (self.root / "docs").mkdir()
        (self.root / "NOTICE").write_text("fixture project notice\n")
        (self.root / "docs/cad-engine-review.md").write_text("fixture review\n")
        self.hashes = {}
        for name, _repo, _revision, licenses in cad_sources.SOURCES:
            files = {path: f"fixture {name} {path}\n".encode() for path in licenses}
            if name == "emscripten":
                files.update({path: f"fixture {path}\n".encode() for path in (
                    "system/lib/mimalloc/LICENSE",
                    "system/lib/mimalloc/include/mimalloc.h",
                    "system/lib/emmalloc.c",
                    "system/lib/libc/sbrk.c",
                    "tools/system_libs.py",
                    "system/lib/libc/musl/COPYRIGHT",
                    "system/lib/libcxx/LICENSE.TXT",
                    "system/lib/libcxxabi/LICENSE.TXT",
                    "system/lib/compiler-rt/LICENSE.TXT",
                )})
            data = source_archive(files)
            self.hashes[name] = hashlib.sha256(data).hexdigest()
            (self.dest / f"{name}.tar.gz.part00").write_bytes(data)
        self.seed = {
            "package": "replicad-opencascadejs@fixture-repair",
            "upstreamPackage": "replicad-opencascadejs@1.1.0",
            "localRepair": {
                "package": "replicad-opencascadejs@fixture-repair",
                "status": "candidate-pending",
                "patch": "fixture.patch",
                "artifacts": {"fixture.wasm": {"sha256": "preserve-me"}},
            },
            "futureProvenance": {"keep": ["unknown", "metadata"]},
            "sources": [{"name": "replicad", "futureSourceField": {"keep": True}}],
        }
        (self.dest / "sources.json").write_text(json.dumps(self.seed))
        state = mock.patch.multiple(cad_sources, ROOT=self.root, DEST=self.dest,
                                    ARCHIVE_SHA256=self.hashes)
        state.start()
        self.addCleanup(state.stop)
        network = mock.patch.object(cad_sources, "fetch", side_effect=AssertionError("Network forbidden"))
        self.fetch = network.start()
        self.addCleanup(network.stop)

    def prepare(self):
        with contextlib.redirect_stdout(io.StringIO()):
            cad_sources.main(offline=True)

    def contents(self):
        return {p.name: p.read_bytes() for p in self.dest.iterdir() if p.is_file()}

    def test_offline_preparation_preserves_repair_and_unknown_metadata(self):
        expected = copy.deepcopy(self.seed)
        self.prepare()
        manifest = json.loads((self.dest / "sources.json").read_text())
        for key in ("package", "upstreamPackage", "localRepair", "futureProvenance"):
            self.assertEqual(manifest[key], expected[key])
        self.assertEqual(manifest["sources"][0]["futureSourceField"],
                         expected["sources"][0]["futureSourceField"])
        self.assertEqual((self.dest / "NOTICE.txt").read_bytes(), (self.root / "NOTICE").read_bytes())
        self.assertEqual((self.dest / "BUILD-INFO.txt").read_bytes(),
                         (self.root / "docs/cad-engine-review.md").read_bytes())
        emscripten = next(source for source in manifest["sources"] if source["name"] == "emscripten")
        allocator = emscripten["embeddedComponents"][0]
        self.assertTrue(allocator["compiledInCurrentBuild"])
        self.assertEqual(allocator["sourceFiles"], 2)
        self.assertEqual(allocator["noticeSha256"],
                         hashlib.sha256((self.dest / "mimalloc-LICENSE").read_bytes()).hexdigest())
        self.assertEqual(len(emscripten["runtimeLicenseFiles"]), 5)
        self.fetch.assert_not_called()

    def test_direct_emmalloc_labels_mimalloc_as_retained_baseline(self):
        self.seed["localRepair"]["allocator"] = "emmalloc"
        (self.dest / "sources.json").write_text(json.dumps(self.seed))
        self.prepare()
        manifest = json.loads((self.dest / "sources.json").read_text())
        emscripten = next(source for source in manifest["sources"] if source["name"] == "emscripten")
        components = {component["name"]: component for component in emscripten["embeddedComponents"]}
        self.assertFalse(components["mimalloc"]["compiledInCurrentBuild"])
        self.assertIn("baseline", components["mimalloc"]["role"])
        self.assertTrue(components["emmalloc"]["compiledInCurrentBuild"])
        self.assertEqual(components["emmalloc"]["role"], "Direct current allocator")
        self.assertTrue(components["sbrk"]["compiledInCurrentBuild"])
        self.assertTrue((self.dest / "mimalloc-LICENSE").is_file())
        self.fetch.assert_not_called()

    def test_offline_rerun_is_byte_identical(self):
        self.prepare()
        first = self.contents()
        self.prepare()
        self.assertEqual(self.contents(), first)
        self.fetch.assert_not_called()

    def test_corrupt_archive_and_parts_fail_without_network(self):
        for filename in ("replicad.tar.gz", "replicad.tar.gz.part00"):
            with self.subTest(filename=filename):
                path = self.dest / filename
                path.write_bytes(b"corrupt")
                with self.assertRaisesRegex(ValueError, "does not match its pinned SHA-256"):
                    cad_sources.archive_data("replicad", "https://invalid.invalid/", True)
                path.unlink()
        self.fetch.assert_not_called()

    def test_missing_offline_archive_fails_without_network(self):
        (self.dest / "replicad.tar.gz.part00").unlink()
        with self.assertRaisesRegex(ValueError, "Missing local replicad source archive in offline mode"):
            cad_sources.archive_data("replicad", "https://invalid.invalid/", True)
        self.fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
