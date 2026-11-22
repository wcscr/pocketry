import { z } from "zod";
import { INITIAL_BIN_SPEC, applyProjectEditBatch } from "../../client/src/state/bin-store";
import { binDimensionsMm } from "../../client/src/lib/gridfinity/bin";
import { MODEL_FORMATS, type ModelFormat } from "../../client/src/lib/project/model-export";
import { PROJECT_SCHEMA_VERSION, serializeProjectDoc, type ProjectDoc } from "../../shared/gridfinity/project";
import { MAX_PROJECT_EDITS, projectEditSchema, type ProjectEdit } from "../../shared/gridfinity/project-edits";
import { projectLayoutIssues } from "../../shared/gridfinity/project-validation";
import { binSpecSchema, parseBinSpec } from "../../shared/gridfinity/types";
import {
  assignedProjectId, digest, encode, FOLDER_FORMAT_VERSION, FOLDER_LIMITS, inputFingerprint, LibraryError,
  projectIdSchema, projectNameSchema, readFolderProject, requestIdSchema, revisionIdSchema,
} from "../../shared/project-library/format";
import { ConnectedLibrary, type RequestOutcome } from "../../shared/project-library/library";

export const AUTOMATION_VERSION = 1;
export const MAX_DETAIL_BYTES = 4 * 1024 * 1024;
export const ARTIFACT_MAX_BYTES = 192 * 1024 * 1024;
export const EXPORT_TIMEOUT_MS = 120_000;
const MAX_LAYOUT_OBJECTS = 256;

type ArtifactExtension = "3mf" | "stl" | "pocketry.json";
export interface AutomationArtifacts {
  write(extension: ArtifactExtension, bytes: Uint8Array): Promise<string>;
  model(project: ProjectDoc, format: ModelFormat, signal: AbortSignal): Promise<Uint8Array>;
}

export class CommandError extends Error {
  constructor(readonly code: "invalid-command" | "cancelled" | "busy" | "export-failed", message: string) {
    super(message);
    this.name = "CommandError";
  }
}

export interface CommandFailure {
  ok: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export function commandFailure(cause: unknown): CommandFailure {
  if (cause instanceof z.ZodError) {
    return { ok: false, error: { code: "validation", message: "Invalid project settings.", details: { issues: cause.issues.slice(0, 25) } } };
  }
  if (cause instanceof LibraryError || cause instanceof CommandError) {
    return { ok: false, error: {
      code: cause.code, message: cause.message, ...(cause instanceof LibraryError && cause.details ? { details: cause.details } : {}),
    } };
  }
  return { ok: false, error: { code: "storage", message: "The local command failed. Inspect the request ID before resuming a mutation." } };
}

const checkCancellation = (signal: AbortSignal) => {
  if (signal.aborted) throw new CommandError("cancelled", "The command stopped before its next operation.");
};

const projectRef = z.strictObject({ projectId: projectIdSchema, revision: revisionIdSchema });
const targetRef = projectRef.extend({ revision: revisionIdSchema.optional() });
const editList = z.array(projectEditSchema).min(1).max(MAX_PROJECT_EDITS);
const exportFormat = z.enum([...MODEL_FORMATS, "backup"]);

function checkLayoutSize(project: ProjectDoc) {
  if (project.cutouts.length + project.fingerHoles.length + project.spec.surfaceTexts.length > MAX_LAYOUT_OBJECTS) {
    throw new LibraryError("resource-limit", `Automation supports up to ${MAX_LAYOUT_OBJECTS} placed objects for layout checks and model exports.`);
  }
}

function validationFor(project: ProjectDoc) {
  checkLayoutSize(project);
  const issues = projectLayoutIssues(project);
  return {
    ok: !issues.some(issue => issue.severity === "error"),
    issueCount: issues.length,
    issues: issues.slice(0, 50),
  };
}

function summarize(doc: ProjectDoc) {
  return {
    name: doc.name ?? null,
    schemaVersion: doc.schemaVersion,
    dimensionsMm: binDimensionsMm(doc.spec),
    fill: doc.spec.fill,
    compartments: doc.spec.compartments,
    shapes: doc.shapes.length,
    pockets: doc.cutouts.length,
    fingerAccess: doc.fingerHoles.length,
    labels: doc.spec.surfaceTexts.length,
    historySteps: doc.history?.stack.length ?? 0,
  };
}

function tool<S extends z.ZodType, Output>(
  schema: S, description: string, readOnly: boolean,
  run: (input: z.output<S>, signal: AbortSignal) => Output | Promise<Output>,
) {
  return {
    description,
    readOnly,
    schema,
    async execute(input: unknown, signal: AbortSignal) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) throw new LibraryError("validation", "Invalid command arguments.", {
        issues: parsed.error.issues.slice(0, 25).map(issue => ({ path: issue.path, message: issue.message })),
      });
      checkCancellation(signal);
      return await run(parsed.data, signal);
    },
  };
}

/** Both transports call these same typed definitions and validated operations. */
export class AutomationService {
  constructor(private readonly library: ConnectedLibrary, private readonly artifacts: AutomationArtifacts) {}

  readonly commands = {
    capabilities: tool(z.strictObject({}), "Discover local Pocketry commands and versions.", true, () => ({
      apiVersion: AUTOMATION_VERSION,
      folderFormat: FOLDER_FORMAT_VERSION,
      projectSchemaVersion: PROJECT_SCHEMA_VERSION,
      reads: "completed named folder revisions",
      edits: projectEditSchema.options.map(option => option.shape.type.value),
      exportFormats: exportFormat.options,
      limits: { ...FOLDER_LIMITS, edits: MAX_PROJECT_EDITS, page: 100, detailBytes: MAX_DETAIL_BYTES, exportTimeoutMs: EXPORT_TIMEOUT_MS, layoutObjects: MAX_LAYOUT_OBJECTS },
    })),
    list_projects: tool(z.strictObject({
      after: projectIdSchema.optional(),
      limit: z.number().int().min(1).max(100).default(25),
    }), "List projects in project-ID order. Use nextAfter as the next page’s after token.", true, async ({ after, limit }) => {
      const projects = (await this.library.list()).filter(project => after === undefined || project.projectId > after);
      const page = projects.slice(0, limit);
      return { projects: page, nextAfter: projects.length > limit ? page.at(-1)!.projectId : null };
    }),
    read_project: tool(targetRef.extend({
      detail: z.enum(["summary", "geometry", "history"]).default("summary"),
    }), "Read a completed revision. Request geometry or undo history explicitly.", true, async ({ projectId, revision, detail }) => {
      const saved = await this.library.read(projectId, revision);
      const summary = summarize(saved.doc);
      const data = detail === "summary" ? undefined : detail === "history" ? saved.doc.history ?? null : {
        spec: saved.doc.spec, shapes: saved.doc.shapes, cutouts: saved.doc.cutouts,
        fingerHoles: saved.doc.fingerHoles, materials: saved.doc.materials,
      };
      if (data && encode(JSON.stringify(data)).byteLength > MAX_DETAIL_BYTES) {
        throw new LibraryError("resource-limit", "The requested detail is too large. Export a project backup for this revision.", { projectId, revision: saved.revision });
      }
      return { projectId, revision: saved.revision, summary, ...(detail === "summary" ? {} : { [detail]: data }) };
    }),
    validate_project: tool(targetRef, "Run document and layout checks for a saved revision. Exact solid validation happens during export.", true,
      async ({ projectId, revision }) => {
        const saved = await this.library.read(projectId, revision);
        return { projectId, revision: saved.revision, validation: validationFor(saved.doc) };
      }),
    apply_edits: tool(projectRef.extend({ edits: editList }), "Preview a bounded semantic edit batch. Nothing is written. Pass the same base and edits to commit_project or copy_project.", true,
      async ({ projectId, revision, edits }) => {
        const saved = await this.library.read(projectId, revision);
        const result = await this.edit(saved.doc, edits);
        return { projectId, baseRevision: revision, summary: summarize(result.project), validation: result.validation };
      }),
    create_project: tool(z.strictObject({
      name: projectNameSchema, requestId: requestIdSchema,
      // The expected absence of the generated ID is the creation base.
      expectedBase: z.null(),
      gridX: binSpecSchema.in.shape.gridX.optional(),
      gridY: binSpecSchema.in.shape.gridY.optional(),
      heightUnits: binSpecSchema.in.shape.heightUnits.optional().describe("Body height in 7 mm units. Grid bins use 0.5 unit increments."),
      fill: z.enum(["none", "solid"]).optional(),
    }), "Create and commit an empty Gridfinity project with a new stable ID.", false,
      async (input, signal) => this.publish("create_project", input, signal, async () => {
        const { name, gridX, gridY, heightUnits, fill } = input;
        const spec = parseBinSpec({
          ...INITIAL_BIN_SPEC,
          gridX: gridX ?? INITIAL_BIN_SPEC.gridX, gridY: gridY ?? INITIAL_BIN_SPEC.gridY,
          heightUnits: heightUnits ?? INITIAL_BIN_SPEC.heightUnits, fill: fill ?? INITIAL_BIN_SPEC.fill,
        });
        const project = { schemaVersion: PROJECT_SCHEMA_VERSION, name, spec, shapes: [], cutouts: [], fingerHoles: [] };
        return { project, projectId: await assignedProjectId(input.requestId), parents: [], requireValidLayout: true };
      })),
    import_project: tool(z.strictObject({
      name: projectNameSchema, requestId: requestIdSchema, expectedBase: z.null(),
      document: z.record(z.string(), z.unknown()).describe("Contents of an editable Pocketry project backup."),
    }), "Import a supported backup as a separate named project. Shape, placement, label, and history identities are preserved.", false,
      async (input, signal) => {
        // Guard raw imports before canonical hashing or replay lookup.
        const project = readFolderProject(input.document);
        return this.publish("import_project", input, signal, async () => ({
          project: { ...project, name: input.name }, projectId: await assignedProjectId(input.requestId), parents: [],
        }));
      }),
    copy_project: tool(projectRef.extend({
      requestId: requestIdSchema, name: projectNameSchema, expectedBase: z.null(),
      edits: editList.optional(),
    }), "Copy a pinned source revision to a new project. Optional edits are applied before the copy’s single publication.", false,
      async (input, signal) => this.publish("copy_project", input, signal, async () => {
        const source = await this.library.read(input.projectId, input.revision);
        const project = input.edits ? (await this.edit(source.doc, input.edits)).project : source.doc;
        return {
          project: { ...project, name: input.name }, projectId: await assignedProjectId(input.requestId),
          parents: [], requireValidLayout: !!input.edits,
        };
      })),
    commit_project: tool(z.strictObject({
      requestId: requestIdSchema, projectId: projectIdSchema, expectedBase: revisionIdSchema, edits: editList,
    }), "Commit a validated batch against the expected single head, retaining one undo step.", false,
      async (input, signal) => this.publish("commit_project", input, signal, async () => {
        const source = await this.library.read(input.projectId, input.expectedBase);
        return {
          project: (await this.edit(source.doc, input.edits)).project,
          projectId: input.projectId, parents: [input.expectedBase], requireValidLayout: true,
        };
      })),
    inspect_request: tool(z.strictObject({ requestId: requestIdSchema, revision: revisionIdSchema.optional() }), "Find an operation’s durable publication and its current heads after a lost or uncertain reply.", true,
      async ({ requestId, revision }) => this.library.inspect(requestId, revision)),
    keep_both: tool(z.strictObject({
      requestId: requestIdSchema, projectId: projectIdSchema,
      expectedHeads: z.array(revisionIdSchema).min(2).max(FOLDER_LIMITS.parents),
      keep: revisionIdSchema,
    }), "Retain the chosen head under the original ID and copy competing live heads to new IDs.", false,
      async ({ requestId, projectId, expectedHeads, keep }) => this.library.keepBoth(requestId, projectId, expectedHeads, keep)),
    export_revision: tool(projectRef.extend({ format: exportFormat }),
      "Export an exact saved revision to a local artifact. Formats include STL, 3MF, multicolor 3MF, and editable backup.", false,
      async ({ projectId, revision, format }, signal) => {
        const saved = await this.library.read(projectId, revision);
        checkCancellation(signal);
        if (format !== "backup") checkLayoutSize(saved.doc);
        const bytes = format === "backup"
          ? encode(JSON.stringify(serializeProjectDoc(saved.doc), null, 2))
          : await this.artifacts.model(saved.doc, format, signal);
        checkCancellation(signal);
        if (bytes.byteLength > ARTIFACT_MAX_BYTES) throw new LibraryError("resource-limit", "The generated artifact is too large.");
        const extension = format === "backup" ? "pocketry.json" : format === "stl" ? "stl" : "3mf";
        const sha256 = await digest(bytes);
        checkCancellation(signal);
        const path = await this.artifacts.write(extension, bytes);
        return { projectId, revision, artifact: { format, path, bytes: bytes.byteLength, sha256 } };
      }),
  };

  async execute(command: string, input: unknown, signal = new AbortController().signal) {
    if (!Object.prototype.hasOwnProperty.call(this.commands, command)) {
      throw new CommandError("invalid-command", "Unknown Pocketry command. Call capabilities or list MCP tools.");
    }
    return this.commands[command as keyof typeof this.commands].execute(input, signal);
  }

  private async edit(project: ProjectDoc, edits: readonly ProjectEdit[]) {
    checkLayoutSize(project);
    const result = await applyProjectEditBatch(project, edits);
    if (result.error) throw new LibraryError("validation", result.error.message, { editIndex: result.error.index });
    const normalized = readFolderProject(serializeProjectDoc(result.project));
    return { project: normalized, validation: validationFor(normalized) };
  }

  private async publish(
    command: string,
    input: { requestId: string },
    signal: AbortSignal,
    prepare: () => Promise<{ project: ProjectDoc; projectId: string; parents: string[]; requireValidLayout?: boolean }>,
  ): Promise<{ outcome: RequestOutcome; validation?: ReturnType<typeof validationFor> }> {
    const fingerprint = await inputFingerprint({ apiVersion: AUTOMATION_VERSION, command, input });
    const previous = await this.library.inspect(input.requestId);
    if ("publications" in previous) {
      if (previous.publications.some(publication => publication.fingerprint === fingerprint)) return { outcome: previous };
      throw new LibraryError("request-reused", "This request ID already has different input.", { requestId: input.requestId });
    }
    checkCancellation(signal);
    const { project, projectId, parents, requireValidLayout } = await prepare();
    const validation = validationFor(project);
    if (requireValidLayout && !validation.ok) {
      throw new LibraryError("validation", "The batch would leave the project with design errors. No changes were published.", { validation });
    }
    checkCancellation(signal);
    const outcome = await this.library.commit({
      requestId: input.requestId, fingerprint,
      changes: [{ projectId, parents, name: project.name!, doc: project }],
    });
    return { outcome, validation };
  }
}
