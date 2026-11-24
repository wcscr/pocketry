import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { binLengthMm, binWidthMm } from "../shared/gridfinity/bin-size";
import { binHeightMm } from "../shared/gridfinity/standard";
import { parseBinSpec } from "../shared/gridfinity/types";

const site = "https://pocketry.xyz";
const repository = "https://github.com/wcscr/pocketry";
const rawSamples = "https://raw.githubusercontent.com/wcscr/pocketry/main/samples";
const sampleIdPrefix = "pocketry-sample-";

interface SampleFiles {
  project: { file: string };
  model: { file: string };
  photos?: { file: string }[];
}

interface SamplePhoto {
  file: string;
  caption: string;
}

interface SampleDescription {
  description: string;
  tools: string[];
  features: string[];
  keywords?: string[];
  preview?: string;
  detailPhotos?: SamplePhoto[];
}

interface CatalogEntry extends SampleDescription {
  slug: string;
  id: string;
  name: string;
  directory: string;
  project: string;
  model: string;
  binType: string;
  footprint: string;
  dimensions: string;
  detailPhotos: SamplePhoto[];
}

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const samplePath = (slug: string) => `/samples/${slug}/`;
const assetUrl = (directory: string, file: string) =>
  `${rawSamples}/${[directory, ...file.split("/")].map(encodeURIComponent).join("/")}`;
const editorPath = (id: string) => `/bin?sample=${encodeURIComponent(id)}`;
const mm = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function loadEntries(root: string): CatalogEntry[] {
  const read = (file: string): unknown => JSON.parse(readFileSync(resolve(root, "samples", file), "utf8"));
  const { projects } = read("pocketry-sample-library.json") as { projects: { id: string; name: string; doc: { spec: unknown } }[] };
  const { samples } = read("source-files.json") as { samples: (SampleFiles & {
    directory: string; variants?: SampleFiles[];
  })[] };
  const descriptions = new Map(Object.entries(read("catalog.json") as Record<string, SampleDescription>));
  const files = new Map<string, SampleFiles & { directory: string }>();
  for (const { directory, project, model, photos, variants = [] } of samples) {
    for (const design of [{ project, model, photos }, ...variants]) {
      const slug = design.project.file.replace(/\.pocketry\.json$/, "");
      if (files.has(slug)) throw new Error(`Duplicate public sample: ${slug}`);
      files.set(slug, { ...design, directory });
    }
  }
  const entries = projects.map(({ id, name, doc }) => {
    const slug = id.slice(sampleIdPrefix.length);
    const assets = files.get(slug);
    const content = descriptions.get(slug);
    if (!id.startsWith(sampleIdPrefix) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !assets || !content) {
      throw new Error(`Missing public catalog data for sample ${id}`);
    }
    files.delete(slug);
    descriptions.delete(slug);
    const spec = parseBinSpec(doc.spec);
    const binType = spec.pegBottom ? "ULTIM8-compatible fixture" : spec.flatBottom ? "Flat-bottom bin" : "Gridfinity bin";
    const footprint = spec.footprint.kind === "custom" ? "custom footprint" : `${spec.footprint.kind} footprint`;
    const preview = content.preview ?? assets.photos?.[0]?.file;
    const pocketPhotos = (assets.photos ?? []).map(photo => photo.file)
      .filter(file => file !== preview && /^photos\/printed-bin-(pocket|empty)[.-]/.test(file))
      .map(file => ({
        file,
        caption: file.includes("printed-bin-empty") ? "Empty printed bin" : "Pocket view with the tool removed",
      }));
    return {
      ...content, id, slug, name, binType, footprint, directory: assets.directory,
      preview, detailPhotos: [...pocketPhotos, ...(content.detailPhotos ?? [])],
      project: assetUrl(assets.directory, assets.project.file),
      model: assetUrl(assets.directory, assets.model.file),
      dimensions: `${mm.format(binWidthMm(spec))} × ${mm.format(binLengthMm(spec))} mm ${spec.footprint.kind === "custom" ? "bounding footprint" : "footprint"} · ${mm.format(binHeightMm(spec.heightUnits))} mm body height${spec.lip === "standard" ? " before the stacking lip" : ""}`,
    };
  });
  if (files.size || descriptions.size) throw new Error("Public catalog data contains entries outside the bundled sample library");
  return entries;
}

function page(path: string, title: string, description: string, content: string, scripts = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${escape(description)}" />
  <link rel="canonical" href="${site}${path}" />
  <link rel="describedby" href="/llms.txt" />
  <link rel="icon" href="/favicon.ico" />
  <link rel="stylesheet" href="/guides.css" />
  <title>${escape(title)} | Pocketry</title>
  ${scripts}
</head>
<body>
  <header><nav aria-label="Pocketry">
    <a class="brand" href="/">Pocketry</a>
    <a href="/samples/">Sample designs</a>
    <a href="/quick-start/">Quick start</a>
  </nav></header>
  <main>${content}</main>
  <footer><nav aria-label="Related pages">
    <a href="${repository}/tree/main/samples">Print notes and attribution on GitHub</a>
    <a href="/feedback">Send feedback</a>
  </nav></footer>
</body>
</html>
`;
}

function downloads(entry: CatalogEntry): string {
  return `<a href="${escape(entry.project)}">Editable project (.pocketry.json)</a>
    <a href="${escape(entry.model)}">Print model (.3mf)</a>`;
}

function sampleIndex(entries: CatalogEntry[]): string {
  const rows = entries.map(entry => `<li id="${entry.slug}" data-keywords="${escape([...entry.features, ...(entry.keywords ?? [])].join(" "))}">
      ${entry.preview ? `<img class="sample-thumbnail" src="${escape(assetUrl(entry.directory, entry.preview))}" alt="" width="72" height="72" loading="lazy" decoding="async" />` : ""}
      <div>
        <h3><a href="${samplePath(entry.slug)}">${escape(entry.name)}</a></h3>
        <p>${escape(entry.binType)}, ${escape(entry.footprint)} · ${escape(entry.tools.join("; "))}</p>
        <div class="links">${downloads(entry)}</div>
      </div>
    </li>`);
  return page("/samples/", "Search sample designs and 3MF downloads",
    "Search editable Pocketry sample designs by tool, brand, model, or feature. Browse fitted tool bins, print photos, and 3MF downloads.", `
  <h1>Pocketry sample projects</h1>
  <p>Find a bin for your tool, open an editable copy in Pocketry, or download a 3MF to print.</p>
  <p><a href="${rawSamples}/pocketry-sample-library.json">Download the entire editable library</a> to import all designs in <a href="/bin">Bin</a> via <strong>Library → Import library</strong>.</p>
  <h2>Designs and downloads</h2>
  <div id="sample-search" class="sample-search" hidden>
    <label for="sample-query">Search sample designs</label>
    <input type="search" id="sample-query" placeholder="Tool, brand, model, or feature" />
    <p id="sample-search-status" role="status"></p>
  </div>
  <ul class="sample-list">${rows.join("\n    ")}</ul>`, '<script src="/sample-search.js" defer></script>');
}

function sampleImages(entry: CatalogEntry): string {
  const images = [...entry.detailPhotos];
  if (entry.preview) images.unshift({
    file: entry.preview,
    caption: entry.preview.endsWith(".svg") ? "Bin layout" : "Printed bin with tools in place",
  });
  if (images.length === 0) return "";
  return `<div class="sample-photos">
    ${images.map(({ file, caption }, index) => `<figure class="sample-preview">
      <img src="${escape(assetUrl(entry.directory, file))}" alt="${escape(`${caption} for ${entry.name}`)}"${index ? ' loading="lazy"' : ""} />
      <figcaption>${escape(caption)}</figcaption>
    </figure>`).join("\n    ")}
  </div>`;
}

function samplePage(entry: CatalogEntry, entries: CatalogEntry[]): string {
  const variants = entries.filter(other => other.directory === entry.directory && other.id !== entry.id);
  return page(samplePath(entry.slug), `${entry.name} | ${entry.binType}`, entry.description, `
  <h1>${escape(entry.name)}</h1>
  <p>${escape(entry.description)}</p>
  <div class="links">
    <a class="open-sample" href="${escape(editorPath(entry.id))}">Open in Pocketry</a>
    ${downloads(entry)}
  </div>
  <dl class="sample-details">
    <dt>Tools</dt><dd>${escape(entry.tools.join("; "))}</dd>
    <dt>Bin type</dt><dd>${escape(entry.binType)}</dd>
    <dt>Bin dimensions</dt><dd>${escape(entry.dimensions)}</dd>
  </dl>
  <h2>Design features</h2>
  <ul>
    ${entry.features.map(feature => `<li>${escape(feature)}</li>`).join("\n    ")}
  </ul>
  ${sampleImages(entry)}
  <p>Check the dimensions and print a fit check if you adapt the design. <a href="${repository}/tree/main/samples/${encodeURIComponent(entry.directory)}">See the original sample notes for fit and print details</a>.</p>
  ${variants.length ? `<h2>Related designs</h2><ul>${variants.map(other =>
    `<li><a href="${samplePath(other.slug)}">${escape(other.name)}</a></li>`).join("")}</ul>` : ""}`);
}

/** The catalog, stable detail pages, and sitemap are built from the same entries. */
export function buildPublicSampleFiles(root: string): Map<string, string> {
  const entries = loadEntries(root);
  const files = new Map([["samples/index.html", sampleIndex(entries)]]);
  for (const entry of entries) files.set(`${samplePath(entry.slug).slice(1)}index.html`, samplePage(entry, entries));
  const routes = ["/", "/quick-start/", "/samples/", ...entries.map(entry => samplePath(entry.slug))];
  files.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map(route => `  <url><loc>${site}${route}</loc></url>`).join("\n")}
</urlset>
`);
  return files;
}

export function publicSampleCatalogPlugin(root: string): Plugin {
  return {
    name: "pocketry-public-samples",
    generateBundle() {
      for (const [fileName, source] of buildPublicSampleFiles(root)) this.emitFile({ type: "asset", fileName, source });
    },
    configureServer(server) {
      const files = buildPublicSampleFiles(root);
      // Run after Vite's built-in host and file access checks.
      return () => server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const path = req.url?.split("?", 1)[0] ?? "";
        const fileName = path.replace(/^\//, "").replace(/\/$/, "");
        const content = files.get(fileName) ?? files.get(`${fileName}/index.html`);
        if (content === undefined) return next();
        res.setHeader("Content-Type", fileName === "sitemap.xml" ? "application/xml; charset=utf-8" : "text/html; charset=utf-8");
        res.end(req.method === "HEAD" ? undefined : content);
      });
    },
  };
}
