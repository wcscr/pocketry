import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectedLibrary } from "../../shared/project-library/library";
import { folderFixture } from "../project-library/folder.test-support";
import { NodeLibraryFolder } from "../project-library/node-folder";
import { MCP_VERSION } from "./stdio";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const cli = ["--import", "tsx", "server/automation/cli.ts"];
const edits = [{ type: "set_compartments", settings: { columns: 2 } }];

function startWorker(root: string) {
  const child = spawn(process.execPath, [...cli, "--library", root, "mcp"], { cwd: repo, stdio: "pipe" });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  child.stdin.on("error", () => {}); // A worker can die before its next request.
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const output = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let sequence = 0;

  const send = (message: object) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  const request = async (method: string, params: object) => {
    const id = ++sequence;
    send({ id, method, params });
    const reply = await output.next();
    if (reply.done) throw new Error(`Worker closed before replying to ${method}. ${stderr}`);
    const frame = JSON.parse(reply.value);
    expect(frame.id).toBe(id);
    expect(frame.error).toBeUndefined();
    return frame.result;
  };

  return {
    async initialize() {
      const reply = await request("initialize", { protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: { name: "test", version: "1" } });
      expect(reply.protocolVersion).toBe(MCP_VERSION);
      send({ method: "notifications/initialized" });
    },
    async call(name: string, args: object) { return (await request("tools/call", { name, arguments: args })).structuredContent; },
    async stop(crash = false) {
      if (crash) child.kill("SIGKILL");
      else child.stdin.end();
      return exited;
    },
  };
}

describe("automation project locks across worker processes", () => {
  let root: string;
  let folder: NodeLibraryFolder;
  let library: ConnectedLibrary;
  let base: string;
  let workers: ReturnType<typeof startWorker>[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pocketry-edit-locks-"));
    workers = [];
    folder = await NodeLibraryFolder.connect(root);
    library = new ConnectedLibrary(folder);
    const seed = await library.commit({ requestId: "seed", changes: ["tray-a", "tray-b"].map(projectId => ({
      projectId, name: projectId, parents: [], doc: folderFixture(projectId, 1),
    })) });
    if (!("publications" in seed)) throw new Error("Missing fixture publication");
    base = seed.publications[0].revision;
  });

  afterEach(async () => {
    await Promise.all(workers.map(worker => worker.stop(true)));
    await rm(root, { recursive: true, force: true });
  });

  const pair = async () => {
    const owner = startWorker(root);
    const other = startWorker(root);
    workers.push(owner, other);
    await Promise.all([owner.initialize(), other.initialize()]);
    return { owner, other };
  };

  it("excludes competing MCP and CLI edits while permitting reads and edits to another project", async () => {
    const { owner, other } = await pair();
    const edit = { projectId: "tray-a", requestId: "edit-a", expectedBase: base, edits };
    expect(await owner.call("begin_edit", { projectId: "missing" })).toMatchObject({ ok: false, error: { code: "not-found" } });
    const checkedOut = await owner.call("begin_edit", { projectId: "tray-a" });
    expect(checkedOut).toMatchObject({ ok: true, result: { revision: base } });
    const { editToken } = checkedOut.result;
    expect(await owner.call("begin_edit", { projectId: "tray-a" })).toEqual(checkedOut);
    expect(await other.call("begin_edit", { projectId: "tray-a" })).toMatchObject({ ok: false, error: { code: "busy", details: { projectId: "tray-a" } } });
    expect(await other.call("commit_project", edit)).toMatchObject({ ok: false, error: { code: "busy" } });
    expect(await other.call("commit_project", { ...edit, editToken })).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(await other.call("read_project", { projectId: "tray-a" })).toMatchObject({ ok: true, result: { revision: base } });

    const cliAttempt = spawnSync(process.execPath, [...cli, "--library", root, "commit_project"], {
      cwd: repo, input: JSON.stringify(edit), encoding: "utf8", timeout: 10_000,
    });
    expect(cliAttempt.error).toBeUndefined();
    expect(cliAttempt.status).toBe(1);
    expect(JSON.parse(cliAttempt.stdout)).toMatchObject({ ok: false, error: { code: "busy" } });
    expect(await library.inspect(edit.requestId)).toMatchObject({ status: "not-found" });
    expect(await other.call("commit_project", { ...edit, projectId: "tray-b", requestId: "edit-b" }))
      .toMatchObject({ ok: true, result: { outcome: { status: "published" } } });

    const committed = await owner.call("commit_project", { ...edit, editToken });
    expect(committed).toMatchObject({ ok: true, result: { outcome: { status: "published" } } });
    expect(await owner.call("end_edit", { projectId: "tray-a", editToken })).toMatchObject({ ok: true });
    const next = await other.call("begin_edit", { projectId: "tray-a" });
    const saved = await library.read("tray-a");
    expect(next).toMatchObject({ ok: true, result: { revision: saved.revision } });
    expect(saved.doc.spec.compartments.columns).toBe(2);
    expect(await other.call("commit_project", { ...edit, editToken: next.result.editToken }))
      .toMatchObject({ ok: true, result: { outcome: committed.result.outcome } });
    expect(await other.call("commit_project", { ...edit, requestId: "later", editToken: next.result.editToken }))
      .toMatchObject({ ok: false, error: { code: "stale-base" } });
    expect(await other.stop()).toBe(0);
    expect(await owner.call("begin_edit", { projectId: "tray-a" })).toMatchObject({ ok: true });
  }, 20_000);

  it("releases the lock after a killed worker without deleting the lock file or changing the saved project", async () => {
    const { owner, other } = await pair();
    const result = await owner.call("begin_edit", { projectId: "tray-a" });
    expect(result).toMatchObject({ ok: true });
    const path = await folder.projectLockPath("tray-a");
    const file = await stat(path, { bigint: true });
    expect(await other.call("begin_edit", { projectId: "tray-a" })).toMatchObject({ ok: false, error: { code: "busy" } });
    await owner.stop(true);

    const resumed = await other.call("begin_edit", { projectId: "tray-a" });
    expect(resumed).toMatchObject({ ok: true, result: { revision: base } });
    expect(resumed.result.editToken).not.toBe(result.result.editToken);
    expect(await stat(path, { bigint: true })).toMatchObject({ ino: file.ino, dev: file.dev, size: 0n });
    expect(await other.call("commit_project", { projectId: "tray-a", requestId: "after-crash", expectedBase: base,
      editToken: resumed.result.editToken, edits })).toMatchObject({ ok: true, result: { outcome: { status: "published" } } });
  }, 20_000);
});
