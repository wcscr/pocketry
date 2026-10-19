import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { parseProjectDoc } from "@shared/gridfinity/project";
import catalog from "../../../../samples/pocketry-sample-library.json";
import provenance from "../../../../samples/source-files.json";
import { labeledSamples, loadLabeledSample } from "./sample-labels.test-support";

it.each(labeledSamples)("keeps $slug label text, provenance and library copies consistent", ({ slug, wording }) => {
  const {file, raw, project} = loadLabeledSample(slug);
  expect(project).not.toBeNull();
  expect(project.spec.surfaceTexts.map(label => label.text)).toEqual(wording);
  expect(catalog.projects.find(item => item.id === `pocketry-sample-${slug}`)!.doc).toEqual(raw);
  expect(provenance.samples.find(item => item.directory === slug)!.project.sha256)
    .toBe(createHash("sha256").update(file).digest("hex"));
  expect(parseProjectDoc(JSON.parse(JSON.stringify(project)))).toEqual(project);

});
