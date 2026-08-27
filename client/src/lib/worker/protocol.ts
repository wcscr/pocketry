/**
 * Wire format shared by the worker host and its clients.
 *
 * Everything here must be structured-cloneable — no class instances, no
 * functions. Large payloads (typed arrays) travel as transferables so they are
 * moved rather than copied.
 */

/** An `Error` flattened for structured clone. */
export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: "Error", message: String(error) };
}

export function deserializeError(error: SerializedError): Error {
  const result = new Error(error.message);
  result.name = error.name;
  if (error.stack) result.stack = error.stack;
  return result;
}

/** Client → worker. */
export type ClientMessage =
  | { id: number; kind: "call"; method: string; payload: unknown }
  | { id: number; kind: "cancel" };

/** Worker → client. */
export type WorkerMessage =
  | { id: number; kind: "result"; payload: unknown }
  | { id: number; kind: "error"; error: SerializedError }
  | { id: number; kind: "progress"; value: number };

/**
 * The message-passing surface a client needs. `Worker` satisfies it
 * structurally, which lets tests drive the client with a fake endpoint instead
 * of spawning a real thread.
 */
export interface MessageEndpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
  terminate?(): void;
}

/** Raised when a call is superseded or its `AbortSignal` fires. */
export class WorkerCancelledError extends Error {
  constructor(message = "Worker call was cancelled") {
    super(message);
    this.name = "WorkerCancelledError";
  }
}
