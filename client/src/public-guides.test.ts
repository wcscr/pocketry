import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import sampleLibrary from "../../samples/pocketry-sample-library.json";
import sampleManifest from "../../samples/source-files.json";
import { buildPublicSampleFiles } from "../../server/sample-catalog";

const site = "https://pocketry.xyz";
const rawSamples = "https://raw.githubusercontent.com/wcscr/pocketry/main/samples/";
const clientRoot = resolve(import.meta.dirname, "..");
const guides = ["/quick-start/", "/samples/"];
const read = (file: string) => readFileSync(resolve(clientRoot, file), "utf8");
const built = buildPublicSampleFiles(resolve(clientRoot, ".."));
const parseHtml = (html: string) => new DOMParser().parseFromString(html, "text/html");
const sampleRoute = (id: string) => `/samples/${id.replace(/^pocketry-sample-/, "")}/`;
const sampleIndex = () => parseHtml(built.get("samples/index.html")!);

describe("public Pocketry guides", () => {
  it.each(guides)("serves indexable guide content and editor links at %s", (route) => {
    const guide = parseHtml(built.get(`${route.slice(1)}index.html`) ?? read(`public${route}index.html`));
    expect(guide.title).toContain("Pocketry");
    expect(guide.querySelector("main > h1")?.textContent).toBeTruthy();
    expect(guide.querySelector("main a[href='/bin']")).not.toBeNull();
    expect([...guide.querySelectorAll("script")].map(script => script.getAttribute("src")))
      .toEqual(route === "/samples/" ? ["/sample-search.js"] : []);
    expect(guide.querySelector("meta[name='description']")?.getAttribute("content")).toBeTruthy();
    expect(guide.querySelector("link[rel='canonical']")?.getAttribute("href")).toBe(`${site}${route}`);
    expect(parseHtml(read("index.html")).querySelector(`main a[href='${route}']`)).not.toBeNull();
    expect(read("public/llms.txt")).toContain(`](${site}${route})`);
  });

  it("advertises the homepage, guides, and every sample detail page in the sitemap", () => {
    const sitemap = new DOMParser().parseFromString(built.get("sitemap.xml")!, "application/xml");
    expect(sitemap.documentElement.namespaceURI).toBe("http://www.sitemaps.org/schemas/sitemap/0.9");
    expect([...sitemap.querySelectorAll("url > loc")].map((loc) => loc.textContent)).toEqual(
      ["/", ...guides, ...sampleLibrary.projects.map(project => sampleRoute(project.id))].map(route => `${site}${route}`),
    );
    expect(read("public/robots.txt")).toContain(`Sitemap: ${site}/sitemap.xml`);
  });

  it("lists every bundled sample and links to its original editable project and print model", () => {
    const index = sampleIndex();
    const rows = [...index.querySelectorAll(".sample-list > li")];
    expect(rows).toHaveLength(sampleLibrary.projects.length);
    const names = new Map(sampleLibrary.projects.map((project) => [project.id, project.name]));
    for (const { directory, project, model, variants = [] } of sampleManifest.samples) {
      for (const design of [{ project, model }, ...variants]) {
        const slug = design.project.file.replace(/\.pocketry\.json$/, "");
        const row = index.getElementById(slug);
        const id = `pocketry-sample-${slug}`;
        const route = sampleRoute(id);
        expect(row?.querySelector("h3 > a")?.getAttribute("href")).toBe(route);
        expect(row?.querySelector("h3")?.textContent).toBe(names.get(id));
        const detail = parseHtml(built.get(`${route.slice(1)}index.html`)!);
        expect(detail.querySelector("h1")?.textContent).toBe(names.get(id));
        expect(detail.querySelector("link[rel='canonical']")?.getAttribute("href")).toBe(`${site}${route}`);
        expect(detail.querySelector(".open-sample")?.getAttribute("href")).toBe(`/bin?sample=${id}`);
        expect(detail.querySelector("script")).toBeNull();
        const detailImages = [...detail.querySelectorAll("figure img")].map(img => img.getAttribute("src")!);
        const [preview] = detailImages;
        expect(preview).toMatch(new RegExp(`^${rawSamples}${directory}/`));
        for (const src of detailImages) {
          expect(existsSync(resolve(clientRoot, "../samples", decodeURI(src.slice(rawSamples.length))))).toBe(true);
        }
        expect([...row!.querySelectorAll("img")].map(img => img.getAttribute("src"))).toEqual([preview]);
        if (design.project !== project) expect(preview).toMatch(/-layout\.svg$/);
        if (slug === "ryobi-cutter") {
          expect(detailImages).toContain(`${rawSamples}${directory}/photos/printed-bin-pocket.jpg`);
          expect(detail.querySelector("main")?.textContent).toContain("Two-level pocket with 14 mm and 55 mm depths");
        }
        const expected = [design.project, design.model].map(({ file }) => {
          expect(existsSync(resolve(clientRoot, "../samples", directory, file))).toBe(true);
          return `${rawSamples}${directory}/${file}`;
        });
        expect([...row!.querySelectorAll(".links a")].map(link => link.getAttribute("href"))).toEqual(expected);
        expect([...detail.querySelectorAll("main .links a:not(.open-sample)")].map(link => link.getAttribute("href"))).toEqual(
          expected,
        );
      }
    }
  });

  it("preserves angle brackets and entity spellings as text in photo captions", () => {
    const root = mkdtempSync(resolve(tmpdir(), "pocketry-catalog-"));
    try {
      const samples = resolve(root, "samples");
      mkdirSync(samples);
      const slug = "craftsman-tape-measure";
      const projects = sampleLibrary.projects.filter(project => project.id === `pocketry-sample-${slug}`);
      const assets = sampleManifest.samples.filter(sample => sample.directory === slug);
      const caption = 'Belt clip < 22 mm & "handle" details, labeled &lt;rear&gt;';
      const file = "photos/tape-measure-clip.jpg";
      writeFileSync(resolve(samples, "pocketry-sample-library.json"), JSON.stringify({ projects }));
      writeFileSync(resolve(samples, "source-files.json"), JSON.stringify({ samples: assets }));
      writeFileSync(resolve(samples, "catalog.json"), JSON.stringify({
        [slug]: {
          description: "A tape measure bin",
          tools: ["Tape measure"],
          features: ["Belt clip relief"],
          detailPhotos: [{ file, caption }],
        },
      }));

      const html = buildPublicSampleFiles(root).get(`samples/${slug}/index.html`)!;
      expect(html).toContain("<figcaption>Belt clip &lt; 22 mm &amp; &quot;handle&quot; details, labeled &amp;lt;rear&amp;gt;</figcaption>");
      const photo = parseHtml(html).querySelector(`figure img[src$="${file}"]`);
      expect(photo?.nextElementSibling?.textContent).toBe(caption);
      expect(photo?.nextElementSibling?.childElementCount).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("finds model numbers and multi-tool matches, and restores the complete list when cleared", () => {
    const index = sampleIndex();
    new Function("document", read("public/sample-search.js"))(index);
    const input = index.querySelector<HTMLInputElement>("#sample-query")!;
    const visible = () => [...index.querySelectorAll(".sample-list > li:not([hidden])")].map(row => row.id);
    function search(value: string) {
      input.value = value;
      input.dispatchEvent(new Event("input"));
      return visible();
    }
    expect(search("wiha PH1 60mm")).toEqual(["wiha-60mm-drivers"]);
    expect(search("bessey d-bkwh")).toEqual(["bessey-utility-knife", "bessey-gerber"]);
    expect(search("mold line remover")).toEqual(["mouldline-remover"]);
    expect(search("multi-level pocket")).toEqual(["ryobi-cutter", "stapler"]);
    expect(search("no such tool")).toEqual([]);
    expect(index.querySelector("[role='status']")?.textContent).toContain("No sample designs match");
    expect(search("")).toHaveLength(sampleLibrary.projects.length);
  });
});
