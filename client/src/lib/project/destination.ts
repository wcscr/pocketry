import { projectDocSchema, serializeProjectDoc, type ProjectDoc } from "@shared/gridfinity/project";
import { DEFAULT_BIN_MATERIALS } from "@shared/gridfinity/materials";

/** Named projects have stable IDs. Drafts use a content fingerprint so another
 * tab's different unnamed draft cannot silently receive queued tools. This is
 * an identity hint, not a security hash; persistence still checks its full snapshot. */
export function projectDestinationKey(doc: ProjectDoc | null, projectId: string | null): string {
  if (projectId !== null) return `project:${projectId}`;
  if (!doc) return "draft:empty";
  const text = JSON.stringify(serializeProjectDoc(projectDocSchema.parse({
    ...doc,
    keepBinSize: doc.keepBinSize ?? false,
    materials: doc.materials ?? DEFAULT_BIN_MATERIALS,
    transformOrigins: doc.transformOrigins ?? { pockets: [], fingerHoles: [] },
    history: doc.history?.stack.length === 1 ? undefined : doc.history,
  })));
  let first = 2166136261, second = 5381;
  for (let index = 0; index < text.length; index++) {
    first = Math.imul(first ^ text.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ text.charCodeAt(index);
  }
  return `draft:${text.length}:${first >>> 0}:${second >>> 0}`;
}
