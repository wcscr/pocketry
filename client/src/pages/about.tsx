import { ExternalLink, Github, Scale } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const SOURCE_URL = "https://github.com/wcscr/pocketry";

const RELATED_PROJECTS = [
  {
    name: "Gridfinity Rebuilt OpenSCAD",
    description:
      "Parametric OpenSCAD bins and the upstream geometry foundation directly adapted by Pocketry.",
    badge: "MIT",
    url: "https://github.com/kennetek/gridfinity-rebuilt-openscad",
  },
  {
    name: "Gridfinity Extended",
    description:
      "A broad OpenSCAD toolkit for customizable bins, baseplates, drawers, lids, and specialized holders.",
    badge: "GPL-3.0",
    url: "https://github.com/ostat/gridfinity_extended_openscad",
  },
  {
    name: "Gridfinity Layout Tool",
    description:
      "Plan complete drawers in the browser, then generate bins, baseplates, and an optimized print list.",
    badge: "AGPL-3.0",
    url: "https://github.com/andymai/gridfinity-layout-tool",
  },
  {
    name: "Outline App",
    description:
      "An image-based outline editor and Gridfinity box creator with contour, text, and primitive editing.",
    badge: "AGPL-3.0",
    url: "https://github.com/georgslazdans/outline-app",
  },
  {
    name: "Tracefinity",
    description:
      "A self-hostable photo-to-bin workflow with automatic tool tracing, a reusable tool library, and STL, 3MF, and SVG export.",
    badge: "MIT",
    url: "https://github.com/tracefinity/tracefinity",
  },
  {
    name: "ToolTrace.ai",
    description:
      "A hosted photo-to-outline service for making custom Gridfinity trays, foam inserts, and shadow-board layouts.",
    badge: "Web service",
    url: "https://www.tooltrace.ai",
  },
  {
    name: "Systemax DIY",
    description:
      "Photograph tools, build a reusable tool library and drawer layout, then order the resulting Gridfinity organizers or export production files.",
    badge: "Design service",
    url: "https://www.systemax.no/diy",
  },
  {
    name: "Gridfinity Rebase",
    description:
      "Replace the bases in downloaded Gridfinity STLs with your preferred magnet-hole and attachment setup directly in the browser.",
    badge: "GPL-3.0",
    url: "https://gridfinity.tools/rebase",
  },
  {
    name: "GridFlock",
    description:
      "Generate large Gridfinity baseplates that split into printable sections and reconnect with open puzzle-style joints.",
    badge: "MIT / CC-BY",
    url: "https://github.com/yawkat/GridFlock",
  },
] as const;

/** Project background, legal notices, and links to related Gridfinity tools. */
export default function About(): JSX.Element {
  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 lg:py-12">
        <section className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-primary">Open-source toolmaking</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              About Pocketry
            </h1>
            <p className="max-w-3xl text-base leading-7 text-muted-foreground">
              Pocketry turns tool photos into editable outlines, fit-check files,
              shadow-board layouts, and printable Gridfinity bins. Image processing,
              project storage, and model generation run locally in your browser.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                <Github aria-hidden />
                View source on GitHub
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="/LICENSE.txt" target="_blank" rel="noreferrer">
                <Scale aria-hidden />
                Read the license
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="/NOTICE.txt" target="_blank" rel="noreferrer">
                Read third-party notices
                <ExternalLink aria-hidden />
              </a>
            </Button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">License</CardTitle>
              <CardDescription>GNU Affero General Public License</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
              <p>
                Pocketry&apos;s original work is distributed under
                AGPL-3.0-only. The complete license text shipped with this build
                is the controlling document.
              </p>
              <p>
                Source, issue tracking, and contributions are available in the
                public GitHub repository.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Attribution</CardTitle>
              <CardDescription>Open source makes Pocketry possible</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
              <p>
                Major bundled or adapted projects include OpenCV/OpenCV.js,
                manifold-3d, Gridfinity Rebuilt OpenSCAD, and shadcn/ui.
              </p>
              <p>
                The shipped NOTICE identifies their licenses and provenance and
                inventories Pocketry&apos;s direct npm dependencies and build tools.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4" aria-labelledby="related-projects-heading">
          <div className="space-y-1">
            <h2
              id="related-projects-heading"
              className="text-2xl font-semibold tracking-tight"
            >
              More Gridfinity tools
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              These independent projects complement Pocketry or provide
              alternatives to its photo-to-pocket workflow, including configurable
              bins, baseplates, drawer planning, and alternate outline tools.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {RELATED_PROJECTS.map((project) => (
              <Card key={project.url} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-lg leading-6">
                      {project.name}
                    </CardTitle>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {project.badge}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4">
                  <p className="flex-1 text-sm leading-6 text-muted-foreground">
                    {project.description}
                  </p>
                  <a
                    href={project.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    Visit project
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
