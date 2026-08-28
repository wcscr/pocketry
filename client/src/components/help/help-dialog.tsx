import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { downloadCalibrationTemplate } from "@/lib/calibrate/download-template";

export interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** A keyboard shortcut, rendered as a key cap. */
function Key({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">
      {children}
    </kbd>
  );
}

/**
 * The how-to, moved out of the page body into a dialog.
 *
 * It used to be a ~100-line collapsible card stacked above the canvas, making
 * it the second-largest consumer of vertical space in the app even when
 * collapsed.
 */
export function HelpDialog({ open, onOpenChange }: HelpDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How to use Pocketry</DialogTitle>
          <DialogDescription>
            Trace tools from photos, arrange their cutouts, and export a
            print-ready bin or a lightweight checking file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          <section>
            <h3 className="mb-1.5 font-medium">1. Trace a tool</h3>
            <ol className="list-decimal space-y-1 pl-6 text-muted-foreground">
              <li>
                Drop a PNG or JPEG onto the workspace, or click the empty
                workspace to choose one. A plain, contrasting background gives
                the cleanest outline.
              </li>
              <li>
                Pocketry automatically looks for the current v2 calibration-sheet
                signature when the image loads. Its custom marker dictionary is
                separate from stock ArUco sheets, and all four paper-specific
                markers are required. Pocketry validates their 16 corners before
                proposing scale or perspective correction. Check the preview, then
                accept it.
                If you do not have a sheet yet, download and print the{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-2 hover:no-underline"
                  onClick={() => downloadCalibrationTemplate("a4")}
                  data-testid="help-print-template-a4"
                >
                  A4 PDF template
                </button>{" "}
                or{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-2 hover:no-underline"
                  onClick={() => downloadCalibrationTemplate("letter")}
                  data-testid="help-print-template-letter"
                >
                  US Letter PDF template
                </button>{" "}
                at 100% scale.
              </li>
              <li>
                If automatic scale detection is unavailable or not sufficiently
                accurate, place a ruler or another item with a precisely known
                dimension beside the tool, in the same plane. Choose Set scale,
                mark its two endpoints, and enter that known length.
              </li>
              <li>
                Use <strong>Set Detection Region</strong> to draw a close box
                around the tool. Pocketry does not detect or display a contour
                until this region is set, keeping the calibration sheet and
                surroundings out of the result.
              </li>
              <li>
                Tune <strong>Tool Detection</strong>: Sensitivity changes what is
                admitted as tool, Detail controls point density, and Smoothing
                removes pixel noise.
              </li>
              <li>
                Choose a physical <strong>Margin</strong> from 0.5–5.0 mm, then
                edit, add, move, or remove contour points as needed.
              </li>
              <li>
                Choose <strong>Add to bin</strong> to place the scaled contour in
                the Bin workspace. Trace exports remain available for standalone
                SVG, DXF, DWG, or STL files.
              </li>
            </ol>
          </section>

          <section>
            <h3 className="mb-1.5 font-medium">2. Design the bin</h3>
            <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
              <li>
                Set the bin Width, Length, and Height, then choose construction
                options such as stacking lip, base, magnets, screws, and labels.
              </li>
              <li>
                Open <strong>Tool Cutout Settings</strong> and select a cutout to
                set depth, extra clearance, corner rounds, bottom fillet, and
                straight or scoop finger holes. Extra clearance is added after
                the Margin chosen on Trace.
              </li>
              <li>
                Click a selected tool's name to rename it. Use Layout to move,
                rotate, or edit its contour; the ruler snaps to tool contours
                and is most accurate in the 2D Layout view.
              </li>
              <li>
                <strong>Fit bin to contents</strong> can shrink or grow the bin
                around the current tools and trim unused grid cells. Use
                <strong> Edit footprint</strong> in Layout to add or remove cells
                manually; the footprint must remain one connected piece without holes.
                Removing a tool offers the same fitting choice.
              </li>
              <li>
                Label tabs can attach to any highlighted straight footprint edge.
                A shaped stacking lip is intended to mate with the same footprint;
                it is not a separate lip around every occupied cell.
              </li>
              <li>
                View Settings controls preview and 3MF colors for the bin body,
                pocket floors, and stacking-rim top. Color layers extend down
                from their original surfaces.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="mb-1.5 font-medium">3. Save and resume projects</h3>
            <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
              <li>
                <strong>Save project</strong> stores a named project in the
                browser's project library for quick resume.
              </li>
              <li>
                <strong>Open project</strong> resumes a saved design; portable
                project files can also be exported and imported with a chosen
                filename and location.
              </li>
              <li>
                <strong>New project</strong> clears the active design after
                confirmation. An unsaved working draft is retained while you
                switch between Trace and Bin.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="mb-1.5 font-medium">4. Check and export</h3>
            <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-foreground">
              <strong>Before printing the full bin:</strong> double-check the
              final dimensions in the 2D Layout view, and print either a thin
              Tool fit template or a Preview/shadow-board layout. A quick,
              inexpensive check can catch scale or fit errors before a long
              bin print.
            </div>
            <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
              <li>
                <strong>3MF</strong> is the recommended final format and can
                preserve selected material colors. Choose single-color or
                multicolor when saving.
              </li>
              <li>
                <strong>STL</strong> exports the complete geometry but cannot
                preserve colors; Pocketry warns before a colored design is saved
                this way.
              </li>
              <li>
                A selected cutout can be exported as a thin, filled fit-template
                STL for an inexpensive physical fit check.
              </li>
              <li>
                Shadow-board Layout DXF and SVG exports contain the bin footprint
                and tool silhouettes in millimetres for CNC or laser work.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="mb-1.5 font-medium">5. Navigate and undo</h3>
            <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
              <li>
                Hold <Key>Shift</Key> and drag to pan — a plain drag never
                moves the view, so clicks are free for editing
              </li>
              <li>
                Middle-button drag and <Key>Space</Key> + drag also pan
              </li>
              <li>Scroll to pan; <Key>Shift</Key> + scroll to pan sideways</li>
              <li>
                <Key>Ctrl</Key> / <Key>⌘</Key> + scroll to zoom at the pointer
                (trackpad pinch works too)
              </li>
              <li>
                <Key>0</Key> fits the image, <Key>1</Key> returns to 100%
              </li>
              <li>
                <Key>Ctrl</Key>/<Key>⌘</Key> + <Key>Z</Key> undoes,{" "}
                <Key>Shift</Key> + that redoes
              </li>
              <li>
                The history menu beside Undo/Redo names each step, including
                contour-node additions, removals, and moves.
              </li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
