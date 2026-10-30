export interface NativeHandle { delete(): void }

/** Embind handles need explicit ownership, including returned value wrappers. */
export class CadArena {
  private handles: NativeHandle[] = [];
  own<T extends NativeHandle>(handle: T): T { this.handles.push(handle); return handle; }
  has(handle: NativeHandle): boolean { return this.handles.includes(handle); }
  release<T extends NativeHandle>(handle: T): T {
    const index = this.handles.lastIndexOf(handle);
    if (index < 0) throw new Error("CAD handle is not owned by this arena");
    this.handles.splice(index, 1);
    return handle;
  }
  dispose(): void {
    let firstError: unknown;
    for (const handle of this.handles.reverse()) {
      try { handle.delete(); } catch (error) { firstError ??= error; }
    }
    this.handles = [];
    if (firstError) throw firstError;
  }
}
