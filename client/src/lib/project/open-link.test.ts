import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBinSpec } from "@shared/gridfinity/types";
import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from "@shared/gridfinity/project";
import { IMPORT_LIMIT_ERROR, LIBRARY_FILE_MAX_BYTES } from "@shared/gridfinity/import-limits";
import { loadOpenLinkSource } from "./open-link";

const doc: ProjectDoc = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  name: "Shared tray",
  shapes: [],
  spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }),
  cutouts: [],
  fingerHoles: [],
};
const source = "https://example.com/tray.pocketry.json";
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Open in Pocketry URL loading", () => {
  it("loads a standalone exported project as an editable document", async () => {
    const fetcher = vi.fn(async () => reply(doc));
    vi.stubGlobal("fetch", fetcher);
    expect(await loadOpenLinkSource(source)).toEqual({ kind: "project", doc });
    expect(fetcher).toHaveBeenCalledWith(source, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", signal: undefined });
  });

  it("validates every library project and preserves exported IDs for selection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ format: "pocketry-library", schemaVersion: 1, projects: [
      { id: "one", name: "First tray", updatedAt: "2026-11-25T00:00:00Z", doc },
      { id: "two", name: "Second tray", updatedAt: "2026-11-25T00:00:00Z", doc: { ...doc, schemaVersion: PROJECT_SCHEMA_VERSION - 1, name: "old name" } },
    ] })));
    const result = await loadOpenLinkSource(source);
    expect(result.kind).toBe("library");
    if (result.kind !== "library") return;
    expect(result.projects.map(project => [project.id, project.name, project.doc.name])).toEqual([
      ["one", "First tray", "First tray"], ["two", "Second tray", "Second tray"],
    ]);
    expect(result.projects[1].doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it("rejects non-HTTPS URLs and never makes a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(loadOpenLinkSource("http://example.com/design.json")).rejects.toThrow("direct HTTPS URL");
    await expect(loadOpenLinkSource("https://user:password@example.com/design.json")).rejects.toThrow("direct HTTPS URL");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends the Drive credentials only to the official download endpoint", async () => {
    vi.stubEnv("VITE_GOOGLE_DRIVE_API_KEY", "test-key");
    const fetcher = vi.fn(async () => reply(doc));
    vi.stubGlobal("fetch", fetcher);
    const driveSource = "https://drive.google.com/file/d/public-id/view?resourcekey=0-file-key&usp=sharing";
    expect(await loadOpenLinkSource(driveSource)).toEqual({ kind: "project", doc });
    expect(fetcher).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files/public-id?alt=media&supportsAllDrives=true",
      {
        mode: "cors", credentials: "omit", referrerPolicy: "origin", redirect: "error", signal: undefined,
        headers: { "X-Goog-Api-Key": "test-key", "X-Goog-Drive-Resource-Keys": "public-id/0-file-key" },
      },
    );
  });

  it("rejects Drive folders, malformed resource keys and unconfigured builds before fetching", async () => {
    vi.stubEnv("VITE_GOOGLE_DRIVE_API_KEY", "test-key");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(loadOpenLinkSource("https://drive.google.com/drive/folders/id")).rejects.toThrow("single Pocketry JSON file");
    await expect(loadOpenLinkSource("https://drive.google.com/file/d/id/view?resourcekey=x%2Cy")).rejects.toThrow("invalid resource key");
    vi.stubEnv("VITE_GOOGLE_DRIVE_API_KEY", undefined);
    await expect(loadOpenLinkSource("https://drive.google.com/file/d/id/view")).rejects.toThrow("unavailable on this site");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports unavailable links, network/CORS failures, and invalid JSON distinctly", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(reply({}, 404))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("<html>Not JSON</html>"));
    vi.stubGlobal("fetch", fetcher);
    await expect(loadOpenLinkSource(source)).rejects.toThrow("HTTP 404");
    await expect(loadOpenLinkSource(source)).rejects.toThrow("CORS");
    await expect(loadOpenLinkSource(source)).rejects.toThrow("not valid JSON");
  });

  it("rejects invalid files and library projects before they can reach the editor", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(reply({ unrelated: true }))
      .mockResolvedValueOnce(reply({ format: "pocketry-library", schemaVersion: 1, projects: [
        { id: "bad", name: "Broken", updatedAt: "2026-11-25T00:00:00Z", doc: { schemaVersion: 999 } },
      ] })));
    await expect(loadOpenLinkSource(source)).rejects.toThrow("Not a supported Pocketry project or library");
    await expect(loadOpenLinkSource(source)).rejects.toThrow("Broken");
  });

  it("honors import size limits before decoding and schema migration", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", {
      headers: { "content-length": String(LIBRARY_FILE_MAX_BYTES + 1) },
    })));
    await expect(loadOpenLinkSource(source)).rejects.toThrow(IMPORT_LIMIT_ERROR);
  });

  it("lets an aborted request stop without applying a stale result", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const pending = loadOpenLinkSource(source, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
