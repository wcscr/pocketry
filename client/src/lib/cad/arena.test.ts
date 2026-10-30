import { describe, expect, it, vi } from "vitest";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import { CadContext } from "./adapter";

const context = () => new CadContext({} as OpenCascadeInstance);
const handle = () => ({ delete: vi.fn() });

describe("CAD construction scopes", () => {
  it("releases intermediates while keeping each output once", () => {
    const c = context(), temporary = handle(), result = handle();
    c.scope(() => { c.own(temporary); return c.own(result); }, value => [value, value]);
    expect(temporary.delete).toHaveBeenCalledOnce();
    expect(result.delete).not.toHaveBeenCalled();
    c.dispose();
    expect(result.delete).toHaveBeenCalledOnce();
    expect(temporary.delete).toHaveBeenCalledOnce();
  });
  it("keeps borrowed aliases in their original scope", () => {
    const c = context(), borrowed = c.own(handle());
    expect(c.scope(() => borrowed, result => [result])).toBe(borrowed);
    expect(borrowed.delete).not.toHaveBeenCalled();
    c.dispose();
    expect(borrowed.delete).toHaveBeenCalledOnce();
  });
  it("unwinds nested failures and leaves the parent usable", () => {
    const c = context(), outer = c.own(handle()), inner = handle();
    expect(() => c.scope(() => c.scope(() => { c.own(inner); throw new Error("native failure"); }))).toThrow("native failure");
    expect(inner.delete).toHaveBeenCalledOnce();
    expect(outer.delete).not.toHaveBeenCalled();
    const next = c.own(handle());
    c.dispose();
    expect(next.delete).toHaveBeenCalledOnce();
    expect(outer.delete).toHaveBeenCalledOnce();
  });
  it("drops a superseded result without deleting it again during cleanup", () => {
    const c = context(), previous = c.own(handle());
    c.drop(previous);
    c.dispose();
    expect(previous.delete).toHaveBeenCalledOnce();
  });
});
