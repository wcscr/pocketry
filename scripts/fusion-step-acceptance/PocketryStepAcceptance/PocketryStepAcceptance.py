"""Run through Fusion's supported Scripts and Add-Ins UI, never outside Fusion.

Uses only local imports and archive/STEP exports. It never calls cloud save or
upload APIs, and only closes documents created by this script. Results start
as running, and each fixture is marked passed only after its native checks.
"""
import hashlib
import json
from pathlib import Path
import time
import traceback

import adsk.core
import adsk.fusion


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def collection(items):
    result = adsk.core.ObjectCollection.create()
    for item in items:
        result.add(item)
    return result


def entries(design):
    root = design.rootComponent
    result = [(body, root.name) for body in root.bRepBodies]
    for occurrence in root.allOccurrences:
        result.extend((body, occurrence.fullPathName) for body in occurrence.bRepBodies)
    return result


def measure(body, path):
    bounds = body.preciseBoundingBox
    props = body.getPhysicalProperties(adsk.fusion.CalculationAccuracy.VeryHighCalculationAccuracy)
    return {
        "name": body.name, "path": path,
        "isSolid": body.isSolid, "volumeMm3": props.volume * 1000,
        "minMm": [bounds.minPoint.x * 10, bounds.minPoint.y * 10, bounds.minPoint.z * 10],
        "maxMm": [bounds.maxPoint.x * 10, bounds.maxPoint.y * 10, bounds.maxPoint.z * 10],
        "faces": body.faces.count, "edges": body.edges.count,
    }


def inspect(design):
    records = [measure(body, path) for body, path in entries(design)]
    require(records and all(item["isSolid"] for item in records), "Imported open/non-solid geometry")
    require(all(item["volumeMm3"] > 0 for item in records), "Imported empty geometry")
    return records


def curve_evidence(bodies):
    circles = set()
    arcs = set()
    cylinders = set()
    ellipses = set()
    surfaces = set()
    for body in bodies:
        for face in body.faces:
            surfaces.add(face.geometry.objectType)
            cylinder = adsk.core.Cylinder.cast(face.geometry)
            if cylinder:
                cylinders.add(round(cylinder.radius * 10, 8))
        for edge in body.edges:
            geometry = edge.geometry
            circle = adsk.core.Circle3D.cast(geometry)
            arc = adsk.core.Arc3D.cast(geometry)
            if arc:
                arcs.add(round(arc.radius * 10, 8))
            ellipse = adsk.core.Ellipse3D.cast(geometry)
            if circle:
                circles.add(round(circle.radius * 10, 8))
            if ellipse:
                ellipses.add((round(ellipse.majorRadius * 10, 8), round(ellipse.minorRadius * 10, 8)))
    return {"circleRadiiMm": sorted(circles), "arcRadiiMm": sorted(arcs), "cylinderRadiiMm": sorted(cylinders), "ellipseRadiiMm": sorted(ellipses), "surfaceTypes": sorted(surfaces)}


def healthy(feature):
    require(feature is not None, "Native feature creation returned no feature")
    require(feature.healthState == adsk.fusion.FeatureHealthStates.HealthyFeatureHealthState,
            "Feature failed: " + feature.errorOrWarningMessage)


def native(body):
    return body.nativeObject or body


def native_design(document):
    design = adsk.fusion.Design.cast(document.products.itemByProductType("DesignProductType"))
    require(design is not None, "STEP import did not create a Fusion design")
    return design


def import_local(app, path, documents):
    manager = app.importManager
    if path.suffix.lower() == ".f3d":
        options = manager.createFusionArchiveImportOptions(str(path))
    else:
        options = manager.createSTEPImportOptions(str(path))
    document = manager.importToNewDocument(options)
    require(document is not None, "Fusion local import failed: " + str(path))
    documents.append(document)
    return document, native_design(document)


def export_local(design, path, geometry=None):
    manager = design.exportManager
    if path.suffix == ".f3d":
        options = manager.createFusionArchiveExportOptions(str(path), geometry)
    else:
        options = manager.createSTEPExportOptions(str(path), geometry)
    require(manager.execute(options), "Native export failed: " + str(path))
    require(path.exists() and path.stat().st_size > 100, "No native export bytes: " + str(path))


def add_hole(design, fixture):
    design.designType = adsk.fusion.DesignTypes.ParametricDesignType
    body = native(max(entries(design), key=lambda entry: entry[0].volume)[0])
    before = measure(body, "target")
    component = body.parentComponent
    planes = component.constructionPlanes
    plane_input = planes.createInput()
    require(plane_input.setByOffset(component.xYConstructionPlane, adsk.core.ValueInput.createByString("-2 mm")), "Hole plane failed")
    plane = planes.add(plane_input)
    sketch = component.sketches.add(plane)
    sketch.name = "Pocketry Fusion edit — 4 mm hole"
    x, y = (-15, -15) if fixture == "irregular" else (0, 0)
    sketch.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(x / 10, y / 10, 0), 0.2)
    require(sketch.profiles.count == 1, "Hole sketch did not yield one closed profile")
    extrudes = component.features.extrudeFeatures
    extrude_input = extrudes.createInput(sketch.profiles.item(0), adsk.fusion.FeatureOperations.CutFeatureOperation)
    extent = adsk.fusion.DistanceExtentDefinition.create(adsk.core.ValueInput.createByString("100 mm"))
    require(extrude_input.setOneSideExtent(extent, adsk.fusion.ExtentDirections.PositiveExtentDirection), "Hole extent failed")
    extrude_input.participantBodies = [body]
    feature = extrudes.add(extrude_input)
    feature.name = "Pocketry Fusion edit — through hole"
    healthy(feature)
    after = measure(body, "target")
    require(after["isSolid"] and after["volumeMm3"] < before["volumeMm3"] - 0.01, "Hole did not remove material")
    return {"feature": feature.name, "beforeMm3": before["volumeMm3"], "afterMm3": after["volumeMm3"], "removedMm3": before["volumeMm3"] - after["volumeMm3"]}


def mapped_objects(design, manifest):
    imported = entries(design)
    mapped = {}
    for obj in manifest["objects"]:
        matches = [(body, path) for body, path in imported if "[" + obj["id"] + "]" in path or "[" + obj["id"] + "]" in body.name]
        expected = obj.get("solidCount", 0) if obj["status"] == "active" else 0
        require(len(matches) == expected, "Named object count failed for " + obj["id"] + ": " + str(len(matches)) + "/" + str(expected))
        mapped[obj["id"]] = matches
    return mapped


def reconstruct(design, manifest, mapped, name):
    root = design.rootComponent
    occurrence = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    component = occurrence.component
    component.name = name
    blank = mapped["bin-blank"][0][0].copyToComponent(occurrence)
    require(blank is not None and blank.parentComponent == component, "Blank copy was placed in the wrong component")
    blank.name = name
    tools = []
    texts = []
    objects = {obj["id"]: obj for obj in manifest["objects"]}
    for object_id in manifest["reconstructionOrder"]:
        obj = objects[object_id]
        if object_id == "bin-blank" or obj["status"] != "active":
            continue
        if obj["role"] == "text-body":
            texts.extend(body for body, _ in mapped[object_id])
            continue
        for body, _ in mapped[object_id]:
            tool = body.copyToComponent(occurrence)
            tool.name = obj["stepInstanceName"]
            combine_input = component.features.combineFeatures.createInput(blank, collection([tool]))
            combine_input.operation = adsk.fusion.FeatureOperations.CutFeatureOperation
            combine_input.isKeepToolBodies = True
            feature = component.features.combineFeatures.add(combine_input)
            feature.name = "Cut with " + obj["id"]
            healthy(feature)
            tool.isLightBulbOn = False
            tools.append(tool)
    require(blank.isSolid, "Reconstruction produced an open body")
    clean_occurrence = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    clean_component = clean_occurrence.component
    clean_component.name = name + " — export"
    require(blank.copyToComponent(clean_occurrence) is not None, "Reconstruction export copy failed")
    for body in texts:
        require(body.copyToComponent(clean_occurrence) is not None, "Text export copy failed")
    occurrence.isLightBulbOn = False
    total_volume = sum(body.getPhysicalProperties(adsk.fusion.CalculationAccuracy.VeryHighCalculationAccuracy).volume * 1000 for body in clean_component.bRepBodies)
    return clean_component, {"volumeMm3": total_volume, "bodyCount": clean_component.bRepBodies.count, "toolCount": len(tools)}


def move_cutter(design, manifest, mapped):
    obj = next((obj for obj in manifest["objects"] if obj["role"] == "pocket-cutter" and obj["status"] == "active"), None)
    if not obj:
        return None
    body, path = mapped[obj["id"]][0]
    before = measure(body, path)
    source_id = "source:" + obj["sourceId"]
    source_before = [measure(source, source_path) for source, source_path in mapped.get(source_id, [])]
    target = native(body)
    moves = target.parentComponent.features.moveFeatures
    move_input = moves.createInput2(collection([target]))
    require(move_input.defineAsTranslateXYZ(adsk.core.ValueInput.createByString("3 mm"), adsk.core.ValueInput.createByString("0 mm"), adsk.core.ValueInput.createByString("0 mm"), True), "Cutter translation definition failed")
    feature = moves.add(move_input)
    feature.name = "Move " + obj["id"] + " by 3 mm"
    healthy(feature)
    after = measure(body, path)
    require(abs(after["minMm"][0] - before["minMm"][0] - 3) < 0.0001, "Named cutter did not move by 3 mm")
    source_after = [measure(source, source_path) for source, source_path in mapped.get(source_id, [])]
    require(source_before == source_after, "Moving cutter changed the original source object")
    return {"id": obj["id"], "deltaMm": [3, 0, 0], "before": before, "after": after, "sourceUnchanged": True, "feature": feature.name}


def timeline(design):
    result = []
    for component in design.allComponents:
        for feature in component.features:
            result.append({"component": component.name, "feature": feature.name, "health": int(feature.healthState)})
    return result


def run(context):
    app = adsk.core.Application.get()
    original_document = app.activeDocument
    folder = Path(__file__).parent
    config = json.loads((folder / "config.json").read_text(encoding="utf-8"))
    output = Path(config["outputRoot"])
    output.mkdir(parents=True, exist_ok=True)
    report = {"status": "running", "fusionVersion": app.version, "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "method": "Native Fusion supported Python API; local imports and local F3D/STEP exports", "cases": []}
    report_path = output / "fusion-edit-report.json"

    def save_report():
        temporary = report_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(report, ensure_ascii=True, indent=2), encoding="utf-8")
        temporary.replace(report_path)

    save_report()
    try:
        for approach in config["approaches"]:
            for fixture in config["fixtures"]:
                documents = []
                case = {"approach": approach, "fixture": fixture, "status": "running"}
                report["cases"].append(case)
                save_report()
                try:
                    app.userInterface.statusMessage = "Pocketry Fusion test: " + approach + " / " + fixture
                    adsk.doEvents()
                    source = Path(config["fixturesRoot"]) / approach / fixture
                    destination = output / approach / fixture
                    destination.mkdir(parents=True, exist_ok=True)
                    manifest = json.loads((source / "objects.json").read_text(encoding="utf-8"))
                    export_report = json.loads((source / "export-report.json").read_text(encoding="utf-8"))
                    case["inputSha256"] = {filename: hashlib.sha256((source / filename).read_bytes()).hexdigest() for filename in ["bin.step", "design-objects.step", "objects.json"]}
                    case["snapshotSha256"] = manifest["snapshotSha256"]
                    bin_document, bin_design = import_local(app, source / "bin.step", documents)
                    case["binImport"] = inspect(bin_design)
                    save_report()
                    require(len(case["binImport"]) == export_report["solidCounts"]["bin"], "Finished solid count differs from export report")
                    expected_dimensions = {
                        "standard-solid": [41.5, 41.5, 24.551471862576],
                        "standard-hollow": [83.5, 41.5, 24.551471862576],
                        "mixed": [125.5, 83.5, 31.551471862576],
                        "concave": [125.5, 83.5, 28],
                        "tilted": [125.5, 125.5, 35],
                        "irregular": [83.5, 83.5, 31.551471862576],
                    }[fixture]
                    case["dimensionsMm"] = [max(item["maxMm"][axis] for item in case["binImport"]) - min(item["minMm"][axis] for item in case["binImport"]) for axis in range(3)]
                    require(all(abs(a - b) < 0.0001 for a, b in zip(case["dimensionsMm"], expected_dimensions)), "Fusion import dimensions differ from the fixture")
                    original_volume = sum(item["volumeMm3"] for item in case["binImport"])
                    case["binCurves"] = curve_evidence([body for body, _ in entries(bin_design)])
                    require(3.75 in case["binCurves"]["arcRadiiMm"], "Analytic 3.75 mm bin corner missing")
                    case["holeEdit"] = add_hole(bin_design, fixture)
                    save_report()
                    export_local(bin_design, destination / "bin-edited.f3d")
                    export_local(bin_design, destination / "bin-edited.step")
                    _, reopened_bin = import_local(app, destination / "bin-edited.f3d", documents)
                    case["binArchiveReopen"] = inspect(reopened_bin)
                    case["binArchiveFeatures"] = timeline(reopened_bin)
                    require(any("through hole" in item["feature"] for item in case["binArchiveFeatures"]), "New native feature did not survive archive reopen")
                    _, reopened_step = import_local(app, destination / "bin-edited.step", documents)
                    case["binStepReopen"] = inspect(reopened_step)
                    edited_volume = original_volume - case["holeEdit"]["removedMm3"]
                    for reopened in [case["binArchiveReopen"], case["binStepReopen"]]:
                        require(len(reopened) == len(case["binImport"]), "Edited reopen changed the number of solids")
                    archive_delta = sum(item["volumeMm3"] for item in case["binArchiveReopen"]) - edited_volume
                    require(abs(archive_delta) < 0.00001, "Fusion archive reopen changed volume")
                    step_delta = sum(item["volumeMm3"] for item in case["binStepReopen"]) - edited_volume
                    case["stepReopenVolumeEstimateDifferenceMm3"] = step_delta
                    if abs(step_delta) > max(0.01, edited_volume * 0.000001):
                        case.setdefault("warnings", []).append("Fusion's numerical volume estimate differs after STEP reimport. Independent boundary comparison is required; do not infer geometry equivalence from this estimate.")
                    case["binStepReopenCurves"] = curve_evidence([body for body, _ in entries(reopened_step)])
                    require(2.0 in case["binStepReopenCurves"]["circleRadiiMm"], "New 4 mm hole did not survive STEP reopen")
                    tools_document, tools_design = import_local(app, source / "design-objects.step", documents)
                    case["objectsImport"] = inspect(tools_design)
                    require(len(case["objectsImport"]) == export_report["solidCounts"]["designObjects"], "Source/tool solid count differs from export report")
                    save_report()
                    mapped = mapped_objects(tools_design, manifest)
                    for obj in manifest["objects"]:
                        if obj["status"] != "active":
                            continue
                        observed = [measure(body, path) for body, path in mapped[obj["id"]]]
                        lower = [min(item["minMm"][axis] for item in observed) for axis in range(3)]
                        upper = [max(item["maxMm"][axis] for item in observed) for axis in range(3)]
                        expected = [*obj["boundsMm"]["min"].values(), *obj["boundsMm"]["max"].values()]
                        require(all(abs(a - b) < 0.0001 for a, b in zip(lower + upper, expected)), "Source/tool placement differs for " + obj["id"])
                    case["objectCurves"] = {key: curve_evidence([body for body, _ in value]) for key, value in mapped.items() if value}
                    if fixture == "mixed":
                        require(6.0 in case["objectCurves"]["source:cutout-circle"]["circleRadiiMm"], "6 mm source circle lost its analytic radius")
                        require(sum("Clé Ø — duplicate" in item["path"] for item in case["objectsImport"]) >= 2, "Duplicate Unicode object names missing")
                    if fixture == "concave":
                        require((9.8, 4.9) in case["objectCurves"]["source:ellipse"]["ellipseRadiiMm"], "Scaled-circle source lost its analytic ellipse")
                    tools_design.designType = adsk.fusion.DesignTypes.ParametricDesignType
                    baseline_component, case["baselineReconstruction"] = reconstruct(tools_design, manifest, mapped, "Pocketry baseline reconstruction")
                    export_local(tools_design, destination / "reconstructed-original.step", baseline_component)
                    difference = case["baselineReconstruction"]["volumeMm3"] - original_volume
                    case["baselineReconstruction"]["differenceFromOriginalMm3"] = difference
                    require(abs(difference) < max(0.1, original_volume * 0.00001), "Named tool reconstruction differs from finished bin")
                    case["cutterMove"] = move_cutter(tools_design, manifest, mapped)
                    if case["cutterMove"]:
                        moved_component, case["movedReconstruction"] = reconstruct(tools_design, manifest, mapped, "Pocketry moved cutter reconstruction")
                        export_local(tools_design, destination / "reconstructed-moved.step", moved_component)
                        _, moved_reopened = import_local(app, destination / "reconstructed-moved.step", documents)
                        case["movedStepReopen"] = inspect(moved_reopened)
                    export_local(tools_design, destination / "design-objects-edited.f3d")
                    _, reopened_tools = import_local(app, destination / "design-objects-edited.f3d", documents)
                    case["objectsArchiveReopen"] = inspect(reopened_tools)
                    case["objectsArchiveFeatures"] = timeline(reopened_tools)
                    require(not case["cutterMove"] or any(item["feature"] == case["cutterMove"]["feature"] for item in case["objectsArchiveFeatures"]), "Move feature did not survive archive reopen")
                    case["status"] = "passed"
                except Exception:
                    case["status"] = "failed"
                    case["error"] = traceback.format_exc()
                finally:
                    for document in reversed(documents):
                        try:
                            document.close(False)
                        except Exception:
                            case.setdefault("cleanupErrors", []).append(traceback.format_exc())
                    save_report()
        report["status"] = "passed" if all(case["status"] == "passed" for case in report["cases"]) else "failed"
    except Exception:
        report["status"] = "failed"
        report["error"] = traceback.format_exc()
    finally:
        report["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        save_report()
        app.userInterface.statusMessage = "Pocketry Fusion tests: " + report["status"]
        if original_document and original_document.isValid:
            original_document.activate()
        app.userInterface.messageBox("Pocketry Fusion tests: " + report["status"] + "\nLocal results: " + str(report_path))
