import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

interface PackageMetadata {
  name: string;
  version: string;
  license?: string;
  repository?: string | { url?: string };
}

interface Supplement {
  packages: string[];
  file: string;
  sources: string[];
}

/** Resolve the owning package, including scoped/nested installs and Vite queries. */
function packageDirectory(moduleId: string): string | undefined {
  const id = moduleId.replace(/^\0/, "").replaceAll("\\", "/").split("?")[0];
  return id.match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/)?.[1];
}

/** Full upstream notices for the packages in emitted chunks, not a license-name list. */
export function bundledNpmNotices(repositoryRoot: string, moduleIds: Iterable<string>): string {
  const supplementsRoot = path.join(repositoryRoot, "licenses/npm");
  const supplements = JSON.parse(readFileSync(path.join(supplementsRoot, "supplements.json"), "utf8")) as Supplement[];
  const directories = new Set(Array.from(moduleIds, packageDirectory).filter((p): p is string => !!p));
  const sections = new Map<string, string>();

  for (const directory of directories) {
    const pkg = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")) as PackageMetadata;
    if (!pkg.name || !pkg.version) throw new Error(`Missing package identity for bundled module in ${directory}`);
    const identity = `${pkg.name}@${pkg.version}`;
    const files = readdirSync(directory, { withFileTypes: true })
      .filter(file => file.isFile() && /^(licen[cs]e|copying|notice)([._-].*)?$/i.test(file.name))
      .map(file => file.name).sort();
    const texts = files.map(file => ({ file, text: readFileSync(path.join(directory, file), "utf8") }));
    const hasLicense = texts.some(({ file, text }) => /^(licen[cs]e|copying)/i.test(file) && text.trim());
    const supplement = supplements.find(entry => entry.packages.includes(identity));
    if (!hasLicense && !supplement) {
      throw new Error(`Missing license text for bundled ${identity}. Add a reviewed, version-specific entry to licenses/npm/supplements.json.`);
    }
    if (!hasLicense && supplement) {
      const text = readFileSync(path.join(supplementsRoot, supplement.file), "utf8");
      if (!text.trim()) throw new Error(`Empty license supplement for ${identity}`);
      texts.unshift({ file: `Upstream license (${supplement.sources.join(", ")})`, text });
    }
    const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    const section = [
      "=".repeat(80), identity,
      ...(pkg.license ? [`Declared license: ${pkg.license}`] : []),
      ...(repository ? [`Source: ${repository}`] : []),
      "=".repeat(80), "",
      ...texts.flatMap(({ file, text }) => [file, "", text.trimEnd(), ""]),
    ].join("\n");
    const previous = sections.get(identity);
    if (previous && previous !== section) throw new Error(`Conflicting installed notices for ${identity}`);
    sections.set(identity, section);
  }

  return [
    "Bundled npm package licenses and notices",
    "Includes direct and transitive packages in this build's browser and worker chunks.",
    "Vendored assets and their additional notices are identified above.", "",
    ...Array.from(sections.keys()).sort().map(identity => sections.get(identity)), "",
  ].join("\n");
}

/** Workers finish before the main bundle is emitted, so both feed the same notice. */
export function legalFilesPlugins(repositoryRoot: string): { main: Plugin; worker: () => Plugin } {
  const modules = new Set<string>();
  const collect: Plugin["generateBundle"] = function (_options, bundle) {
    for (const output of Object.values(bundle)) {
      if (output.type === "chunk") for (const id of Object.keys(output.modules)) modules.add(id);
    }
  };
  return {
    main: {
      name: "pocketry-legal-files",
      apply: "build",
      buildStart() { modules.clear(); },
      generateBundle(options, bundle, isWrite) {
        collect.call(this, options, bundle, isWrite);
        this.emitFile({ type: "asset", fileName: "LICENSE.txt", source: readFileSync(path.join(repositoryRoot, "LICENSE"), "utf8") });
        this.emitFile({
          type: "asset", fileName: "NOTICE.txt",
          source: readFileSync(path.join(repositoryRoot, "NOTICE"), "utf8").trimEnd() + "\n\n" + bundledNpmNotices(repositoryRoot, modules),
        });
      },
    },
    worker: () => ({ name: "pocketry-worker-notices", apply: "build", generateBundle: collect }),
  };
}
