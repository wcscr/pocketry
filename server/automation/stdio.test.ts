import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { ConnectedLibrary } from "../../shared/project-library/library";
import { AutomationService } from "./service";
import { MCP_VERSION, readCliInput, serveMcp } from "./stdio";

const service = new AutomationService(new ConnectedLibrary({
  async *entries() {}, async read() { return null; }, async publish() { throw new Error("Unexpected write"); },
}), {
  async write() { throw new Error("Unexpected artifact"); },
  async model() { throw new Error("Unexpected geometry build"); },
});

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
});
