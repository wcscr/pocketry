import { IMPORT_LIMIT_ERROR, LIBRARY_FILE_MAX_BYTES, PROJECT_FILE_MAX_BYTES, withinImportLimits } from "@shared/gridfinity/import-limits";
import { libraryBackupSchema } from "@shared/gridfinity/library";
import { parseProjectDoc, type ProjectDoc } from "@shared/gridfinity/project";

export type OpenLinkSource =
  | { kind: "project"; doc: ProjectDoc }
  | { kind: "library"; projects: { id: string; name: string; updatedAt: string; doc: ProjectDoc }[] };

const FETCH_ERROR = "Could not load the linked file. It may be unavailable, or its host may block browser access (CORS). Your current design is still open.";

function driveFileRequest(shareUrl: URL): { url: URL; options: RequestInit } {
  const fileId = /^\/file\/d\/([\w-]+)(?:\/view)?\/?$/.exec(shareUrl.pathname)?.[1];
  if (!fileId) {
    throw new Error("Use a Google Drive share link to a single Pocketry JSON file. Your current design is still open.");
  }
  const apiKey = import.meta.env.VITE_GOOGLE_DRIVE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Google Drive links are unavailable on this site. Use a direct HTTPS JSON URL. Your current design is still open.");
  }
  const resourceKey = shareUrl.searchParams.get("resourcekey");
  if (resourceKey !== null && !/^[\w-]+$/.test(resourceKey)) {
    throw new Error("The Google Drive link has an invalid resource key. Copy the file’s share link again.");
  }
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`);
  const headers: Record<string, string> = { "X-Goog-Api-Key": apiKey };
  if (resourceKey) headers["X-Goog-Drive-Resource-Keys"] = `${fileId}/${resourceKey}`;
  // Google checks the website restriction against the referrer. Send only the
  // origin so the Pocketry link and its query parameters stay out of that header.
  return { url, options: { headers, referrerPolicy: "origin", redirect: "error" } };
}

/** Read a cross-origin response with the same byte ceilings as file imports. */
async function readJsonResponse(response: Response, signal?: AbortSignal): Promise<{ value: unknown; bytes: number }> {
  const reportedLength = Number(response.headers.get("content-length"));
  if (reportedLength > LIBRARY_FILE_MAX_BYTES) throw new Error(IMPORT_LIMIT_ERROR);
  let bytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        signal?.throwIfAborted();
        const result = await reader.read();
        if (result.done) break;
        bytes += result.value.byteLength;
        if (bytes > LIBRARY_FILE_MAX_BYTES) throw new Error(IMPORT_LIMIT_ERROR);
        chunks.push(decoder.decode(result.value, { stream: true }));
      }
      chunks.push(decoder.decode());
    } catch (cause) {
      await reader.cancel().catch(() => undefined);
      throw cause;
    } finally {
      reader.releaseLock();
    }
  } else {
    // A response without a stream is unusual in browsers, but can occur with
    // service workers. Still check its size before decoding or parsing JSON.
    const buffer = await response.arrayBuffer();
    bytes = buffer.byteLength;
    if (bytes > LIBRARY_FILE_MAX_BYTES) throw new Error(IMPORT_LIMIT_ERROR);
    chunks.push(decoder.decode(buffer));
  }
  signal?.throwIfAborted();
  try {
    return { value: JSON.parse(chunks.join("")) as unknown, bytes };
  } catch {
    throw new Error("The linked file is not valid JSON. Your current design is still open.");
  }
}

/** Fetch an exported project or library without changing local browser storage. */
export async function loadOpenLinkSource(sourceUrl: string, signal?: AbortSignal): Promise<OpenLinkSource> {
  let url: URL;
  try { url = new URL(sourceUrl); }
  catch { throw new Error("The source must be a direct HTTPS URL to a Pocketry JSON file."); }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("The source must be a direct HTTPS URL to a Pocketry JSON file.");
  }
  const drive = url.origin === "https://drive.google.com" ? driveFileRequest(url) : null;
  let response: Response;
  try {
    response = await fetch((drive?.url ?? url).href, {
      mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", signal, ...drive?.options,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error(FETCH_ERROR, { cause });
  }
  if (!response.ok) {
    if (drive && [401, 403, 404].includes(response.status)) {
      throw new Error(`Google Drive could not download this file (HTTP ${response.status}). Check that anyone with the link can view and download it, then use the full share link. Your current design is still open.`);
    }
    throw new Error(response.status === 404
      ? "The linked file was not found (HTTP 404). Your current design is still open."
      : `The linked file could not be downloaded (HTTP ${response.status}). Your current design is still open.`);
  }
  if (response.url && !response.url.startsWith("https://")) {
    throw new Error("The linked file redirected away from HTTPS. Your current design is still open.");
  }
  let parsed: { value: unknown; bytes: number };
  try { parsed = await readJsonResponse(response, signal); }
  catch (cause) {
    if (signal?.aborted) throw cause;
    if (cause instanceof Error && (cause.message === IMPORT_LIMIT_ERROR || cause.message.includes("not valid JSON"))) throw cause;
    throw new Error(FETCH_ERROR, { cause });
  }
  const { value, bytes } = parsed;
  if (value && typeof value === "object" && "format" in value && value.format === "pocketry-library") {
    if (!withinImportLimits(value, true)) throw new Error(IMPORT_LIMIT_ERROR);
    const backup = libraryBackupSchema.safeParse(value);
    if (!backup.success) throw new Error("Not a supported Pocketry library JSON file. Your current design is still open.");
    const projects = backup.data.projects.map(project => {
      const doc = parseProjectDoc(project.doc);
      if (!doc) throw new Error(`“${project.name}” is invalid or uses a newer Pocketry version. Your current design is still open.`);
      return { id: project.id, name: project.name, updatedAt: project.updatedAt, doc: { ...doc, name: project.name } };
    });
    return { kind: "library", projects };
  }
  if (bytes > PROJECT_FILE_MAX_BYTES || !withinImportLimits(value)) throw new Error(IMPORT_LIMIT_ERROR);
  const doc = parseProjectDoc(value);
  if (!doc) throw new Error("Not a supported Pocketry project or library JSON file. It may need a newer Pocketry version. Your current design is still open.");
  return { kind: "project", doc };
}
