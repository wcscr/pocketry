/** Reproducible CAD acceptance fixtures. Run with npm exec -- tsx scripts/export-step-fixtures.ts DIR. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync } from "fflate";
import { createBasicPocket } from "../client/src/lib/gridfinity/basic-shape";
import { prepareStepBin, writeStepBinPackage } from "../client/src/lib/export/step-bin";
import { parseBinSpec } from "../shared/gridfinity/types";
import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from "../shared/gridfinity/project";
import { signedArea } from "../shared/geometry/rings";
import { BASE_TOP_RADIUS, binFootprintMm } from "../shared/gridfinity/standard";

const directory = resolve(process.argv[2] ?? "outputs/step-acceptance");
mkdirSync(directory, { recursive: true });
const rectangle = createBasicPocket("rectangle", { x: -29, y: 8 }, { x: -9, y: 24 }, "rectangle")!;
const circle = createBasicPocket("circle", { x: 14, y: -9 }, { x: 21, y: -9 }, "circle")!;
const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 4, flatBottom: true, lip: "none" });
const base: ProjectDoc = { schemaVersion: PROJECT_SCHEMA_VERSION, name: "STEP acceptance tray",
  spec, shapes: [rectangle.shape, circle.shape], fingerHoles: [], cutouts: [
    { ...rectangle.cutout, name: "Driver pocket", rotationDeg: 21, mirrored: true, scaleX: 0.8, depth: { mode: "mm", value: 12 } },
    { ...circle.cutout, name: "Rod's Ø14 🧰", depth: { mode: "through" } },
  ] };
const concave = structuredClone(base);
concave.shapes[0].source = "trace"; concave.shapes[0].sourceMmPerPx = 0.1;
concave.shapes[0].outlineMm[0].outer = [
  { x: -9, y: -7 }, { x: 9, y: -7 }, { x: 9, y: -2 }, { x: 0, y: -2 }, { x: 0, y: 7 }, { x: -9, y: 7 },
];
concave.shapes[0].pointCount = 6;
const fixtures = {
  "mixed-pockets": base,
  "concave-trace": concave,
  "empty-quarter": { ...base, shapes: [], cutouts: [], spec: { ...spec, gridPitch: "quarter" as const } },
};
const manifest = [];
for (const [name, doc] of Object.entries(fixtures)) {
  const prepared = prepareStepBin(doc);
  const width = binFootprintMm(doc.spec.gridX, doc.spec.gridPitch), length = binFootprintMm(doc.spec.gridY, doc.spec.gridPitch);
  const outerArea = width * length - (4 - Math.PI) * BASE_TOP_RADIUS ** 2;
  const cutterVolumes = prepared.cutters.map(cutter => {
    const first = cutter.loop[0];
    const area = first.kind === "arc" ? Math.PI * first.radius ** 2 : signedArea(cutter.loop.map(segment => segment.start));
    return area * (cutter.topZ - cutter.bottomZ);
  });
  const blankVolume = outerArea * prepared.body.topZ;
  const packageBytes = writeStepBinPackage(doc);
  writeFileSync(resolve(directory, `${name}-cad.zip`), packageBytes);
  const files = unzipSync(packageBytes);
  for (const [filename, bytes] of Object.entries(files)) writeFileSync(resolve(directory, `${name}-${filename}`), bytes);
  manifest.push({ name, width, length, height: prepared.body.topZ,
    binVolume: blankVolume - cutterVolumes.reduce((sum, volume) => sum + volume, 0),
    objectVolumes: [blankVolume, ...cutterVolumes], objectNames: [prepared.blank.name, ...prepared.cutters.map(cutter => cutter.name)],
  });
}
writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${manifest.length} analytic STEP fixtures to ${directory}`);
