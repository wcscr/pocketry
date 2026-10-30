import { describe, expect, it } from "vitest";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import { EXPORT_QUALITY } from "@/lib/gridfinity/bin";
import { buildCadBinMesh } from "./mesh-build";
import { cadInvestigationFixtures } from "./fixtures";

describe("CAD printing material preflight", () => {
  it.each(["interior", "x", "y", "z", "insertion"] as const)("rejects unsupported %s coverage before touching the kernel", mode => {
    const project = cadInvestigationFixtures().mixed;
    if (mode === "interior") project.cutouts[0].colorCoverage = mode;
    else project.cutouts[0].colorFloorAxis = mode;
    // Any native access is a failure: this rejection must be inexpensive.
    const oc = new Proxy({}, {get() { throw new Error("Native kernel accessed"); }}) as OpenCascadeInstance;
    expect(() => buildCadBinMesh({spec: project.spec, layout: project, quality: EXPORT_QUALITY, pocketFloorMaterialThicknessMm: 0.6}, oc)).toThrow("pocket material coverage");
  });
});
