import { z } from "zod";
import { localFontSourceSchema, type LocalFontSource } from "./local-font";
import type { ProjectDoc } from "./project";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const sourceReferenceSchema = z.object({ ref: z.string().regex(/^font-\d+$/) }).strict();
const sourceTableSchema = z.record(z.string().regex(/^font-\d+$/), localFontSourceSchema);

/** Visit only the three schema-owned locations that retain bin specs. Unknown
 * fields remain intact so the ordinary strict schemas can reject them. */
function mapSources(project: Record<string, unknown>, source: (value: unknown) => unknown): Record<string, unknown> {
  const spec = (value: unknown): unknown => !record(value) || !Array.isArray(value.surfaceTexts) ? value : {
    ...value, surfaceTexts: value.surfaceTexts.map(label => {
      if (!record(label) || !record(label.font) || label.font.kind !== "local" || label.font.source === undefined) return label;
      return { ...label, font: { ...label.font, source: source(label.font.source) } };
    }),
  };
  const material = (value: unknown): unknown => record(value) ? { ...value, spec: spec(value.spec) } : value;
  return {
    ...project, spec: spec(project.spec),
    ...(record(project.history) && Array.isArray(project.history.stack) ? { history: {
      ...project.history, stack: project.history.stack.map(entry => record(entry) ? { ...entry, doc: material(entry.doc) } : entry),
    } } : {}),
    ...(record(project.transformOrigins) && Array.isArray(project.transformOrigins.pockets) ? { transformOrigins: {
      ...project.transformOrigins, pockets: project.transformOrigins.pockets.map(material),
    } } : {}),
  };
}

/** The editing model retains source data for offline glyph extension. Persist
 * each source once, even when many labels and undo steps reference that font. */
export function serializeProjectDoc(project: ProjectDoc): Record<string, unknown> {
  const byData = new Map<string, Map<number, string>>();
  const fontSources: Record<string, LocalFontSource> = {};
  let count = 0;
  const compact = mapSources(project, value => {
    const source = value as LocalFontSource;
    let lengths = byData.get(source.data);
    if (!lengths) { lengths = new Map(); byData.set(source.data, lengths); }
    let ref = lengths.get(source.byteLength);
    if (!ref) {
      ref = `font-${++count}`;
      lengths.set(source.byteLength, ref);
      fontSources[ref] = source;
    }
    return { ref };
  });
  return count ? { ...compact, fontSources } : compact;
}

/** Resolve only validated references, then let the normal project parser
 * validate all restored labels, history entries, and transform origins. */
export function expandProjectFontSources(input: unknown): unknown {
  if (!record(input) || !("fontSources" in input)) return input;
  const sources = sourceTableSchema.safeParse(input.fontSources);
  if (!sources.success) return null;
  const { fontSources: _sources, ...project } = input;
  let valid = true;
  const expanded = mapSources(project, value => {
    if (!record(value) || !("ref" in value)) return value;
    const reference = sourceReferenceSchema.safeParse(value);
    if (!reference.success || !Object.prototype.hasOwnProperty.call(sources.data, reference.data.ref)) {
      valid = false; return value;
    }
    return sources.data[reference.data.ref];
  });
  return valid ? expanded : null;
}
