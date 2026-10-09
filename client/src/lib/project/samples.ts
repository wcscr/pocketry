import { libraryBackupSchema } from "@shared/gridfinity/library";
import { parseProjectDoc, type ProjectDoc } from "@shared/gridfinity/project";

export interface SampleProject {
  id: string;
  name: string;
  updatedAt: string;
  doc: ProjectDoc;
}

export interface SampleLibrary {
  format: "pocketry-library";
  schemaVersion: 1;
  projects: SampleProject[];
}

/** Validate and migrate the bundled examples through the regular import schema. */
export function parseSampleLibrary(input: unknown): SampleLibrary {
  const backup = libraryBackupSchema.safeParse(input);
  if (!backup.success) throw new Error("The sample library could not be read.");
  const projects = backup.data.projects.map(project => {
    const doc = parseProjectDoc(project.doc);
    if (!doc) throw new Error(`The sample “${project.name}” could not be opened.`);
    return { ...project, doc: { ...doc, name: project.name } };
  });
  return { ...backup.data, projects: projects.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Vite ships the repository's existing sample library as an on-demand chunk. */
export async function loadSampleLibrary(): Promise<SampleLibrary> {
  const { default: input } = await import("../../../../samples/pocketry-sample-library.json");
  return parseSampleLibrary(input);
}
