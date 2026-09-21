import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CalibrationDownloads } from "@/components/trace/calibration-downloads";

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
          <section aria-label="Feedback">
            <p className="text-muted-foreground">Found a problem or have a suggestion? We welcome feedback, especially while the mobile interface is in early development.</p>
            <div className="flex flex-wrap gap-x-5">
              <a className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href="mailto:pocketry@sugarcreekresearch.com">Email feedback</a>
              <a className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href="https://github.com/wcscr/pocketry/issues/new" target="_blank" rel="noopener noreferrer">Report an issue on GitHub<span className="sr-only"> (opens a new tab)</span></a>
            </div>
          </section>
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
                When paper and a measurement aid are both detected, choose
                {" "}<strong>Correct perspective &amp; use aid scale</strong> on
                desktop or mobile. Other choices and <strong>Detect references
                again</strong> are under Scale’s <strong>Advanced</strong> section.
                <CalibrationDownloads />
              </li>
              <li>
                Choose <strong>Correct perspective only</strong> to straighten
                the photo and then set scale manually from a measured feature
                of the tool. The paper's scale is not accepted by this option.
              </li>
              <li>
                If automatic scale detection is unavailable or not sufficiently
                accurate, place a ruler or another item with a precisely known
                dimension beside the tool, in the same plane. Choose Set scale,
                mark its two endpoints, and enter that known length.
              </li>
              <li>
                Use <strong>Region</strong> to draw a close box
                around the tool. Pocketry does not detect or display a contour
                until this region is set, keeping the calibration sheet and
                surroundings out of the result.
              </li>
              <li>
                Tune <strong>Outline</strong>: Sensitivity changes what is
                admitted as tool. Higher Simplification values use fewer points
                and may omit small features.
                Outside silhouettes are the default; enable interior
                holes only for real openings. Sensitivity updates the outline when you
                release the slider. Confirmation is needed only when replacing manual
                contour edits. Simplification preserves those edits; re-detection is undoable.
              </li>
              <li>
                Choose a physical <strong>Margin</strong> from 0.0–5.0 mm, then
                edit, add, move, or remove contour points as needed.
                On a phone, <strong>Edit contours</strong> frames the outline. Drag a point
                to move it, tap the line to add one, or tap a point and choose
                <strong> Delete point</strong>. Drag elsewhere to pan and pinch to zoom. Holding a point shows a
                magnified view. On desktop, click a point to select it and reveal
                <strong> Delete point</strong>; left-drag moves it, left-click adds,
                and right-click removes. In Trace and Bin, the detail view stays in a
                fixed corner while you drag. Undo restores an edit.
              </li>
              <li>
                Choose <strong>Add to bin</strong> to place the scaled contour in
                the Bin workspace. Name each tool, choose separate pockets for multiple
                objects, or add and trace another photo. Trace exports remain available for standalone
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
                Type exact dimensions beside the sliders. Pitch changes preserve size;
                Keep bin size fixed prevents new tools from enlarging the bin.
              </li>
              <li>
                Click a pocket in <strong>Layout</strong> or choose it in
                <strong> Pockets</strong> to open its properties in that section.
                On a phone, tapping a pocket opens a small adjustment tray;
                <strong> More settings</strong> opens all its properties.
                Set depth first; expand <strong>Size &amp; scale</strong> for dimensions. Expand <strong>Edges &amp; corners</strong>
                to soften the outline or pocket edges, or <strong>Extra pocket clearance</strong>
                to add more room around the tool.
                Extra clearance is added after the Margin chosen on Trace.
                Use <strong>Finger access</strong> for straight openings or scoops.
                <strong> Add</strong> starts a slot with a curved bottom and rounded ends.
                Its bottom starts 1 mm above the highest pocket floor, including split
                sections. Without a pocket floor, depth starts at 12 mm, within the
                bin’s limits. Depth remains editable, with a 1 mm minimum.
                Warnings appear at the bottom right of the canvas; click a message
                to open the affected pocket or settings.
              </li>
              <li>
                Click the pencil on a pocket’s row to rename it. Use Layout to move,
                rotate, or edit its contour; the ruler snaps to tool contours
                and is most accurate in the 2D Layout view.
              </li>
              <li>
                <strong>Fit bin to contents</strong> shrinks or grows a rectangular
                bin around the current tools. Use <strong>Edit footprint</strong> in
                Layout only when you intentionally want an irregular bin; custom
                footprints must remain one connected piece without holes. Removing a
                tool offers the same rectangular fitting choice.
              </li>
              <li>
                Label tabs can attach to any highlighted straight footprint edge.
                A shaped stacking lip is intended to mate with the same footprint;
                it is not a separate lip around every occupied cell.
              </li>
              <li>
                <strong>Layout → Add pocket</strong> draws a rectangle, square, or
                circle without a photo. Drag between opposite corners, or from a
                circle's centre to its edge. Release to add; Escape or Cancel discards
                the draft. Set exact dimensions under <strong>Pockets → Size &amp; scale</strong>.
                These use the usual pocket depth, rounding, duplication, and floor colors.
                The bin stays the same size; boundary warnings still apply.
              </li>
              <li>
                Materials controls preview and 3MF colors for the bin body,
                pocket floors, and stacking-rim top. Color layers extend down
                from their original surfaces. View contains preview-only cutaway controls.
                Inspect this pocket in 3D cuts through the selected pocket.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="mb-1.5 font-medium">3. Save and resume projects</h3>
            <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
              <li>
                Double-click the current project title to name a new draft or
                rename a saved project. The save icon (<strong>Save to library</strong>)
                stores a draft as a named project; the pencil renames a saved project.
              </li>
              <li>
                In <strong>Browser library → Manage</strong>, open a saved project
                with Open, a double-click, or Enter. Rename with the pencil, create
                an independent duplicate with Copy, or remove a saved project
                after confirmation. The currently open project cannot be removed;
                open another project or start a new one first.
                If your current draft has work that is not saved in the library,
                opening another saved project or a project file asks before replacing it.
                Choose Keep working to save or export the draft first.
                In <strong>Project</strong>, next to <strong>New project</strong>, use
                {" "}<strong>Export project</strong> or <strong>Open project</strong>
                {" "}for one editable design. Opening a project file adds it to this
                browser’s library and selects it as the current project. If its name
                already exists, the imported copy gets an “imported” suffix.
              </li>
              <li>
                In <strong>Project → Browser library → Manage</strong>, use <strong>Export library</strong>
                {" "}to back up every named design in one JSON file, or <strong>Import library</strong>
                {" "}to add designs from a backup. Supported older designs upgrade automatically.
                Duplicate names get an “imported” suffix; existing designs and the open draft
                stay intact. Save an unnamed draft to the library before exporting it.
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
              final dimensions in the 2D Layout view, then print the thin
              Surface fit test when checking a multi-tool layout, or
              use the Preview/shadow-board layout for a flat dimensional
              review. A quick, inexpensive check can catch scale, spacing, or
              fit errors before a long bin print.
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
                Bin model, fit-test, and layout exports ask whether to also download
                an editable <strong>.pocketry.json</strong> project. This checkbox
                starts unchecked. When selected, the files share the project name
                (when saved), bin size, and local date/time. Allow multiple
                downloads if your browser asks, and keep the JSON to restore
                the design later with Open project.
              </li>
              <li>
                Trace exports offer the same optional JSON download once the outline
                is calibrated. Open that project in Bin to edit the exported outline
                as a pocket at its original physical size.
              </li>
              <li>
                Under <strong>Check fit</strong>, Surface fit test offers the
                <strong> Full surface</strong> or <strong>Tool outlines · 5 mm</strong>,
                defaulting to tool outlines at 0.8 mm thickness.
                Tool outlines keep a 5 mm material band around each tool opening,
                without the bin perimeter or separate finger access features.
                Widely spaced tools print as separate pieces. Thickness sets the printed height
                for either option. Both omit the base, walls, label tab, and
                stacking lip. Use the full surface to check relative pocket
                spacing; neither option tests pocket depth or Gridfinity baseplate fit.
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
