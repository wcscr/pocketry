import { describe, expect, it, vi } from "vitest";

import { createWorkerClient } from "./client";
import { serveWorker, type HandlerContext } from "./host";
import { WorkerCancelledError, type MessageEndpoint } from "./protocol";

/**
 * A pair of endpoints that deliver to each other asynchronously, standing in
 * for a real `Worker` so the RPC can be exercised without a thread.
 */
function createChannel(): { client: MessageEndpoint; worker: MessageEndpoint } {
  const listeners = { client: new Set<Function>(), worker: new Set<Function>() };

  const make = (self: "client" | "worker", peer: "client" | "worker") => ({
    postMessage(message: unknown) {
      // Structured clone mirrors the real boundary and catches accidental
      // attempts to send functions or class instances across it.
      const data = structuredClone(message);
      queueMicrotask(() => {
        for (const listener of [...listeners[peer]]) {
          listener({ data } as MessageEvent);
        }
      });
    },
    addEventListener(_type: "message", listener: (event: MessageEvent) => void) {
      listeners[self].add(listener);
    },
    removeEventListener(_type: "message", listener: (event: MessageEvent) => void) {
      listeners[self].delete(listener);
    },
  });

  return { client: make("client", "worker"), worker: make("worker", "client") };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("worker RPC", () => {
  it("round-trips a call", async () => {
    const channel = createChannel();
    serveWorker({ double: (n: never) => (n as unknown as number) * 2 }, channel.worker);
    const client = createWorkerClient(() => channel.client);

    await expect(client.call<number>("double", 21)).resolves.toBe(42);
    client.dispose();
  });

  it("propagates handler errors", async () => {
    const channel = createChannel();
    serveWorker(
      {
        explode: () => {
          throw new Error("kaboom");
        },
      },
      channel.worker,
    );
    const client = createWorkerClient(() => channel.client);

    await expect(client.call("explode")).rejects.toThrow("kaboom");
    client.dispose();
  });

  it("rejects for an unknown method", async () => {
    const channel = createChannel();
    serveWorker({}, channel.worker);
    const client = createWorkerClient(() => channel.client);

    await expect(client.call("nope")).rejects.toThrow(/Unknown worker method: nope/);
    client.dispose();
  });

  it("delivers progress updates", async () => {
    const channel = createChannel();
    serveWorker(
      {
        work: async (_payload: never, ctx: HandlerContext) => {
          ctx.progress(0.5);
          ctx.progress(1);
          return "done";
        },
      },
      channel.worker,
    );
    const client = createWorkerClient(() => channel.client);
    const onProgress = vi.fn();

    await expect(client.call("work", null, { onProgress })).resolves.toBe("done");
    expect(onProgress.mock.calls.map(([v]) => v)).toEqual([0.5, 1]);
    client.dispose();
  });

  it("supersedes an in-flight call on the same channel", async () => {
    const channel = createChannel();
    let aborted = false;
    serveWorker(
      {
        slow: async (payload: never, ctx: HandlerContext) => {
          await flush();
          await flush();
          if (ctx.signal.aborted) aborted = true;
          return payload as unknown as string;
        },
      },
      channel.worker,
    );
    const client = createWorkerClient(() => channel.client);

    const first = client.call<string>("slow", "old", { channel: "detect" });
    const firstResult = expect(first).rejects.toBeInstanceOf(WorkerCancelledError);
    const second = client.call<string>("slow", "new", { channel: "detect" });

    await firstResult;
    await expect(second).resolves.toBe("new");
    expect(aborted).toBe(true);
    client.dispose();
  });

  it("leaves calls on other channels alone", async () => {
    const channel = createChannel();
    serveWorker({ echo: (p: never) => p }, channel.worker);
    const client = createWorkerClient(() => channel.client);

    const a = client.call<string>("echo", "a", { channel: "one" });
    const b = client.call<string>("echo", "b", { channel: "two" });

    await expect(Promise.all([a, b])).resolves.toEqual(["a", "b"]);
    client.dispose();
  });

  it("cancels via an AbortSignal", async () => {
    const channel = createChannel();
    serveWorker(
      {
        slow: async () => {
          await flush();
          await flush();
          return "finished";
        },
      },
      channel.worker,
    );
    const client = createWorkerClient(() => channel.client);
    const controller = new AbortController();

    const call = client.call("slow", null, { signal: controller.signal });
    controller.abort();

    await expect(call).rejects.toBeInstanceOf(WorkerCancelledError);
    client.dispose();
  });

  it("rejects immediately for an already-aborted signal", async () => {
    const channel = createChannel();
    serveWorker({ echo: (p: never) => p }, channel.worker);
    const client = createWorkerClient(() => channel.client);

    await expect(
      client.call("echo", "x", { signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(WorkerCancelledError);
    client.dispose();
  });

  it("rejects outstanding calls on dispose", async () => {
    const channel = createChannel();
    serveWorker(
      {
        slow: async () => {
          await flush();
          return "late";
        },
      },
      channel.worker,
    );
    const client = createWorkerClient(() => channel.client);

    const call = client.call("slow");
    client.dispose();

    await expect(call).rejects.toBeInstanceOf(WorkerCancelledError);
    await expect(client.call("slow")).rejects.toThrow(/disposed/);
  });

  it("spawns the worker lazily, once", () => {
    const channel = createChannel();
    serveWorker({ echo: (p: never) => p }, channel.worker);
    const spawn = vi.fn(() => channel.client);
    const client = createWorkerClient(spawn);

    expect(spawn).not.toHaveBeenCalled();
    const calls = [client.call("echo", 1), client.call("echo", 2)];
    expect(spawn).toHaveBeenCalledTimes(1);
    client.dispose();
    // dispose() rejects both; swallow so they are not unhandled.
    return Promise.allSettled(calls);
  });
});
