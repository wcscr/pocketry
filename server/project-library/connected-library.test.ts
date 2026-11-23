import { mkdtemp, readFile, readdir, rm, symlink, link, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectedLibrary, type Mutation } from "../../shared/project-library/library";
import { canonicalJson, digest, encode, FOLDER_LIMITS, revisionFile } from "../../shared/project-library/format";
import { folderFixture, modelBrowserFolder, raceFolders } from "./folder.test-support";
import { NodeLibraryFolder } from "./node-folder";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "pocketry-journal-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function save(requestId: string, columns = 2, parents: string[] = []): Mutation {
  const doc = folderFixture("Socket bin", columns);
  return { requestId, changes: [{ projectId: "socket-bin", parents, name: doc.name, doc }] };
}

async function head(library: ConnectedLibrary) {
  return (await library.list())[0].heads[0].revision;
}

describe.each(["node", "browser model"] as const)("%s adapter conformance", adapter => {
  const connect = async () => adapter === "node" ? NodeLibraryFolder.connect(root) : modelBrowserFolder(root).folder;

  it("opens a durable revision and identifies retries after reconnect", async () => {
    const mutation = save("copy-once");
    const initial = await new ConnectedLibrary(await connect()).commit(mutation);
    const reopened = new ConnectedLibrary(await connect());
    expect(await reopened.commit(mutation)).toEqual(initial);
    expect(await reopened.inspect(mutation.requestId)).toEqual(initial);
    await expect(reopened.commit(save(mutation.requestId, 3))).rejects.toMatchObject({ code: "request-reused" });
    expect((await reopened.read("socket-bin")).doc.spec.compartments.columns).toBe(2);
    expect(await readdir(root)).toHaveLength(1);
  });

  it("can distinguish removed projects from IDs that have never been copied", async () => {
    const library = new ConnectedLibrary(await connect());
    await library.commit(save("copied"));
    const base = await head(library);
    await library.commit({ requestId: "removed", changes: [{
      ...save("unused").changes[0], parents: [base], doc: null,
    }] });
    expect(await library.list()).toEqual([]);
    expect(await library.list({ includeDeleted: true })).toMatchObject([
      { projectId: "socket-bin", heads: [{ deleted: true }] },
    ]);
  });

  it("reconciles a lost reply and records publication even when verification fails", async () => {
    const folder = await connect();
    let lost = false;
    const library = new ConnectedLibrary({
      entries: () => {
        if (lost) throw new Error("Readback unavailable");
        return folder.entries();
      },
      read: (name, max) => lost ? Promise.reject(new Error("Readback unavailable")) : folder.read(name, max),
      publish: async (name, bytes) => {
        await folder.publish(name, bytes);
        lost = true;
        throw new Error("Lost reply after write");
      },
    });
    expect(await library.commit(save("lost"))).toMatchObject({ status: "uncertain" });
    const reopened = new ConnectedLibrary(await connect());
    expect(await reopened.commit(save("lost"))).toMatchObject({ status: "published" });
    const base = await head(reopened);
    lost = false;
    const verifiedWrite = new ConnectedLibrary({
      entries: () => { if (lost) throw new Error("Readback unavailable"); return folder.entries(); },
      read: (name, max) => folder.read(name, max),
      publish: async (name, bytes) => { await folder.publish(name, bytes); lost = true; },
    });
    const outcome = await verifiedWrite.commit(save("verified-write", 3, [base]));
    expect(outcome).toMatchObject({ status: "published-unverified" });
    expect(await verifiedWrite.inspect("verified-write", "revision" in outcome ? outcome.revision : undefined)).toEqual(outcome);
    expect(await reopened.inspect("verified-write")).toMatchObject({ status: "published" });
    expect(await readdir(root)).toHaveLength(2);
  });

  it("fails closed on corrupt, unsupported, missing-parent and oversized files", async () => {
    const folder = await connect();
    const library = new ConnectedLibrary(folder);
    const key = await digest(encode("bad"));
    const future = revisionFile(key, "b".repeat(64)).replace("pocketry-r2-", "pocketry-r99-");
    await writeFile(join(root, future), "future");
    await expect(library.list()).rejects.toMatchObject({ code: "unsupported-version" });
    expect(await readFile(join(root, future), "utf8")).toBe("future");
    await rm(join(root, future));
    const broken = revisionFile(key, "b".repeat(64));
    await writeFile(join(root, broken), "{");
    await expect(library.commit(save("safe"))).rejects.toMatchObject({ code: "corrupt" });
    expect(await readFile(join(root, broken), "utf8")).toBe("{");
    // Node's sparse file exercises the byte guard without allocating its size.
    await truncate(join(root, broken), FOLDER_LIMITS.revisionBytes + 1);
    if (adapter === "node") await expect(library.list()).rejects.toMatchObject({ code: "resource-limit" });
    await rm(join(root, broken));
    const oversizedParents = encode(canonicalJson({
      format: "pocketry-folder-revision", version: 2, requestId: "bad", fingerprint: key,
      changes: save("bad", 1, Array<string>(FOLDER_LIMITS.parents + 1).fill("a".repeat(64))).changes,
    }));
    const oversizedName = revisionFile(key, await digest(oversizedParents));
    await folder.publish(oversizedName, oversizedParents);
    await expect(library.list()).rejects.toMatchObject({ code: "resource-limit", details: { file: oversizedName } });
    await rm(join(root, oversizedName));
    const bytes = encode(canonicalJson({
      format: "pocketry-folder-revision", version: 2, requestId: "bad", fingerprint: key,
      changes: save("bad", 1, ["a".repeat(64)]).changes,
    }));
    await folder.publish(revisionFile(key, await digest(bytes)), bytes);
    await expect(library.list()).rejects.toMatchObject({ code: "corrupt", details: { parent: "a".repeat(64) } });
  });
});

describe.each(["browser model / browser model", "browser model / Node"])("%s concurrency", pair => {
  const setup = async () => {
    const first = modelBrowserFolder(root).folder;
    const second = pair.endsWith("Node") ? await NodeLibraryFolder.connect(root) : modelBrowserFolder(root).folder;
    return { first, writer: new ConnectedLibrary(first), racing: raceFolders(first, second).map(folder => new ConnectedLibrary(folder)) };
  };

  it("publishes simultaneous same-input retries under one revision name", async () => {
    const { writer, racing: [a, b] } = await setup();
    const result = await Promise.all([a.commit(save("same")), b.commit(save("same"))]);
    expect(result.every(outcome => outcome.status === "published")).toBe(true);
    expect(await writer.inspect("same")).toMatchObject({ status: "published", publications: [{ projectIds: ["socket-bin"] }] });
    expect((await readdir(root)).filter(name => name.startsWith("pocketry-r"))).toHaveLength(1);
  });

  it("reports a reused request across projects without blocking either single-head project", async () => {
    const { writer, racing: [a, b] } = await setup();
    const [first] = save("seed").changes;
    const second = { ...first, projectId: "second-bin", name: "Second bin" };
    const initial = await writer.commit({ requestId: "seed", changes: [first, second] });
    if (!("publications" in initial)) throw new Error("Missing seed publication");
    const parents = [initial.publications[0].revision];
    await Promise.all([
      a.commit({ requestId: "reused", changes: [{ ...first, parents, name: "First update" }] }),
      b.commit({ requestId: "reused", changes: [{ ...second, parents, name: "Second update" }] }),
    ]);
    const receipt = await writer.inspect("reused");
    expect(receipt).toMatchObject({ status: "published-conflict", requestCollision: true,
      publications: expect.arrayContaining([{ revision: expect.any(String), fingerprint: expect.any(String), projectIds: [first.projectId] },
        { revision: expect.any(String), fingerprint: expect.any(String), projectIds: [second.projectId] }]) });
    const projects = await writer.list();
    expect(projects.map(project => [project.conflicted, project.heads.length])).toEqual([[false, 1], [false, 1]]);
    expect((await writer.backup()).projects).toHaveLength(2);
    const existing = await writer.read(first.projectId);
    await expect(writer.commit({ requestId: "next", changes: [{ ...first, parents: [existing.revision] }] }))
      .resolves.toMatchObject({ status: "published" });
    await expect(writer.commit({ requestId: "reused", changes: [first] })).rejects.toMatchObject({ code: "request-reused" });
  });

  it("preserves independent versions and explicitly forks a recovery copy", async () => {
    const { writer, racing: [a, b] } = await setup();
    await writer.commit(save("initial"));
    const base = await head(writer);
    const replies = await Promise.all([
      a.commit(save("left", 3, [base])), b.commit(save("right", 4, [base])),
    ]);
    expect(replies.some(outcome => outcome.status === "published-conflict")).toBe(true);
    const [project] = await writer.list();
    expect(project).toMatchObject({ conflicted: true });
    expect(project.heads).toHaveLength(2);
    await expect(writer.read(project.projectId)).rejects.toMatchObject({ code: "conflict" });
    const expected = project.heads.map(h => h.revision);
    const recovered = await writer.keepBoth("recover", project.projectId, expected, expected[0]);
    expect(recovered.status).toBe("published");
    expect(await writer.keepBoth("recover", project.projectId, expected, expected[0])).toEqual(recovered);
    const reopened = await writer.list();
    expect(reopened).toHaveLength(2);
    expect(reopened.every(entry => !entry.conflicted)).toBe(true);
    const columns = await Promise.all(reopened.map(async entry => (await writer.read(entry.projectId)).doc.spec.compartments.columns));
    expect(columns.sort()).toEqual([3, 4]);
    await expect(writer.commit(save("stale", 5, [base]))).rejects.toMatchObject({ code: "stale-base" });
  });

  it("reports and retains simultaneous reuse with different input", async () => {
    const { writer, racing: [a, b] } = await setup();
    await Promise.all([a.commit(save("reused", 3)), b.commit(save("reused", 4))]);
    const outcome = await writer.inspect("reused");
    expect(outcome).toMatchObject({ status: "published-conflict", requestCollision: true });
    expect("publications" in outcome && outcome.publications).toHaveLength(2);
    await expect(writer.commit(save("reused", 5))).rejects.toMatchObject({ code: "request-reused" });
  });
});

it("preserves interrupted browser files, renews permission, and resumes exactly the same bytes", async () => {
  const model = modelBrowserFolder(root);
  const library = new ConnectedLibrary(model.folder);
  model.interrupt(true);
  expect(await library.commit(save("interrupted"))).toMatchObject({ status: "uncertain" });
  expect(await library.inspect("interrupted")).toMatchObject({ status: "pending" });
  await expect(library.commit(save("interrupted", 6))).rejects.toMatchObject({ code: "request-reused" });
  model.revoke();
  await expect(library.list()).rejects.toMatchObject({ code: "permission" });
  expect(await model.folder.renew()).toBe(true);
  model.interrupt(false);
  expect(await library.commit(save("interrupted"))).toMatchObject({ status: "published" });
});

it("rejects traversal and links, preserving target files", async () => {
  const node = await NodeLibraryFolder.connect(root);
  await expect(node.read("../outside", 100)).rejects.toThrow("basename");
  await expect(node.publish("subdirectory/file", encode("replacement"))).rejects.toThrow("basename");
  const library = new ConnectedLibrary(node);
  const outside = join(root, "source");
  await writeFile(outside, "source");
  const managed = join(root, revisionFile("a".repeat(64), "b".repeat(64)));
  await symlink(outside, managed);
  await expect(library.list()).rejects.toMatchObject({ code: "corrupt" });
  await rm(managed);
  await link(outside, managed);
  await expect(library.list()).rejects.toMatchObject({ code: "corrupt" });
  expect(await readFile(outside, "utf8")).toBe("source");
});

it("bounds enumeration and ancestry before work can grow without limit", async () => {
  const names = new Map<string, Uint8Array>();
  const folder = new ConnectedLibrary({
    async *entries() {
      for (const name of names.keys()) yield { name, kind: "file" };
    },
    async read(name) { return { bytes: names.get(name)!, modifiedAt: 0 }; },
    async publish() { throw new Error("Test never publishes"); },
  });
  for (let n = 0; n <= FOLDER_LIMITS.entries; n++) names.set(`entry-${n}`, new Uint8Array(0));
  await expect(folder.list()).rejects.toMatchObject({ code: "resource-limit" });
  names.clear();

  let parents: string[] = [];
  for (let n = 0; n <= FOLDER_LIMITS.depth; n++) {
    const requestId = `depth-${n}`;
    const key = await digest(encode(requestId));
    const bytes = encode(canonicalJson({
      format: "pocketry-folder-revision", version: 2, requestId, fingerprint: key,
      changes: [{ projectId: "test", parents, name: "Test", doc: {} }],
    }));
    const revision = await digest(bytes);
    names.set(revisionFile(key, revision), bytes);
    parents = [revision];
  }
  await expect(folder.list()).rejects.toMatchObject({ code: "resource-limit" });
  expect(names.size).toBe(FOLDER_LIMITS.depth + 1);
});

it("backs up the current named documents from a single observed set of heads", async () => {
  const adapter = await NodeLibraryFolder.connect(root);
  const library = new ConnectedLibrary(adapter);
  const second = folderFixture("Second tray", 3);
  await library.commit({ requestId: "backup-two", changes: [
    ...save("backup-two").changes,
    { projectId: "second", name: second.name, parents: [], doc: second },
  ] });
  const backup = await library.backup();
  expect(backup).toMatchObject({ format: "pocketry-library", schemaVersion: 1, projects: [
    { id: "second", name: second.name, doc: { name: second.name, spec: { compartments: { columns: 3 } } } },
    { id: "socket-bin", name: "Socket bin" },
  ] });
});
