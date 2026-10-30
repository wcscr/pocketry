"""Independently compare STEP packages before/after CAD handle-lifetime changes.

Use an existing cadquery-ocp environment; this script installs nothing and does
not launch a CAD application. Both inputs can be package ZIPs or directories.
The variant is mandatory: a sharp diagnostic must never stand in for an authored
rounded design. --expected-project accepts the exact normalized export snapshot,
not a legacy file that still needs Pocketry's migrations.

Example:
  python scripts/verify-cad-memory.py before/cad.zip after/cad.zip \
    --variant sharp-diagnostic --symmetric-difference all --output comparison.json
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import ExitStack
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory
from typing import Any
import zipfile


MEMORY_LIMIT_BYTES = 512 * 1024 * 1024
BOUNDS_TOLERANCE_MM = 0.00002
NATIVE_TOLERANCE_MM = 0.00001
VOLUME_TOLERANCE_MM3 = 0.00001
BOOLEAN_FUZZY_MM = 0.000001
REQUIRED_FILES = ("bin.step", "design-objects.step", "design.pocketry.json",
                  "objects.json", "export-report.json", "README.txt")


class VerificationError(RuntimeError):
    """An acceptance condition failed; never report a partial comparison as full."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise VerificationError(message)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def inspect_step_text(data: bytes, context: str) -> None:
    text = data.decode("utf-8")
    require("AUTOMOTIVE_DESIGN" in text, f"{context}: missing AP214 schema")
    # Inspect entity declarations, not user-supplied names inside string values.
    faceted = re.search(
        r"#\d+\s*=\s*\(?\s*(?:TESSELLATED_\w*|TRIANGULATED_\w*|"
        r"COMPLEX_TRIANGULATED_\w*|POLYGONAL_FACE_SET|FACETED_BREP\w*)\s*\(",
        text, re.IGNORECASE,
    )
    require(faceted is None, f"{context}: faceted/tessellated STEP representation")
    require(re.search(r"SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)", text)
            is not None, f"{context}: no millimetre SI length unit")


class Package:
    def __init__(self, path: Path, stack: ExitStack):
        self.path = path.resolve()
        evidence_directory = path if path.is_dir() else path.parent
        profile_path = evidence_directory / "memory-profile.json"
        input_path = evidence_directory / "input.pocketry.json"
        self.run_profile = json.loads(profile_path.read_text()) if profile_path.exists() else None
        self.input_bytes = input_path.read_bytes() if input_path.exists() else None
        if path.is_dir():
            self.files = {name: (path / name).read_bytes() for name in REQUIRED_FILES}
            self.directory = path
        else:
            with zipfile.ZipFile(path) as archive:
                require(all(archive.namelist().count(name) == 1 for name in REQUIRED_FILES),
                        f"{path}: missing or duplicate package members")
                self.files = {name: archive.read(name) for name in REQUIRED_FILES}
            self.directory = Path(stack.enter_context(TemporaryDirectory(prefix="pocketry-step-compare-")))
            for name in ("bin.step", "design-objects.step"):
                (self.directory / name).write_bytes(self.files[name])
        self.project = json.loads(self.files["design.pocketry.json"])
        self.objects = json.loads(self.files["objects.json"])
        self.report = json.loads(self.files["export-report.json"])
        self.snapshot_hash = sha256(self.files["design.pocketry.json"])
        for document, label in ((self.objects, "objects"), (self.report, "report")):
            require(document["snapshotSha256"] == self.snapshot_hash,
                    f"{path}: {label} snapshot hash does not match the project bytes")
        require(self.report["units"] == "mm", f"{path}: report units are not mm")
        require(self.objects["objects"] == self.report["objects"],
                f"{path}: object manifests disagree")
        records = self.objects["objects"]
        self.by_id = {item["id"]: item for item in records}
        require(len(self.by_id) == len(records), f"{path}: duplicate stable object ID")
        names = [item["stepInstanceName"] for item in records]
        require(len(set(names)) == len(names), f"{path}: duplicate STEP instance name")
        for name in ("bin.step", "design-objects.step"):
            inspect_step_text(self.files[name], f"{path}/{name}")


class NativeReader:
    """Load the separately installed OCCT binding only when geometry is requested."""
    def __init__(self):
        import OCP
        from OCP.BRep import BRep_Tool
        from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
        from OCP.BRepBndLib import BRepBndLib
        from OCP.BRepCheck import BRepCheck_Analyzer
        from OCP.BRepGProp import BRepGProp
        from OCP.Bnd import Bnd_Box
        from OCP.GProp import GProp_GProps
        from OCP.IFSelect import IFSelect_RetDone
        from OCP.STEPControl import STEPControl_Reader
        from OCP.STEPCAFControl import STEPCAFControl_Reader
        from OCP.TCollection import TCollection_ExtendedString
        from OCP.TDataStd import TDataStd_Name
        from OCP.TDF import TDF_Label, TDF_LabelSequence
        from OCP.TDocStd import TDocStd_Document
        from OCP.TopAbs import TopAbs_VERTEX, TopAbs_EDGE, TopAbs_WIRE, TopAbs_FACE, TopAbs_SHELL, TopAbs_SOLID
        from OCP.TopExp import TopExp
        from OCP.TopTools import TopTools_IndexedMapOfShape
        from OCP.TopoDS import TopoDS
        from OCP.XCAFDoc import XCAFDoc_DocumentTool
        # Keep imports on this instance so metadata-only tests need no OCP install.
        self.api = locals()
        self.version = {"package": importlib.metadata.version("cadquery-ocp"),
                        "binding": OCP.__version__}
        self.documents: list[Any] = []

    def subshapes(self, shape: Any, kind: str) -> list[Any]:
        indexed = self.api["TopTools_IndexedMapOfShape"]()
        self.api["TopExp"].MapShapes_s(shape, self.api["TopAbs_" + kind.upper()], indexed)
        return [indexed.FindKey(index) for index in range(1, indexed.Extent() + 1)]

    def volume(self, shape: Any) -> float:
        props = self.api["GProp_GProps"]()
        self.api["BRepGProp"].VolumeProperties_s(shape, props)
        return props.Mass()

    def label_name(self, label: Any) -> str:
        attribute = self.api["TDataStd_Name"]()
        require(label.FindAttribute(self.api["TDataStd_Name"].GetID_s(), attribute),
                "Unnamed XCAF assembly/component")
        return attribute.Get().ToExtString()

    def read(self, path: Path) -> tuple[Any, dict[str, Any]]:
        reader = self.api["STEPControl_Reader"]()
        require(reader.ReadFile(str(path)) == self.api["IFSelect_RetDone"], f"{path}: STEP read failed")
        require(reader.TransferRoots() > 0, f"{path}: no STEP roots transferred")
        shape = reader.OneShape()
        document = self.api["TDocStd_Document"](self.api["TCollection_ExtendedString"]("CAD memory acceptance"))
        xcaf = self.api["STEPCAFControl_Reader"]()
        xcaf.SetNameMode(True)
        require(xcaf.ReadFile(str(path)) == self.api["IFSelect_RetDone"] and xcaf.Transfer(document),
                f"{path}: XCAF transfer failed")
        self.documents.append(document)
        tool = self.api["XCAFDoc_DocumentTool"].ShapeTool_s(document.Main())
        roots = self.api["TDF_LabelSequence"]()
        tool.GetFreeShapes(roots)
        require(roots.Length() == 1, f"{path}: expected one named assembly root")
        root = roots.Value(1)
        labels = self.api["TDF_LabelSequence"]()
        require(tool.GetComponents_s(root, labels), f"{path}: root is not an assembly")
        result: dict[str, Any] = {}
        for index in range(1, labels.Length() + 1):
            instance = labels.Value(index)
            target = self.api["TDF_Label"]()
            require(tool.GetReferredShape_s(instance, target), f"{path}: broken component reference")
            name = self.label_name(instance)
            require(name not in result, f"{path}: duplicate named component {name}")
            # The current exporter deliberately writes one flat named assembly.
            require(not tool.IsAssembly_s(target), f"{path}: unsupported nested assembly {name}")
            located = tool.GetShape_s(instance)
            trsf = located.Location().Transformation()
            result[name] = {"shape": located, "name": self.label_name(target),
                            "assemblyPath": [self.label_name(root), name],
                            "placement": [trsf.Value(row, col) for row in range(1, 4) for col in range(1, 5)]}
        return shape, result

    def measure(self, shape: Any, context: str, allow_empty: bool = False) -> dict[str, Any]:
        require(not shape.IsNull(), f"{context}: null shape")
        require(self.api["BRepCheck_Analyzer"](shape, True).IsValid(), f"{context}: invalid B-rep")
        shapes = {kind: self.subshapes(shape, kind) for kind in ("solid", "shell", "face", "wire", "edge", "vertex")}
        require(allow_empty or len(shapes["solid"]) > 0, f"{context}: no solids")
        for shell in shapes["shell"]:
            require(self.api["BRep_Tool"].IsClosed_s(shell), f"{context}: open shell")
        for solid in shapes["solid"]:
            require(self.volume(solid) > 0, f"{context}: nonpositive solid volume")
        if not shapes["solid"] and allow_empty:
            require(not shapes["face"], f"{context}: Boolean returned nonsolid faces")
            return {"volumeMm3": 0.0, "topology": {k: len(v) for k, v in shapes.items()}}
        casts = {"face": self.api["TopoDS"].Face_s, "edge": self.api["TopoDS"].Edge_s,
                 "vertex": self.api["TopoDS"].Vertex_s}
        tolerance = max(self.api["BRep_Tool"].Tolerance_s(casts[k](item))
                        for k in casts for item in shapes[k])
        require(tolerance <= NATIVE_TOLERANCE_MM, f"{context}: native tolerance {tolerance} exceeds {NATIVE_TOLERANCE_MM}")
        bounds = self.api["Bnd_Box"]()
        self.api["BRepBndLib"].AddOptimal_s(shape, bounds, False, False)
        return {"valid": True, "closed": True, "volumeMm3": self.volume(shape),
                "boundsMm": list(bounds.Get()), "maxNativeToleranceMm": tolerance,
                "topology": {k: len(v) for k, v in shapes.items()},
                "curves": dict(Counter(str(self.api["BRepAdaptor_Curve"](casts["edge"](edge)).GetType()) for edge in shapes["edge"])),
                "surfaces": dict(Counter(str(self.api["BRepAdaptor_Surface"](casts["face"](face)).GetType()) for face in shapes["face"]))}

    def difference(self, left: Any, right: Any, context: str) -> dict[str, Any]:
        operation = self.api["BRepAlgoAPI_Cut"]()
        # Constructor + Build without a relaxed retry; use the same small fuzzy
        # value in both directions. No healing, simplification or tessellation.
        from OCP.TopTools import TopTools_ListOfShape
        arguments, tools = TopTools_ListOfShape(), TopTools_ListOfShape()
        arguments.Append(left)
        tools.Append(right)
        operation.SetArguments(arguments)
        operation.SetTools(tools)
        operation.SetFuzzyValue(BOOLEAN_FUZZY_MM)
        operation.SetNonDestructive(True)
        operation.Build()
        require(operation.IsDone(), f"{context}: symmetric-difference Boolean failed")
        result = self.measure(operation.Shape(), context, allow_empty=True)
        require(abs(result["volumeMm3"]) <= VOLUME_TOLERANCE_MM3,
                f"{context}: changed material volume {result['volumeMm3']} mm3")
        return result


def close_values(left: list[float], right: list[float], tolerance: float) -> bool:
    return len(left) == len(right) and all(math.isclose(a, b, rel_tol=0, abs_tol=tolerance)
                                        for a, b in zip(left, right))


def metadata_without_measurements(item: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in item.items() if key not in ("boundsMm", "volumeMm3")}


def compare_engine_versions(before: Package, after: Package, expected_after: str | None) -> dict[str, Any]:
    versions = {"before": before.report["engineVersion"], "after": after.report["engineVersion"]}
    if expected_after is None:
        require(versions["before"] == versions["after"], "Export report engineVersion changed")
    else:
        require(versions["after"] == expected_after, "Export report engineVersion differs from explicitly expected candidate")
    return {**versions, "explicitlyExpectedAfter": expected_after}


def validate_profile_jobs(package: Package, label: str) -> dict[str, Any]:
    jobs = package.run_profile["jobs"]
    require(bool(jobs), f"{label}: profiling run contains no jobs")
    counts: Counter[str] = Counter()
    repeated_meshes: dict[str, Any] = {}
    for job in jobs:
        require(job["status"] == "passed", f"{label}: a profiling job failed")
        require(job["trackedHandlesAfterDispose"] == 0, f"{label}: native handles remain after disposal")
        method = job.get("method", "step")
        require(method in ("step", "preview", "mesh"), f"{label}: unknown profiling method {method}")
        counts[method] += 1
        if method == "step":
            require(job["report"]["snapshotSha256"] == package.snapshot_hash,
                    f"{label}: repeated jobs exported a different snapshot")
            expected_engine = getattr(package, "report", {}).get("engineVersion")
            if expected_engine is not None:
                require(job["report"]["engineVersion"] == expected_engine,
                        f"{label}: repeated jobs used a different engine version")
        else:
            meshes = job.get("meshes", {})
            require(isinstance(meshes, dict) and bool(meshes.get("complete")) and bool(meshes.get("body"))
                    and isinstance(meshes.get("text"), list), f"{label}: {method} job is missing mesh evidence")
            for mesh in [meshes["complete"], meshes["body"], *meshes["text"]]:
                require(all(re.fullmatch(r"[0-9a-f]{64}", mesh.get(key, "")) for key in ("positionsSha256", "indicesSha256")),
                        f"{label}: {method} job has invalid mesh fingerprints")
                require(mesh.get("vertices", 0) > 0 and mesh.get("triangles", 0) > 0,
                        f"{label}: {method} job has empty mesh evidence")
                require((isinstance(mesh.get("normalsSha256"), str) and re.fullmatch(r"[0-9a-f]{64}", mesh["normalsSha256"]))
                        if method == "preview" else mesh.get("normalsSha256") is None,
                        f"{label}: {method} job has incorrect normals evidence")
            stable_output = {"meshes": meshes, "triangles": job["stats"]["triangles"], "volumeMm3": job["stats"]["volumeMm3"]}
            require(stable_output == repeated_meshes.setdefault(method, stable_output),
                    f"{label}: repeated {method} output changed")
    require(counts["step"] > 0, f"{label}: package profile contains no STEP job")
    return {"methods": dict(counts), "stepSnapshotHashesVerified": counts["step"],
            "meshRepeatFingerprintsVerified": {method: counts[method] for method in repeated_meshes},
            "meshSourceEvidence": "Mesh jobs share the saved input snapshot; their profiles do not contain a separate per-job source hash."}


def compare_run_evidence(before: Package, after: Package, variant: str) -> dict[str, Any]:
    """Optional profiling artifacts are evidence, never a replacement for STEP checks."""
    evidence: dict[str, Any] = {"profilesAvailable": False, "inputSnapshotsAvailable": False}
    if before.input_bytes is not None or after.input_bytes is not None:
        require(before.input_bytes is not None and after.input_bytes is not None,
                "Only one run contains its input snapshot")
        require(before.input_bytes == after.input_bytes, "Profiling input snapshot bytes changed")
        require(json.loads(before.input_bytes) == before.project,
                "Profiling input and exported project JSON disagree")
        evidence.update(inputSnapshotsAvailable=True, inputSha256=sha256(before.input_bytes))
    if before.run_profile is not None or after.run_profile is not None:
        require(before.run_profile is not None and after.run_profile is not None,
                "Only one run contains its memory profile")
        for key in ("sourceSha256", "sharpControl", "diagnosticOnly", "overrides"):
            require(before.run_profile.get(key) == after.run_profile.get(key),
                    f"Profiling source or variant differs: {key}")
        require(bool(before.run_profile["sharpControl"]) == (variant == "sharp-diagnostic"),
                "Requested variant does not match the actual profiled input")
        require(after.run_profile["limitMiB"] == 512, "Optimized profiling run raised the 512 MiB guard")
        job_evidence = {label: validate_profile_jobs(package, label)
                        for label, package in (("baseline", before), ("optimized", after))}
        require(after.run_profile["peakWasmBytes"] <= MEMORY_LIMIT_BYTES,
                "Optimized repeated-job peak exceeded the 512 MiB guard")
        evidence.update(profilesAvailable=True, sourceSha256=before.run_profile["sourceSha256"],
                        baselineGuardMiB=before.run_profile["limitMiB"],
                        optimizedGuardMiB=after.run_profile["limitMiB"],
                        baselineJobs=len(before.run_profile["jobs"]),
                        optimizedJobs=len(after.run_profile["jobs"]),
                        jobEvidence=job_evidence,
                        engineArtifacts={label: {key: package.run_profile.get(key)
                                                for key in ("engineWasmSha256", "engineLoaderSha256")}
                                         for label, package in (("before", before), ("after", after))},
                        overrides=before.run_profile.get("overrides", []))
    return evidence


def compare_packages(before: Package, after: Package, native: NativeReader,
                     difference_mode: str, result: dict[str, Any], expected_after_engine: str | None = None) -> None:
    require(before.files["design.pocketry.json"] == after.files["design.pocketry.json"],
            "Source project bytes changed between baseline and optimized export")
    require(before.project == after.project, "Source project JSON changed")
    require(before.objects["reconstructionOrder"] == after.objects["reconstructionOrder"],
            "Reconstruction order changed")
    require(list(before.by_id) == list(after.by_id), "Named object IDs or ordering changed")
    for ident in before.by_id:
        require(metadata_without_measurements(before.by_id[ident]) == metadata_without_measurements(after.by_id[ident]),
                f"{ident}: object name, status, placement, source link or metadata changed")
    result["engineVersions"] = compare_engine_versions(before, after, expected_after_engine)
    for key in ("units", "modelingToleranceMm", "booleanRetryToleranceMm", "dimensions", "solidCounts"):
        require(before.report[key] == after.report[key], f"Export report {key} changed")
    require(after.report["peakWasmMemoryBytes"] <= MEMORY_LIMIT_BYTES,
            "Optimized export exceeded the unchanged 512 MiB guard")
    result["snapshotSha256"] = before.snapshot_hash
    result["sourceIdentity"] = {"bytesEqual": True, "jsonEqual": True}
    result["memory"] = {"baselineReportedPeakBytes": before.report["peakWasmMemoryBytes"],
                        "optimizedReportedPeakBytes": after.report["peakWasmMemoryBytes"],
                        "requiredOptimizedLimitBytes": MEMORY_LIMIT_BYTES,
                        "note": "Reported allocated WASM capacity; this reader does not measure browser/process memory or infer the baseline guard configuration."}
    result["files"] = {}
    for filename in ("bin.step", "design-objects.step"):
        left, left_components = native.read(before.directory / filename)
        right, right_components = native.read(after.directory / filename)
        require(list(left_components) == list(right_components), f"{filename}: named components/order changed")
        file_result: dict[str, Any] = {"components": {}, "stepBytesEqual": before.files[filename] == after.files[filename]}
        result["files"][filename] = file_result
        pairs = [("assembly", left, right)]
        for name, component in left_components.items():
            other = right_components[name]
            require(component["name"] == other["name"], f"{filename}/{name}: geometry-associated name changed")
            require(component["assemblyPath"] == other["assemblyPath"], f"{filename}/{name}: assembly path changed")
            require(close_values(component["placement"], other["placement"], 1e-12), f"{filename}/{name}: assembly placement changed")
            pairs.append((name, component["shape"], other["shape"]))
        for name, left_shape, right_shape in pairs:
            context = f"{filename}/{name}"
            measured_before = native.measure(left_shape, "baseline " + context)
            measured_after = native.measure(right_shape, "optimized " + context)
            require(math.isclose(measured_before["volumeMm3"], measured_after["volumeMm3"], rel_tol=1e-9, abs_tol=VOLUME_TOLERANCE_MM3),
                    f"{context}: volume changed")
            require(close_values(measured_before["boundsMm"], measured_after["boundsMm"], BOUNDS_TOLERANCE_MM), f"{context}: bounds changed")
            for key in ("topology", "curves", "surfaces"):
                require(measured_before[key] == measured_after[key], f"{context}: {key} changed")
            entry = {"before": measured_before, "after": measured_after}
            file_result["components"][name] = entry
            # Compare each named body independently in full mode. Construction
            # tools overlap and raised text touches the bin, so a compound cut
            # would add a different Boolean problem without strengthening the
            # equality of every located component. The cheaper bin-only mode
            # explicitly checks just the finished assembly as a whole.
            do_difference = ((filename == "bin.step" and name == "assembly" and difference_mode == "bin")
                             or (difference_mode == "all" and name != "assembly"))
            if do_difference:
                entry["symmetricDifference"] = {
                    "beforeMinusAfter": native.difference(left_shape, right_shape, context + " baseline minus optimized"),
                    "afterMinusBefore": native.difference(right_shape, left_shape, context + " optimized minus baseline"),
                }
        expected_count = before.report["solidCounts"]["bin" if filename == "bin.step" else "designObjects"]
        # The manifest counts named-body occurrences. Deliberately coincident
        # instances may share one native TShape in the imported whole assembly.
        actual_count = sum(file_result["components"][name]["before"]["topology"]["solid"] for name in left_components)
        file_result["namedSolidOccurrences"] = actual_count
        require(actual_count == expected_count,
                f"{filename}: independent solid count disagrees with export report")
        if filename == "design-objects.step":
            active_names = {item["stepInstanceName"] for item in before.by_id.values() if item["status"] != "inactive"}
            require(set(left_components) == active_names, "Missing or unexpected construction body")
            for ident, item in before.by_id.items():
                name = item["stepInstanceName"]
                if item["status"] == "inactive":
                    require(name not in left_components and item["solidCount"] == 0, f"{ident}: inactive object has dummy geometry")
                    continue
                for label, package, components in (("before", before, left_components), ("after", after, right_components)):
                    record = package.by_id[ident]
                    measured = file_result["components"][name][label]
                    require(components[name]["name"] == name and components[name]["assemblyPath"] == record["assemblyPath"],
                            f"{ident}: STEP names/path disagree with manifest")
                    require(measured["topology"]["solid"] == record["solidCount"], f"{ident}: manifest solid count mismatch")
                    require(math.isclose(measured["volumeMm3"], record["volumeMm3"], rel_tol=1e-9, abs_tol=VOLUME_TOLERANCE_MM3), f"{ident}: manifest volume mismatch")
                    bounds = [record["boundsMm"][side][axis] for side in ("min", "max") for axis in ("x", "y", "z")]
                    require(close_values(measured["boundsMm"], bounds, BOUNDS_TOLERANCE_MM), f"{ident}: manifest bounds mismatch")
    result["checksPassed"] = True
    result["geometryEquivalenceProven"] = difference_mode == "all"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--variant", choices=("authored", "sharp-diagnostic"), required=True)
    parser.add_argument("--expected-project", type=Path)
    parser.add_argument("--expected-after-engine-version", help="Explicit candidate report version for an intentional kernel change; all geometry checks remain required")
    parser.add_argument("--symmetric-difference", choices=("none", "bin", "all"), default="all")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result: dict[str, Any] = {"variant": args.variant, "before": str(args.before.resolve()), "after": str(args.after.resolve()),
                              "checksPassed": False, "geometryEquivalenceProven": False,
                              "symmetricDifferenceMode": args.symmetric_difference,
                              "tolerances": {"boundsMm": BOUNDS_TOLERANCE_MM, "volumeMm3": VOLUME_TOLERANCE_MM3,
                                             "nativeBoundaryMm": NATIVE_TOLERANCE_MM, "booleanFuzzyMm": BOOLEAN_FUZZY_MM},
                              "scope": "Independent local STEP/B-rep comparison, not native CAD GUI, browser workflow or printing qualification."}
    if args.variant == "sharp-diagnostic":
        result["limitation"] = "Sharp diagnostic only. Passing does not validate the original authored fillets or rounded Wiha design."
    try:
        with ExitStack() as stack:
            before, after = Package(args.before, stack), Package(args.after, stack)
            result["runEvidence"] = compare_run_evidence(before, after, args.variant)
            if args.expected_project:
                expected = args.expected_project.read_bytes()
                require(json.loads(expected) == before.project, "Expected normalized source snapshot does not match the packages")
                result["expectedProject"] = {"path": str(args.expected_project.resolve()), "sha256": sha256(expected), "jsonEqual": True}
            native = NativeReader()
            result["independentReader"] = native.version
            compare_packages(before, after, native, args.symmetric_difference, result, args.expected_after_engine_version)
    except Exception as error:
        result["error"] = f"{type(error).__name__}: {error}"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({key: result[key] for key in ("variant", "checksPassed", "geometryEquivalenceProven", "error") if key in result}))
    return 0 if result["checksPassed"] else 1


if __name__ == "__main__":
    sys.exit(main())
