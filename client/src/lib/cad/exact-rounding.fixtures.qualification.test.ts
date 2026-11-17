import { beforeAll, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";

import { loadManifold } from "@/lib/manifold/runtime";

import { CadContext } from "./adapter";
import { buildCadDesign } from "./build";
import { cadInvestigationFixtures } from "./fixtures";
import { resolveCadDesign } from "./model";
import { exportStepPackage, type StepExportReport } from "./package";
import { loadCad, type OpenCascadeInstance } from "./runtime";
import { createSectionKernel, SECTION_FIT_TOLERANCE_MM, type SectionKernel } from "./section-kernel";

/**
 * The shared fixtures built the way the export worker builds them: with the
 * planar section kernel present, so traced pockets get fitted sections and
 * line/arc sections get exact rounding. The same fixtures without it are
 * covered in build.qualification.test.ts.
 */

let oc: OpenCascadeInstance;
let sections: SectionKernel;
beforeAll(async () => {
  [oc, sections] = [await loadCad(), createSectionKernel(await loadManifold())];
}, 60_000);

describe("CAD fixtures with fitted sections and exact rounding", () => {
  it.each(Object.entries(cadInvestigationFixtures()))("constructs %s", (name, project) => {
    const c = new CadContext(oc);
    c.sections = sections;
    try {
      const model = resolveCadDesign(project);
      const built = buildCadDesign(c, model, name === "irregular" ? { floorThicknessMm: 0.6, rimThicknessMm: 1.25 } : {});
      expect(c.valid(built.solid)).toBe(true);
      expect(built.objects.filter((object) => object.role === "pocket-source")).toHaveLength(project.cutouts.length);
      expect(c.maxNativeToleranceMm).toBeLessThanOrEqual(0.00001);
      expect(c.rounding.maxWitnessErrorMm).toBeLessThanOrEqual(0.00001);
      // Fitted sections stay within the stated tolerance of the print path's.
      expect(c.maxSectionDeviationMm).toBeLessThanOrEqual(SECTION_FIT_TOLERANCE_MM + 1e-9);
    } finally {
      c.dispose();
    }
  }, 180_000);

  it("removes the same volume as the fillet where a true fillet exists", () => {
    // The mixed fixture's rounded rectangle has 1 mm corners and a 0.8 mm floor radius,
    // so the modeler's fillet and the section rule describe the same surface.
    const project = cadInvestigationFixtures().mixed;
    const volumeWith = (kernel?: SectionKernel) => {
      const c = new CadContext(oc);
      c.sections = kernel;
      try {
        return c.volume(buildCadDesign(c, resolveCadDesign(project)).solid);
      } finally {
        c.dispose();
      }
    };
    const filleted = volumeWith();
    const exact = volumeWith(sections);
    // Fitted traced sections sit up to the tolerance outside, so pockets are very slightly larger.
    expect(exact).toBeLessThanOrEqual(filleted + 1e-6);
    expect(filleted - exact).toBeLessThan(0.01 * filleted);
  }, 180_000);

  it("reports the fit and the rounding in the package", async () => {
    const result = await exportStepPackage(cadInvestigationFixtures().concave, oc, () => {}, sections);
    const report = JSON.parse(strFromU8(unzipSync(result.bytes)["export-report.json"])) as StepExportReport;
    expect(report.exporterVersion).toBe("pocketry-cad-investigation-3");
    expect(report.sectionFit?.toleranceMm).toBe(SECTION_FIT_TOLERANCE_MM);
    expect(report.sectionFit!.maxDeviationMm).toBeGreaterThan(0);
    expect(report.sectionFit!.maxDeviationMm).toBeLessThanOrEqual(SECTION_FIT_TOLERANCE_MM + 1e-9);
    expect(report.exactRounding!.bands).toBeGreaterThan(0);
    expect(report.exactRounding!.witnesses).toBeGreaterThan(0);
    expect(report.maxNativeBoundaryToleranceMm).toBeLessThanOrEqual(0.00001);
  }, 180_000);
});
