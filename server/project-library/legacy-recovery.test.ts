import { expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION } from "../../shared/gridfinity/project";
import { parseBinSpec } from "../../shared/gridfinity/types";
import { PublicationRejected } from "../../shared/project-library/adapter";
import { encode, FOLDER_LIMITS } from "../../shared/project-library/format";
import { publishRecoveredLibrary, recoverLegacyBackup } from "../../shared/project-library/legacy-recovery";
import { ConnectedLibrary } from "../../shared/project-library/library";

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

it("opens a recovery only after every batch and resumes without duplicating projects", async () => {
  const projects = Array.from({ length: FOLDER_LIMITS.changes + 1 }, (_, index) => project(`Tray ${index}`, 2));
  const backup = await recoverLegacyBackup(source(revision(1, [], projects)));
  const files = new Map<string, Uint8Array>();
  let interrupt = true;
  const destination = {
    async *entries() { for (const name of files.keys()) yield { name, kind: "file" as const }; },
    async read(name: string) { return files.has(name) ? { bytes: files.get(name)!, modifiedAt: 0 } : null; },
    async publish(name: string, bytes: Uint8Array) {
      if (interrupt && files.size) throw new PublicationRejected(new Error("Interrupted"));
      files.set(name, bytes);
    },
  };

  await expect(publishRecoveredLibrary(backup, destination)).rejects.toThrow("Interrupted");
  expect(files.size).toBe(1);
  const reopened = new ConnectedLibrary(destination);
  expect(await reopened.hasCompletedLegacyRecovery()).toBe(false);

  interrupt = false;
  await publishRecoveredLibrary(backup, destination);
  await publishRecoveredLibrary(backup, destination);
  expect(await reopened.hasCompletedLegacyRecovery()).toBe(true);
  expect(await reopened.list()).toHaveLength(projects.length);
  expect(files.size).toBe(2);
});
