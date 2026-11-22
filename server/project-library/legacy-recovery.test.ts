import { expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION } from "../../shared/gridfinity/project";
import { parseBinSpec } from "../../shared/gridfinity/types";
import { encode } from "../../shared/project-library/format";
import { recoverLegacyBackup } from "../../shared/project-library/legacy-recovery";

const revisionId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const project = (id: string, width: number) => ({ id, name: id, updatedAt: "2026-11-22T00:00:00.000Z",
  doc: { schemaVersion: PROJECT_SCHEMA_VERSION, spec: parseBinSpec({ gridX: width, gridY: 2, heightUnits: 6 }),
    cutouts: [], shapes: [], fingerHoles: [] } });
const revision = (index: number, parents: number[], projects: ReturnType<typeof project>[]) => ({
  format: "pocketry-folder-revision", schemaVersion: 1, id: revisionId(index), parents: parents.map(revisionId), projects,
});

function source(...revisions: ReturnType<typeof revision>[]) {
  const files = new Map(revisions.map(value => [`${value.id}.pocketry-library.json`, encode(JSON.stringify(value))]));
  files.set(`${revisionId(20)}.pocketry-library.json`, new Uint8Array());
  return {
    async *entries() { for (const name of files.keys()) yield { name, kind: "file" as const }; },
    async readLegacyRevision(name: string, maxBytes: number) {
      const bytes = files.get(name)!;
      expect(bytes.byteLength).toBeLessThanOrEqual(maxBytes);
      return { bytes, modifiedAt: 0 };
    },
  };
}

it("recovers divergent current snapshots and gives identical copies stable IDs", async () => {
  const common = project("Common", 2);
  const older = source(
    revision(1, [], [common, project("Removed", 1)]),
    revision(3, [1], [common, project("Tray", 3)]),
    revision(2, [1], [common, project("Tray", 4)]),
  );
  const recovered = await recoverLegacyBackup(older);
  expect(recovered.projects.map(value => value.name)).toEqual(["Common", "Tray", "Tray"]);
  expect(recovered.projects.slice(1).map(value => value.doc.spec)).toMatchObject([{ gridX: 4 }, { gridX: 3 }]);
  expect(new Set(recovered.projects.map(value => value.id)).size).toBe(3);
  expect(await recoverLegacyBackup(older)).toEqual(recovered);
});

it("stops recovery when the old history has missing parents or a cycle", async () => {
  await expect(recoverLegacyBackup(source(revision(1, [2], [])))).rejects.toThrow("An older revision is missing");
  await expect(recoverLegacyBackup(source(revision(1, [2], []), revision(2, [1], [])))).rejects.toThrow("contains a cycle");
});
