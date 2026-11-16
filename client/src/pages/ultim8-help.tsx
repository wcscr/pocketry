import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Ultim8Link } from "@/components/ui/ultim8-link";

/** Fixture instructions live separately from the photo-to-bin guide. */
export default function Ultim8Help(): JSX.Element {
  return (
    <main className="h-full overflow-y-auto">
      <article className="mx-auto max-w-3xl space-y-6 px-4 py-8 text-sm leading-relaxed sm:px-6">
        <header className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">ULTIM8-compatible fixture guide</h1>
          <p className="text-muted-foreground">
            Create positioning fixtures for the Wham Bam Systems <Ultim8Link /> mat for eufyMake E1.
            This feature is in Beta; print a small fit test before a full fixture.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild><Link href="/ultim8">Start or open a fixture</Link></Button>
            <Button asChild variant="outline"><Link href="/bin">Return to Bin</Link></Button>
          </div>
        </header>

        <section className="space-y-2" aria-labelledby="fixture-start">
          <h2 id="fixture-start" className="text-lg font-semibold">1. Start the fixture</h2>
          <p>
            Open <a href="https://pocketry.xyz/ultim8" className="underline">pocketry.xyz/ultim8</a>, or use
            <strong> Start or open a fixture</strong> above on a self-hosted copy. An existing fixture stays as saved.
            For other projects, the New Project prompt saves named work and asks whether to save,
            discard, or keep an unnamed draft. Reading this guide does not start a project.
          </p>
          <p>
            New fixtures start at <strong>100 × 60 mm</strong> with a <strong>5 mm body</strong> and
            4 mm locating pegs. In <strong>Fixture size</strong>, set width, length, and body thickness
            in millimeters. The footprint stays fixed when adding tools; change its dimensions or
            choose <strong>Fit fixture to contents</strong> to resize it.
          </p>
        </section>

        <section className="space-y-2" aria-labelledby="fixture-pockets">
          <h2 id="fixture-pockets" className="text-lg font-semibold">2. Add and position the objects</h2>
          <p>
            Use <strong>Trace</strong> for a calibrated photo outline, or <strong>Add pocket</strong> for
            a basic shape or closed SVG. Trace’s <strong>Add to Bin</strong> returns to the same fixture.
            Arrange pockets in Layout and set their depths. Choose <strong>Through</strong> for an
            upright opening when the work surface should support the object; keep a floor to set its
            height or carry it between work areas.
          </p>
          <p>
            Through openings remove intersecting pegs. Check the remaining peg positions and support
            in 3D. The ordinary Help guide covers calibration, outline editing, and fit checks.
          </p>
        </section>

        <section className="space-y-2" aria-labelledby="fixture-base">
          <h2 id="fixture-base" className="text-lg font-semibold">3. Choose the underside and check fit</h2>
          <p>
            Under <strong>Construction → Base &amp; mounting</strong>, the default
            <strong> Flat backing · pegs up</strong> attaches pegs directly to the body and starts with
            <strong> Corners only</strong> density. Other density choices add pegs at the mat’s hole positions.
            Default shafts are 4.8 mm in diameter and 4 mm long; adjust them after testing your mat.
          </p>
          <p>
            Flat backing exports pocket-side down, pegs up. Review bridges and overhangs above pockets
            in the slicer. <strong>Sloped roots</strong> and <strong>Short bridges</strong> instead print
            upright with pegs on the build plate and add height beneath the body. Short bridges requires
            a rectangular footprint. These base options do not guarantee support-free printing of
            every pocket or physical mat fit.
          </p>
        </section>

        <section className="space-y-2" aria-labelledby="fixture-export">
          <h2 id="fixture-export" className="text-lg font-semibold">4. Export the fixture and alignment artwork</h2>
          <p>
            Use <strong>Export → Save STL</strong> or <strong>Save 3MF</strong>, then
            <strong> Save alignment SVG</strong>. The SVG is the installed top view at 1:1 millimeter scale,
            independent of the pegs-up print orientation. It includes the body boundary, pocket openings,
            finger access, and blue circles for the retained pegs.
          </p>
          <p>
            Match the blue circles to your zero-point-calibrated mat template. Keep the artwork grouped
            and at <strong>100% scale</strong>. The SVG does not set an absolute printer bed position or
            calibrate your printing software. Regenerate it whenever the design or peg density changes.
            Choose your actual printer and slicing settings, then inspect the layers before printing.
          </p>
          <p>Use <strong>Project → Export project</strong> for an editable backup. Keep original Trace photos separately.</p>
        </section>

        <section className="space-y-2" aria-labelledby="fixture-convert">
          <h2 id="fixture-convert" className="text-lg font-semibold">Convert an existing bin</h2>
          <p>
            Enable <strong>App settings → Enable experimental features</strong>, then choose
            <strong> Construction → Base &amp; mounting → Bottom → Wham Bam Systems ULTIM8-compatible pegs</strong>.
            Review the proposed thickness, fill, rim, and color changes before choosing
            <strong> Use jig settings</strong>. <strong>Keep current settings</strong> changes only the bottom;
            Cancel leaves the design intact. Starting or opening a fixture does not require the
            experimental preference and does not enable unrelated experimental tools.
          </p>
        </section>

        <footer className="space-y-2 border-t pt-4 text-muted-foreground">
          <p><a className="underline" href="https://github.com/wcscr/pocketry/blob/main/docs/ultim8-peg-bottom.md" target="_blank" rel="noopener noreferrer">Detailed fixture geometry and limitations</a></p>
          <p>Pocketry is independent and is not affiliated with or endorsed by Wham Bam Systems. <Ultim8Link /> is a Wham Bam Systems trademark.</p>
        </footer>
      </article>
    </main>
  );
}
