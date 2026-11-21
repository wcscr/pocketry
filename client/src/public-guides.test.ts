import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import sampleLibrary from "../../samples/pocketry-sample-library.json";
import sampleManifest from "../../samples/source-files.json";

const site = "https://pocketry.xyz";
const rawSamples = "https://raw.githubusercontent.com/wcscr/pocketry/main/samples/";
const clientRoot = resolve(import.meta.dirname, "..");
const guides = ["/quick-start/", "/samples/"];
const read = (file: string) => readFileSync(resolve(clientRoot, file), "utf8");
const parseHtml = (file: string) => new DOMParser().parseFromString(read(file), "text/html");

describe("public Pocketry guides", () => {
  it.each(guides)("serves indexable guide content and editor links at %s", (route) => {
    const guide = parseHtml(`public${route}index.html`);
    expect(guide.title).toContain("Pocketry");
    expect(guide.querySelector("main > h1")?.textContent).toBeTruthy();
    expect(guide.querySelector("main a[href='/bin']")).not.toBeNull();
    expect(guide.querySelector("script")).toBeNull();
    expect(guide.querySelector("meta[name='description']")?.getAttribute("content")).toBeTruthy();
    expect(guide.querySelector("link[rel='canonical']")?.getAttribute("href")).toBe(`${site}${route}`);
    expect(parseHtml("index.html").querySelector(`main a[href='${route}']`)).not.toBeNull();
    expect(read("public/llms.txt")).toContain(`](${site}${route})`);
  });

  it("advertises the homepage and canonical guide URLs in the sitemap", () => {
    const sitemap = new DOMParser().parseFromString(read("public/sitemap.xml"), "application/xml");
    expect(sitemap.documentElement.namespaceURI).toBe("http://www.sitemaps.org/schemas/sitemap/0.9");
    expect([...sitemap.querySelectorAll("url > loc")].map((loc) => loc.textContent)).toEqual(
      ["/", ...guides].map((route) => `${site}${route}`),
    );
    expect(read("public/robots.txt")).toContain(`Sitemap: ${site}/sitemap.xml`);
  });

  it("lists every bundled sample and links to its original editable project and print model", () => {
    const index = parseHtml("public/samples/index.html");
    const rows = [...index.querySelectorAll(".sample-list > li")];
    expect(rows).toHaveLength(sampleLibrary.projects.length);
    const names = new Map(sampleLibrary.projects.map((project) => [project.id, project.name]));
    for (const { directory, project, model, variants = [] } of sampleManifest.samples) {
      for (const design of [{ project, model }, ...variants]) {
        const slug = design.project.file.replace(/\.pocketry\.json$/, "");
        const row = index.getElementById(slug);
        expect(row?.querySelector("h3")?.textContent).toBe(names.get(`pocketry-sample-${slug}`));
        expect([...row!.querySelectorAll(".links a")].map((link) => link.getAttribute("href"))).toEqual(
          [design.project, design.model].map(({ file }) => {
            expect(existsSync(resolve(clientRoot, "../samples", directory, file))).toBe(true);
            return `${rawSamples}${directory}/${file}`;
          }),
        );
      }
    }
  });
});
