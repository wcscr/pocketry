import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { ConnectedLibrary } from "../../shared/project-library/library";
import { readFolderProject } from "../../shared/project-library/format";
import { NodeLibraryFolder } from "../project-library/node-folder";
import { folderFixture, modelBrowserFolder } from "../project-library/folder.test-support";
import { AutomationService } from "./service";

let root: string;
let folder: NodeLibraryFolder;
let library: ConnectedLibrary;
let service: AutomationService;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pocketry-commands-"));
  folder = await NodeLibraryFolder.connect(root);
  library = new ConnectedLibrary(folder);
  service = makeService(library);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function makeService(target: ConnectedLibrary) {
  return new AutomationService(target, {
    write: (extension, bytes) => folder.publishArtifact(extension, bytes),
    model: async () => { throw new Error("Geometry is qualified separately."); },
  });
}

describe("local automation commands", () => {
  it("copies and edits a browser-saved project with new identity and one undo step", async () => {
    const doc = readFolderProject(JSON.parse(await readFile("samples/wiha-60mm-drivers/wiha-60mm-drivers.pocketry.json", "utf8")));
    const browser = new ConnectedLibrary(modelBrowserFolder(root).folder);
    await browser.commit({ requestId: "browser-original", changes: [{ projectId: "wiha", parents: [], name: doc.name!, doc }] });
    const original = await browser.read("wiha");
    const label = original.doc.spec.surfaceTexts[0];
    const input = {
      projectId: "wiha", revision: original.revision, requestId: "copy-edit", expectedBase: null,
      name: "Driver set", edits: [
        { type: "set_label_text", labelId: label.id, text: "Torx" },
        { type: "set_materials", settings: { binColor: "#334455" } },
      ],
    };
    const copied = await service.commands.copy_project.execute(input, new AbortController().signal);
    if (!("publications" in copied.outcome)) throw new Error("Missing publication");
    const { revision, projectIds: [id] } = copied.outcome.publications[0];
    const reopened = await browser.read(id, revision);
    expect(reopened.doc.name).toBe(input.name);
    expect(reopened.doc.shapes).toEqual(original.doc.shapes);
    expect(reopened.doc.cutouts).toEqual(original.doc.cutouts);
    expect(reopened.doc.fingerHoles).toEqual(original.doc.fingerHoles);
    expect(reopened.doc.spec.surfaceTexts[0]).toEqual({ ...label, text: "Torx" });
    expect(reopened.doc.materials).toMatchObject({ binColor: "#334455" });
    expect(reopened.doc.history!.stack).toHaveLength((original.doc.history?.index ?? 0) + 2);
    const restarted = makeService(new ConnectedLibrary(await NodeLibraryFolder.connect(root)));
    expect(await restarted.execute("copy_project", input)).toEqual({ outcome: copied.outcome });
    await expect(restarted.execute("copy_project", { ...input, name: "Other" })).rejects.toMatchObject({ code: "request-reused" });
    expect(await readdir(root)).toHaveLength(2);

    const summary = await restarted.commands.read_project.execute({ projectId: id }, new AbortController().signal);
    expect(summary).toMatchObject({ projectId: id, revision, summary: { pockets: 2, labels: 1 } });
    expect(summary).not.toHaveProperty("geometry");
    expect(summary).not.toHaveProperty("history");
    const output = await restarted.commands.export_revision.execute({ projectId: id, revision, format: "backup" }, new AbortController().signal);
    expect(readFolderProject(JSON.parse(await readFile(output.artifact.path, "utf8")))).toEqual(reopened.doc);
  });

  it("validates the whole batch and preserves the original file on late rejection", async () => {
    const doc = folderFixture();
    await library.commit({ requestId: "create", changes: [{ projectId: "bin", name: doc.name, doc, parents: [] }] });
    const base = await library.read("bin");
    const change = { type: "set_compartments", settings: { columns: 3 } };
    await expect(service.execute("commit_project", {
      requestId: "invalid", projectId: "bin", expectedBase: base.revision,
      edits: [change, { type: "set_pocket_clearance", pocketId: "missing", clearanceMm: 1 }],
    })).rejects.toMatchObject({ code: "validation", details: { editIndex: 1 } });
    expect((await library.read("bin")).doc).toEqual(base.doc);
    expect(await library.inspect("invalid")).toMatchObject({ status: "not-found" });
    const edit = { requestId: "valid", projectId: "bin", expectedBase: base.revision, edits: [change] };
    await expect(service.execute("commit_project", edit)).resolves.toMatchObject({ outcome: { status: "published" } });
    await expect(makeService(new ConnectedLibrary(folder)).execute("commit_project", edit)).resolves.toMatchObject({ outcome: { status: "published" } });
    await expect(service.execute("commit_project", { ...edit, requestId: "stale" })).rejects.toMatchObject({ code: "stale-base" });
    expect(await readdir(root)).toHaveLength(2);
  });

  it("starts the same two-row grid as the browser when enabling unused compartments", async () => {
    const doc = folderFixture("Empty hollow bin", 1);
    await library.commit({ requestId: "new-hollow", changes: [{ projectId: "hollow", parents: [], name: doc.name, doc }] });
    const { revision } = await library.read("hollow");
    const result = await service.commands.apply_edits.execute({
      projectId: "hollow", revision, edits: [{ type: "set_compartments", settings: { enabled: true } }],
    }, new AbortController().signal);
    expect(result.summary.compartments).toMatchObject({ enabled: true, rows: 2, columns: 1 });
    expect(result.validation.ok).toBe(true);
    expect((await library.read("hollow")).revision).toBe(revision);
  });

  it("uses bounded project pages and rejects unsupported versions and arbitrary patches", async () => {
    for (const suffix of ["a", "b"]) {
      const input = { name: "New bin " + suffix, requestId: "new-" + suffix, expectedBase: null };
      await service.execute("create_project", input);
      await expect(makeService(new ConnectedLibrary(folder)).execute("create_project", input)).resolves.toMatchObject({ outcome: { status: "published" } });
    }
    const first = await service.commands.list_projects.execute({ limit: 1 }, new AbortController().signal);
    expect(first.projects).toHaveLength(1);
    const next = await service.commands.list_projects.execute({ after: first.nextAfter, limit: 1 }, new AbortController().signal);
    expect(next.projects).toHaveLength(1);
    expect(next.projects[0].projectId).not.toBe(first.projects[0].projectId);
    expect(next.nextAfter).toBeNull();
    await expect(service.execute("import_project", {
      name: "Future project", requestId: "future", expectedBase: null, document: { schemaVersion: 700 },
    })).rejects.toMatchObject({ code: "unsupported-version" });
    await expect(service.execute("apply_edits", {
      projectId: next.projects[0].projectId, revision: next.projects[0].heads[0].revision,
      edits: [{ type: "set_compartments", settings: { columns: 3 }, arbitrary: "gridX" }],
    })).rejects.toMatchObject({ code: "validation" });
  });
});
