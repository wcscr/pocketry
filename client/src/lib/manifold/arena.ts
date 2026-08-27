/**
 * Lifetime management for manifold-3d WASM handles.
 *
 * `Manifold` and `CrossSection` objects live in the WASM heap and are NOT
 * garbage collected — every one that JavaScript creates must have `delete()`
 * called on it. Leaking them does not degrade gracefully; the heap grows until
 * the tab crashes. Every function that allocates handles should therefore run
 * inside an arena and register each handle as it is created.
 */

/** Anything holding WASM memory that must be explicitly released. */
export interface Disposable {
  delete(): void;
}

/**
 * Collects WASM handles so they can be released together, in reverse order of
 * creation, even if the allocating code throws part-way through.
 */
export class Arena {
  private readonly tracked: Disposable[] = [];
  private disposed = false;

  /** Registers a handle for disposal and returns it, for inline use. */
  track<T extends Disposable>(handle: T): T {
    if (this.disposed) {
      throw new Error("Arena.track called after dispose()");
    }
    this.tracked.push(handle);
    return handle;
  }

  /** Registers several handles at once. */
  trackAll<T extends Disposable>(handles: readonly T[]): readonly T[] {
    for (const handle of handles) this.track(handle);
    return handles;
  }

  /**
   * Removes a handle from the arena without deleting it, transferring
   * ownership to the caller. Use when a handle outlives the arena that built
   * it — typically the value being returned.
   */
  release<T extends Disposable>(handle: T): T {
    const index = this.tracked.lastIndexOf(handle);
    if (index !== -1) this.tracked.splice(index, 1);
    return handle;
  }

  /** Number of handles currently owned. Exposed for leak assertions in tests. */
  get size(): number {
    return this.tracked.length;
  }

  /**
   * Deletes every tracked handle, newest first. Individual failures are
   * swallowed so one bad handle cannot strand the rest.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = this.tracked.length - 1; i >= 0; i--) {
      try {
        this.tracked[i].delete();
      } catch {
        // A handle may already have been deleted elsewhere; nothing to do.
      }
    }
    this.tracked.length = 0;
  }
}

/**
 * Runs `fn` with a fresh arena and disposes it afterwards, whether `fn`
 * returns or throws.
 *
 * To return a handle out of the arena, call `arena.release(handle)` first —
 * otherwise it is deleted along with the intermediates.
 */
export function withArena<T>(fn: (arena: Arena) => T): T {
  const arena = new Arena();
  try {
    return fn(arena);
  } finally {
    arena.dispose();
  }
}

/** Async counterpart to {@link withArena}. */
export async function withArenaAsync<T>(
  fn: (arena: Arena) => Promise<T>,
): Promise<T> {
  const arena = new Arena();
  try {
    return await fn(arena);
  } finally {
    arena.dispose();
  }
}
