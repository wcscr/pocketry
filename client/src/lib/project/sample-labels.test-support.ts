import { readFileSync } from "node:fs";
import { parseProjectDoc } from "@shared/gridfinity/project";

export const labeledSamples = [
  { slug: "wiha-drivers", wording: ["Wiha Drivers"] },
  { slug: "dewalt-right-angle-tools", wording: ["Dewalt Right Angle Adapters"] },
  { slug: "wire-strippers", wording: ["Wire Stripper"] },
  { slug: "mouldline-remover", wording: ["Mouldline", "Remover"] },
  { slug: "ryobi-cutter", wording: ["Ryobi Cutter"] },
  { slug: "bessey-gerber", wording: ["Bessey", "Gerber"] },
];

export function loadLabeledSample(slug: string) {
  const file = readFileSync(new URL(`../../../../samples/${slug}/${slug}.pocketry.json`, import.meta.url), "utf8");
  const raw: unknown = JSON.parse(file);
  const project = parseProjectDoc(raw)!;
  return { file, raw, project };
}
