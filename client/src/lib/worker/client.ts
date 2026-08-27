import {
  deserializeError,
  WorkerCancelledError,
  type ClientMessage,
  type MessageEndpoint,
  type WorkerMessage,
} from "./protocol";

export interface CallOptions {
  /** Aborts the call and tells the worker to stop. */
  signal?: AbortSignal;
  /** Buffers to move rather than copy. */
  transfer?: Transferable[];
  /** Receives 0..1 progress updates, if the method reports any. */
  onProgress?: (value: number) => void;
  /**
   * Supersede key. A new call on a channel cancels the one already in flight
   * on it — the right behaviour for slider-driven recomputation, where only
   * the newest request matters.
   */
  channel?: string;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  onProgress?: (value: number) => void;
  channel?: string;
  detachSignal?: () => void;
}

export interface WorkerClient {
  /** Invokes `method` in the worker and resolves with its return value. */
  call<TResult>(
    method: string,
    payload?: unknown,
    options?: CallOptions,
  ): Promise<TResult>;
  /** Cancels every in-flight call and tears the worker down. */
  dispose(): void;
}

/**
 * Typed request/response over a worker, with supersede and cancellation.
 *
 * The worker is spawned lazily on the first call, so importing a module that
 * builds a client does not by itself cost a thread.
 */
export function createWorkerClient(spawn: () => MessageEndpoint): WorkerClient {
  let endpoint: MessageEndpoint | null = null;
  let nextId = 1;
  let disposed = false;

  const pending = new Map<number, PendingCall>();
  /** channel -> id of the call currently occupying it. */
  const channels = new Map<string, number>();

  const settle = (id: number): PendingCall | undefined => {
    const call = pending.get(id);
    if (!call) return undefined;
    pending.delete(id);
    call.detachSignal?.();
    if (call.channel && channels.get(call.channel) === id) {
      channels.delete(call.channel);
    }
    return call;
  };

  const handleMessage = (event: MessageEvent) => {
    const message = event.data as WorkerMessage;
    if (message.kind === "progress") {
      pending.get(message.id)?.onProgress?.(message.value);
      return;
    }
    const call = settle(message.id);
    if (!call) return; // Already cancelled; the late reply is discarded.
    if (message.kind === "result") call.resolve(message.payload);
    else call.reject(deserializeError(message.error));
  };

  const ensureEndpoint = (): MessageEndpoint => {
    if (!endpoint) {
      endpoint = spawn();
      endpoint.addEventListener("message", handleMessage);
    }
    return endpoint;
  };

  const post = (message: ClientMessage, transfer?: Transferable[]) => {
    ensureEndpoint().postMessage(message, transfer);
  };

  /** Rejects a call locally and asks the worker to abandon its work. */
  const cancel = (id: number, reason: Error) => {
    const call = settle(id);
    if (!call) return;
    call.reject(reason);
    if (endpoint) endpoint.postMessage({ id, kind: "cancel" } satisfies ClientMessage);
  };

  return {
    call<TResult>(
      method: string,
      payload?: unknown,
      options: CallOptions = {},
    ): Promise<TResult> {
      if (disposed) {
        return Promise.reject(new Error("Worker client has been disposed"));
      }
      if (options.signal?.aborted) {
        return Promise.reject(new WorkerCancelledError());
      }

      // Supersede whatever currently owns this channel.
      if (options.channel !== undefined) {
        const previous = channels.get(options.channel);
        if (previous !== undefined) {
          cancel(previous, new WorkerCancelledError("Superseded by a newer call"));
        }
      }

      const id = nextId++;
      return new Promise<TResult>((resolve, reject) => {
        const call: PendingCall = {
          resolve: resolve as (value: unknown) => void,
          reject,
          onProgress: options.onProgress,
          channel: options.channel,
        };

        if (options.signal) {
          const signal = options.signal;
          const onAbort = () => cancel(id, new WorkerCancelledError());
          signal.addEventListener("abort", onAbort, { once: true });
          call.detachSignal = () => signal.removeEventListener("abort", onAbort);
        }

        pending.set(id, call);
        if (options.channel !== undefined) channels.set(options.channel, id);

        post({ id, kind: "call", method, payload }, options.transfer);
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const id of [...pending.keys()]) {
        const call = settle(id);
        call?.reject(new WorkerCancelledError("Worker client disposed"));
      }
      channels.clear();
      if (endpoint) {
        endpoint.removeEventListener("message", handleMessage);
        endpoint.terminate?.();
        endpoint = null;
      }
    },
  };
}
