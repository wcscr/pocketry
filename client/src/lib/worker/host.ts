import {
  serializeError,
  WorkerCancelledError,
  type ClientMessage,
  type MessageEndpoint,
  type WorkerMessage,
} from "./protocol";

/** Per-call context handed to a handler. */
export interface HandlerContext {
  /** Aborts when the client cancels or supersedes this call. */
  signal: AbortSignal;
  /** Reports 0..1 progress back to the client. */
  progress: (value: number) => void;
}

/** A method the worker exposes. */
export type Handler = (
  payload: never,
  context: HandlerContext,
) => unknown | Promise<unknown>;

export type HandlerMap = Record<string, Handler>;

/**
 * Result wrapper letting a handler nominate buffers to move rather than copy.
 * Returning a bare value is equivalent to `{ value, transfer: [] }`.
 */
export interface TransferableResult<T> {
  value: T;
  transfer: Transferable[];
}

function isTransferable(value: unknown): value is TransferableResult<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "transfer" in value &&
    Array.isArray((value as TransferableResult<unknown>).transfer)
  );
}

/**
 * Serves `handlers` over an endpoint (`self` inside a real worker).
 *
 * Cancellation is cooperative: cancelling aborts the call's signal, and it is
 * the handler's job to check it. A handler that ignores its signal still runs
 * to completion, but its result is discarded rather than delivered.
 */
export function serveWorker(
  handlers: HandlerMap,
  endpoint: MessageEndpoint = self as unknown as MessageEndpoint,
): () => void {
  const inFlight = new Map<number, AbortController>();

  const reply = (message: WorkerMessage, transfer?: Transferable[]) => {
    endpoint.postMessage(message, transfer);
  };

  const onMessage = (event: MessageEvent) => {
    const message = event.data as ClientMessage;

    if (message.kind === "cancel") {
      inFlight.get(message.id)?.abort(new WorkerCancelledError());
      inFlight.delete(message.id);
      return;
    }

    const handler = handlers[message.method];
    if (!handler) {
      reply({
        id: message.id,
        kind: "error",
        error: serializeError(new Error(`Unknown worker method: ${message.method}`)),
      });
      return;
    }

    const controller = new AbortController();
    inFlight.set(message.id, controller);

    const context: HandlerContext = {
      signal: controller.signal,
      progress: (value) => {
        if (!controller.signal.aborted) {
          reply({ id: message.id, kind: "progress", value });
        }
      },
    };

    void (async () => {
      try {
        const raw = await (handler as (p: unknown, c: HandlerContext) => unknown)(
          message.payload,
          context,
        );
        // A cancelled call gets no reply — the client has already rejected it.
        if (controller.signal.aborted) return;
        if (isTransferable(raw)) {
          reply({ id: message.id, kind: "result", payload: raw.value }, raw.transfer);
        } else {
          reply({ id: message.id, kind: "result", payload: raw });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        reply({ id: message.id, kind: "error", error: serializeError(error) });
      } finally {
        inFlight.delete(message.id);
      }
    })();
  };

  endpoint.addEventListener("message", onMessage);
  return () => endpoint.removeEventListener("message", onMessage);
}
