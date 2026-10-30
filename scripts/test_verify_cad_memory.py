"""Small positive/negative controls for the independent package comparator.

Run with the same existing cadquery-ocp Python used by verify-cad-memory.py:
  python -m unittest discover -s scripts -p test_verify_cad_memory.py
"""
from contextlib import ExitStack
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
import zipfile


spec = importlib.util.spec_from_file_location("verify_cad_memory", Path(__file__).with_name("verify-cad-memory.py"))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class MetadataChecks(unittest.TestCase):
    def test_rejects_faceted_or_tessellated_representations(self):
        header = "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));#1=(LENGTH_UNIT()SI_UNIT(.MILLI.,.METRE.));"
        for entity in ("FACETED_BREP", "TESSELLATED_SHAPE_REPRESENTATION", "TRIANGULATED_FACE_SET"):
            with self.subTest(entity=entity), self.assertRaisesRegex(verify.VerificationError, "faceted/tessellated"):
                verify.inspect_step_text((header + f"#2={entity}('bad');").encode(), "negative control")

    def test_rejects_incorrect_length_units(self):
        with self.assertRaisesRegex(verify.VerificationError, "millimetre"):
            verify.inspect_step_text(b"FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));", "missing units")

    def test_engine_change_requires_exact_explicit_candidate_version(self):
        before = SimpleNamespace(report={"engineVersion": "original"})
        after = SimpleNamespace(report={"engineVersion": "candidate"})
        with self.assertRaisesRegex(verify.VerificationError, "engineVersion changed"):
            verify.compare_engine_versions(before, after, None)
        with self.assertRaisesRegex(verify.VerificationError, "explicitly expected"):
            verify.compare_engine_versions(before, after, "different-candidate")
        result = verify.compare_engine_versions(before, after, "candidate")
        self.assertEqual(result, {"before": "original", "after": "candidate", "explicitlyExpectedAfter": "candidate"})

    def test_mixed_profiles_validate_every_job_and_repeated_mesh_output(self):
        from copy import deepcopy
        mesh = {"positionsSha256": "a" * 64, "indicesSha256": "b" * 64,
                "normalsSha256": None, "vertices": 8, "triangles": 12}
        step = {"method": "step", "status": "passed", "trackedHandlesAfterDispose": 0,
                "report": {"snapshotSha256": "snapshot", "engineVersion": "candidate"}}
        mesh_job = {"method": "mesh", "status": "passed", "trackedHandlesAfterDispose": 0,
                    "stats": {"triangles": 12, "volumeMm3": 10},
                    "meshes": {"complete": mesh, "body": mesh, "text": []}}
        package = SimpleNamespace(snapshot_hash="snapshot", report={"engineVersion": "candidate"},
                                  run_profile={"jobs": [step, mesh_job, deepcopy(mesh_job)]})
        self.assertEqual(verify.validate_profile_jobs(package, "mixed")["methods"], {"step": 1, "mesh": 2})
        mutations = [
            ("status", "failed", "profiling job failed"),
            ("trackedHandlesAfterDispose", 1, "handles remain"),
            ("method", "unknown", "unknown profiling method"),
            ("meshes", {}, "missing mesh evidence"),
            ("stats", {"triangles": 11, "volumeMm3": 10}, "output changed"),
        ]
        for key, value, message in mutations:
            changed = deepcopy(package)
            changed.run_profile["jobs"][-1][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(verify.VerificationError, message):
                verify.validate_profile_jobs(changed, "mixed")
        package.run_profile["jobs"][0]["report"]["snapshotSha256"] = "different"
        with self.assertRaisesRegex(verify.VerificationError, "different snapshot"):
            verify.validate_profile_jobs(package, "mixed")

    def test_run_profiles_cannot_relabel_sharp_inputs_or_hide_failed_repeats(self):
        def package(limit):
            return SimpleNamespace(input_bytes=b'{"fixture":1}', project={"fixture": 1}, snapshot_hash="snapshot",
                                   run_profile={"sourceSha256": "source", "sharpControl": True, "diagnosticOnly": True,
                                                "overrides": [], "limitMiB": limit, "peakWasmBytes": 100,
                                                "jobs": [{"status": "passed", "report": {"snapshotSha256": "snapshot"},
                                                          "trackedHandlesAfterDispose": 0}]})
        before, after = package(1024), package(512)
        self.assertEqual(verify.compare_run_evidence(before, after, "sharp-diagnostic")["optimizedGuardMiB"], 512)
        with self.assertRaisesRegex(verify.VerificationError, "variant"):
            verify.compare_run_evidence(before, after, "authored")
        after.run_profile["jobs"][0]["status"] = "failed"
        with self.assertRaisesRegex(verify.VerificationError, "profiling job failed"):
            verify.compare_run_evidence(before, after, "sharp-diagnostic")
        after = package(1024)
        with self.assertRaisesRegex(verify.VerificationError, "raised the 512"):
            verify.compare_run_evidence(before, after, "sharp-diagnostic")


class NativeControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.native = verify.NativeReader()
        except ModuleNotFoundError as error:
            raise unittest.SkipTest(f"Independent OCP environment required: {error}")

    def write_assembly(self, path, title, bodies):
        from OCP.BRep import BRep_Builder
        from OCP.Interface import Interface_Static
        from OCP.IFSelect import IFSelect_RetDone
        from OCP.STEPCAFControl import STEPCAFControl_Writer
        from OCP.STEPControl import STEPControl_AsIs
        from OCP.TCollection import TCollection_ExtendedString
        from OCP.TDataStd import TDataStd_Name
        from OCP.TDocStd import TDocStd_Document
        from OCP.TopoDS import TopoDS_Compound
        from OCP.XCAFDoc import XCAFDoc_DocumentTool
        document = TDocStd_Document(TCollection_ExtendedString("control"))
        tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())
        compound = TopoDS_Compound()
        BRep_Builder().MakeCompound(compound)
        root = tool.AddShape(compound, True)
        TDataStd_Name.Set_s(root, TCollection_ExtendedString(title, True))
        for name, shape in bodies:
            target = tool.AddShape(shape, False)
            TDataStd_Name.Set_s(target, TCollection_ExtendedString(name, True))
            from OCP.TopLoc import TopLoc_Location
            instance = tool.AddComponent(root, target, TopLoc_Location())
            TDataStd_Name.Set_s(instance, TCollection_ExtendedString(name, True))
        tool.UpdateAssemblies()
        Interface_Static.SetCVal_s("write.step.schema", "AP214IS")
        writer = STEPCAFControl_Writer()
        writer.SetNameMode(True)
        self.assertTrue(writer.Transfer(document, STEPControl_AsIs))
        self.assertEqual(writer.Write(str(path)), IFSelect_RetDone)

    def package(self, path, width=10):
        from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
        from OCP.gp import gp_Ax2, gp_Pnt, gp_Dir
        path.mkdir()
        box = BRepPrimAPI_MakeBox(width, 8, 6).Shape()
        cylinder = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 0, 0), gp_Dir(0, 0, 1)), 2, 5).Shape()
        bodies = [("Duplicate Ω [box]", box), ("Duplicate Ω [circle]", cylinder)]
        self.write_assembly(path / "bin.step", "Control", [("Finished [finished]", box)])
        self.write_assembly(path / "design-objects.step", "Pocketry design objects", bodies)
        records = []
        for index, (name, shape) in enumerate(bodies):
            measurements = self.native.measure(shape, "control")
            bounds = measurements["boundsMm"]
            records.append({"id": ("box", "circle")[index], "name": "Duplicate Ω", "status": "active",
                            "role": "bin-blank" if index == 0 else "pocket-source", "order": index,
                            "stepInstanceName": name, "assemblyPath": ["Pocketry design objects", name],
                            "coordinates": "world-mm", "solidCount": 1, "volumeMm3": measurements["volumeMm3"],
                            "boundsMm": {"min": dict(zip("xyz", bounds[:3])), "max": dict(zip("xyz", bounds[3:]))}})
        project = json.dumps({"schemaVersion": 55, "name": "Comparator control", "cutouts": [], "shapes": []}).encode()
        (path / "design.pocketry.json").write_bytes(project)
        digest = verify.sha256(project)
        objects = {"version": 1, "snapshotSha256": digest, "objects": records, "reconstructionOrder": ["box"]}
        report = {"snapshotSha256": digest, "objects": records, "engineVersion": "native-control",
                  "units": "mm", "modelingToleranceMm": 1e-6, "booleanRetryToleranceMm": 1e-5,
                  "dimensions": {"widthMm": 10}, "solidCounts": {"bin": 1, "designObjects": 2},
                  "peakWasmMemoryBytes": 100 * 1024 * 1024}
        (path / "objects.json").write_text(json.dumps(objects))
        (path / "export-report.json").write_text(json.dumps(report))
        (path / "README.txt").write_text("Independent tiny verification control; not an authored bin.")
        return path

    def test_identical_zip_and_directory_preserve_curves_unicode_and_duplicate_names(self):
        with TemporaryDirectory() as directory, ExitStack() as stack:
            path = self.package(Path(directory) / "baseline")
            archive_path = Path(directory) / "after.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                for name in verify.REQUIRED_FILES:
                    archive.write(path / name, name)
            before, after = verify.Package(path, stack), verify.Package(archive_path, stack)
            result = {}
            verify.compare_packages(before, after, self.native, "all", result)
            self.assertTrue(result["geometryEquivalenceProven"])
            circle = result["files"]["design-objects.step"]["components"]["Duplicate Ω [circle]"]
            self.assertTrue(any("Circle" in curve for curve in circle["before"]["curves"]))
            self.assertEqual(circle["symmetricDifference"]["beforeMinusAfter"]["volumeMm3"], 0)

    def test_changed_geometry_fails_even_when_metadata_claims_same_design(self):
        with TemporaryDirectory() as directory, ExitStack() as stack:
            before = verify.Package(self.package(Path(directory) / "before"), stack)
            after = verify.Package(self.package(Path(directory) / "after", width=10.25), stack)
            with self.assertRaisesRegex(verify.VerificationError, "volume changed"):
                verify.compare_packages(before, after, self.native, "all", {})

    def test_source_change_and_raised_optimized_guard_are_rejected_before_geometry(self):
        with TemporaryDirectory() as directory, ExitStack() as stack:
            path = self.package(Path(directory) / "before")
            before, after = verify.Package(path, stack), verify.Package(path, stack)
            after.files["design.pocketry.json"] += b" "
            with self.assertRaisesRegex(verify.VerificationError, "Source project bytes changed"):
                verify.compare_packages(before, after, self.native, "none", {})
            after.files["design.pocketry.json"] = before.files["design.pocketry.json"]
            after.report["peakWasmMemoryBytes"] = verify.MEMORY_LIMIT_BYTES + 1
            with self.assertRaisesRegex(verify.VerificationError, "512 MiB"):
                verify.compare_packages(before, after, self.native, "none", {})


if __name__ == "__main__":
    unittest.main()
