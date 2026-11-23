import { PassThrough, Readable, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { LibraryFolder } from "../../shared/project-library/adapter";
import { ConnectedLibrary } from "../../shared/project-library/library";
import { folderFixture, raceFolders } from "../project-library/folder.test-support";
import { AutomationService } from "./service";
import { ProjectEditLocks } from "./project-locks";
import { MCP_VERSION, readCliInput, serveMcp } from "./stdio";

const artifacts = {
  async write() { throw new Error("Unexpected artifact"); },
  async model() { throw new Error("Unexpected geometry build"); },
};
const service = new AutomationService(new ConnectedLibrary({
  async *entries() {}, async read() { return null; }, async publish() { throw new Error("Unexpected write"); },
}), artifacts, new ProjectEditLocks(async () => () => {}));

describe("stdio automation", () => {
  it("negotiates MCP, publishes schemas, and runs a tool with protocol-only output", async () => {
    const request = (id: number, method: string, params?: object) => ({ jsonrpc: "2.0", id, method, params });
    const frames = [
      request(1, "server/discover"),
      request(2, "initialize", { protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: { name: "test", version: "1.0" } }),
      { jsonrpc: "2.0", method: "notifications/initialized" },
      request(3, "tools/list"),
      request(4, "tools/call", { name: "capabilities" }),
    ];
    const received: unknown[] = [];
    const output = new Writable({ write(chunk, _encoding, callback) { received.push(JSON.parse(chunk.toString())); callback(); } });
    await serveMcp(service, Readable.from(frames.map(frame => Buffer.from(JSON.stringify(frame) + "\n"))), output);
    expect(received).toEqual([
      expect.objectContaining({ id: 1, error: { code: -32601, message: "Method not found." } }),
      expect.objectContaining({ id: 2, result: expect.objectContaining({ protocolVersion: MCP_VERSION }) }),
      expect.objectContaining({ id: 3, result: { tools: expect.arrayContaining([
        expect.objectContaining({ name: "commit_project", inputSchema: expect.objectContaining({ type: "object", required: expect.arrayContaining(["expectedBase", "edits"]) }) }),
      ]) } }),
      expect.objectContaining({ id: 4, result: expect.objectContaining({
        isError: false, structuredContent: expect.objectContaining({ ok: true, result: expect.objectContaining({ apiVersion: 1 }) }),
      }) }),
    ]);
  });

  it("reads a single CLI JSON object and rejects malformed input", async () => {
    expect(await readCliInput(Readable.from([Buffer.from('{"limit":2}')]))).toEqual({ limit: 2 });
    await expect(readCliInput(Readable.from([Buffer.from("{")]))).rejects.toMatchObject({ code: "validation" });
  });

  it("honors cancellation during conflict recovery preflight without publishing a revision", async () => {
    const files = new Map<string, Uint8Array>();
    const folder: LibraryFolder = {
      async *entries() { for (const name of files.keys()) yield { name, kind: "file" }; },
      async read(name) { return files.has(name) ? { bytes: files.get(name)!, modifiedAt: 0 } : null; },
      async publish(name, bytes) { files.set(name, bytes); },
    };
    const library = new ConnectedLibrary(folder);
    const change = (parents: string[], columns: number) => ({ projectId: "tray", parents, name: "Tray", doc: folderFixture("Tray", columns) });
    const seed = await library.commit({ requestId: "create", changes: [change([], 1)] });
    if (!("publications" in seed)) throw new Error("Missing seed publication");
    const base = seed.publications[0].revision;
    await Promise.all(raceFolders(folder, folder).map((writer, index) => new ConnectedLibrary(writer)
      .commit({ requestId: `writer-${index}`, changes: [change([base], index + 2)] })));
    const original = await library.list();
    const expectedHeads = original[0].heads.map(head => head.revision);
    expect(expectedHeads).toHaveLength(2);

    const scanning = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    let scans = 0;
    const pausingFolder: LibraryFolder = {
      ...folder,
      async *entries() {
        if (++scans === 2) {
          scanning.resolve();
          await resume.promise;
        }
        yield* folder.entries();
      },
    };
    const running = new AutomationService(new ConnectedLibrary(pausingFolder), artifacts, new ProjectEditLocks(async () => () => {}));
    const execute = running.execute.bind(running);
    vi.spyOn(running, "execute").mockImplementation((name, args, signal) => {
      signal?.addEventListener("abort", () => cancelled.resolve(), { once: true });
      return execute(name, args, signal);
    });
    const input = new PassThrough();
    const received: { id: number }[] = [];
    const output = new Writable({ write(chunk, _encoding, done) { received.push(JSON.parse(chunk.toString())); done(); } });
    const server = serveMcp(running, input, output);
    const send = (message: object) => input.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");

    try {
      send({ id: 1, method: "initialize", params: { protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: { name: "test", version: "1" } } });
      send({ method: "notifications/initialized" });
      send({ id: 2, method: "tools/call", params: { name: "keep_both", arguments: {
        requestId: "cancelled-recovery", projectId: "tray", expectedHeads, keep: expectedHeads[0],
      } } });
      await scanning.promise;
      send({ method: "notifications/cancelled", params: { requestId: 2 } });
      await cancelled.promise;
    } finally {
      resume.resolve();
      input.end();
      await server;
    }
    expect(received.map(reply => reply.id)).toEqual([1]);
    expect(await library.inspect("cancelled-recovery")).toMatchObject({ status: "not-found" });
    expect(await library.list()).toEqual(original);
    expect(files.size).toBe(3);
  });
});
