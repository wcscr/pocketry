import { describe, expect, it } from "vitest";

/**
 * Guards `jsdomExecArgv` in vitest.config.ts. On Node 25 and newer, Node's own
 * Web Storage globals hide jsdom's unless the jsdom workers start with
 * `--no-experimental-webstorage`. Without the flag, this test fails once
 * instead of every storage-backed component and workflow test failing with
 * "Cannot read properties of undefined (reading 'setItem')".
 */
describe("jsdom test environment", () => {
  it("provides jsdom's localStorage and sessionStorage instead of Node's", () => {
    // `Storage` is jsdom's class here, so Node's storage objects would fail.
    expect(globalThis.localStorage).toBeInstanceOf(Storage);
    expect(globalThis.sessionStorage).toBeInstanceOf(Storage);
    expect(window.localStorage).toBe(globalThis.localStorage);
  });

  it("stores and removes values", () => {
    localStorage.setItem("pocketry-env-check", "1");
    expect(localStorage.getItem("pocketry-env-check")).toBe("1");
    localStorage.removeItem("pocketry-env-check");
    expect(localStorage.getItem("pocketry-env-check")).toBeNull();
  });
});
