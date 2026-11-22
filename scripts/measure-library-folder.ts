// Measure a cold journal scan and commits with the checked-in sample designs.
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { libraryBackupSchema } from "../shared/gridfinity/library";
import { serializeProjectDoc } from "../shared/gridfinity/project";
import { ConnectedLibrary } from "../shared/project-library/library";
import { canonicalJson, digest, encode, readFolderProject, revisionFile, type Publication } from "../shared/project-library/format";
import { NodeLibraryFolder } from "../server/project-library/node-folder";

const editorHistorySteps = Number(process.argv[2] ?? 0);
if (!Number.isInteger(editorHistorySteps) || editorHistorySteps < 0 || editorHistorySteps > 50) {
  throw new Error("Pass a retained editor history length between 0 and 50.");
}
const root = await mkdtemp(join(tmpdir(), "pocketry-library-measure-"));
try {
  const source = libraryBackupSchema.parse(JSON.parse(await readFile("samples/pocketry-sample-library.json", "utf8")));
  const folder = await NodeLibraryFolder.connect(root);
  const library = new ConnectedLibrary(folder);
  const seriesLength = 40;
  for (const project of source.projects) {
    let parents: string[] = [];
    const sourceDoc = readFolderProject(project.doc);
    const { spec, cutouts, fingerHoles } = sourceDoc;
    const history = editorHistorySteps ? {
      stack: Array.from({ length: editorHistorySteps }, (_, step) => ({
        doc: { spec, cutouts, fingerHoles }, label: `Saved design step ${step + 1}`,
      })),
      index: editorHistorySteps - 1,
    } : sourceDoc.history;
    const doc = serializeProjectDoc({ ...sourceDoc, name: project.name, history });
    // Seed equivalent valid snapshots directly so fixture setup is not a
    // quadratic series of benchmark operations.
    for (let step = 0; step < seriesLength; step++) {
      const requestId = `measure-${project.id}-${step}`;
      const fingerprint = await digest(encode(requestId));
      const publication: Publication = {
        format: "pocketry-folder-revision", version: 2, requestId, fingerprint,
        changes: [{ projectId: project.id, parents, name: project.name, doc }],
      };
      const bytes = encode(canonicalJson(publication));
      const token = await digest(bytes);
      await folder.publish(revisionFile(fingerprint, token), bytes);
      parents = [token];
    }
  }
  const names = await readdir(root);
  const bytes = (await Promise.all(names.map(async name => (await stat(join(root, name))).size))).reduce((a, b) => a + b, 0);
  const target = source.projects[0];
  const timings: Record<string, number[]> = { list: [], read: [], commit: [] };
  for (let i = 0; i < 5; i++) {
    let time = performance.now();
    await library.list();
    timings.list.push(performance.now() - time);
    time = performance.now();
    const { revision, doc } = await library.read(target.id);
    timings.read.push(performance.now() - time);
    time = performance.now();
    const outcome = await library.commit({
      requestId: `sample-update-${i}`, changes: [{ projectId: target.id, parents: [revision], name: target.name, doc }],
    });
    if (outcome.status !== "published") throw new Error(JSON.stringify(outcome));
    timings.commit.push(performance.now() - time);
  }
  console.log(JSON.stringify({ projects: source.projects.length, revisions: names.length, bytes, editorHistorySteps, milliseconds: timings }, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
