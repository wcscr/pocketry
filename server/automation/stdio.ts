import { once } from "node:events";
import type { Readable, Writable } from "node:stream";
import { z } from "zod";
import { LibraryError } from "../../shared/project-library/format";
import { commandFailure, CommandError, type AutomationService } from "./service";

export const MCP_VERSION = "2025-11-25";
export const MCP_LINE_BYTES = 8 * 1024 * 1024;
export const CLI_INPUT_BYTES = 65 * 1024 * 1024;

export async function readCliInput(stream: Readable) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    length += chunk.length;
    if (length > CLI_INPUT_BYTES) throw new LibraryError("resource-limit", "CLI input is too large.");
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString("utf8").trim();
  try { return input ? JSON.parse(input) as unknown : {}; }
  catch { throw new LibraryError("validation", "Provide one JSON argument object on stdin."); }
}

async function* lines(input: Readable) {
  let chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of input as AsyncIterable<Buffer>) {
    for (let start = 0; start < chunk.length;) {
      const newline = chunk.indexOf(10, start);
      const segment = chunk.subarray(start, newline < 0 ? chunk.length : newline);
      length += segment.length;
      if (length <= MCP_LINE_BYTES) chunks.push(segment);
      else chunks = [];
      if (newline < 0) break;
      yield length > MCP_LINE_BYTES ? null : Buffer.concat(chunks).toString("utf8");
      length = 0;
      chunks = [];
      start = newline + 1;
    }
  }
}

const rpcId = z.union([z.string(), z.number().int()]);
const rpcMessage = z.strictObject({
  jsonrpc: z.literal("2.0"),
  method: z.string().min(1),
  id: rpcId.optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});
const initialize = z.looseObject({
  protocolVersion: z.string(), capabilities: z.record(z.string(), z.unknown()),
  clientInfo: z.looseObject({ name: z.string(), version: z.string() }),
});
const toolCall = z.looseObject({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() });

/** The small stdio-only MCP tools subset. One active command bounds resource
 * use and lets the reader continue accepting cancellation notifications. */
export async function serveMcp(service: AutomationService, input: Readable, output: Writable) {
  let started = false, ready = false;
  const session: { active?: { id: string | number; cancel: AbortController; result: Promise<void> } } = {};
  const reply = (id: string | number | null, body: object) => {
    output.write(JSON.stringify({ jsonrpc: "2.0", id, ...body }) + "\n");
  };
  const error = (id: string | number | null, code: number, message: string) => reply(id, { error: { code, message } });
  const tools = Object.entries(service.commands).map(([name, command]) => ({
    name, description: command.description,
    inputSchema: z.toJSONSchema(command.schema, { io: "input" }),
    annotations: { readOnlyHint: command.readOnly, openWorldHint: false },
  }));

  try {
    for await (const line of lines(input)) {
      if (output.writableNeedDrain) await once(output, "drain");
      if (line === null) { error(null, -32000, "MCP message exceeds the byte limit."); continue; }
      if (!line.trim()) continue;
      let raw: unknown;
      try { raw = JSON.parse(line); }
      catch { error(null, -32700, "Invalid JSON."); continue; }
      const message = rpcMessage.safeParse(raw);
      if (!message.success) { error(null, -32600, "Invalid JSON-RPC message."); continue; }

      const { id, method, params } = message.data;
      const active = session.active;
      if (id === undefined) {
        if (method === "notifications/initialized" && started) ready = true;
        if (method === "notifications/cancelled" && active?.id === params?.requestId) active?.cancel.abort();
        continue;
      }
      if (method === "ping") { reply(id, { result: {} }); continue; }
      if (method === "initialize") {
        if (started || !initialize.safeParse(params).success) { error(id, -32602, "Invalid or repeated initialization."); continue; }
        started = true;
        reply(id, { result: {
          protocolVersion: MCP_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "pocketry", version: "1.0.0" },
        } });
        continue;
      }
      if (method !== "tools/list" && method !== "tools/call") { error(id, -32601, "Method not found."); continue; }
      if (!ready) { error(id, -32002, "Initialize the MCP connection first."); continue; }
      if (method === "tools/list") { reply(id, { result: { tools } }); continue; }
      const call = toolCall.safeParse(params);
      if (!call.success) { error(id, -32602, "Use a tool name and an argument object."); continue; }
      if (active?.id === id) { error(id, -32600, "A request with this ID is already active."); continue; }
      if (active) {
        const failure = commandFailure(new CommandError("busy", "Another command is active. Wait for it before retrying."));
        reply(id, { result: { content: [{ type: "text", text: JSON.stringify(failure) }], structuredContent: failure, isError: true } });
        continue;
      }
      const cancel = new AbortController();
      const result = service.execute(call.data.name, call.data.arguments ?? {}, cancel.signal)
        .then(result => ({ ok: true as const, result })).catch(commandFailure)
        .then(result => {
          if (!cancel.signal.aborted) {
            reply(id, { result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: !result.ok } });
          }
        }).finally(() => { delete session.active; });
      session.active = { id, cancel, result };
    }
  } finally {
    // Keep the worker’s edit lock through an active command when input ends.
    await session.active?.result;
  }
}
