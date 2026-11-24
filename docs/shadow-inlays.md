# Shadow inlays

Open **Export → Export shadow inlay**, choose a pocket, and save its STL.
Print it in a contrasting color at 100% scale and place it on the pocket floor.
This provides a separate color insert without an AMS or another multicolor
printing system. **Check fit** also offers the original **Tool fit template**
for the selected tool silhouette and the surface fit tests for the bin layout.

The default thickness is 0.6 mm. It occupies that much of the available tool
depth; allow for it when choosing the pocket depth. **Edge gap** defaults to
0.2 mm on each side, independently of the pocket's tool clearance. Adjust the
gap for the printer, filament, and desired fit.

The inlay retains the pocket's scale, mirroring, signed clearance, corner
rounding, and interior islands, including separate kept holes. Its lower edge
follows the same bottom-fillet profile as the pocket. The pocket depth limits
the fillet radius. Position and Z rotation are omitted so the part prints flat
on the build plate. Finger access and the pocket's top-edge flare do not
enlarge the insert.

Inlays currently require a solid bin and an untilted pocket with a single
supporting floor and an opening large enough to lower the insert into place.
Through cuts, kept-hole selections, split floors, tilted pockets, and buried
cavities show an explanation when an inlay cannot be installed. Export checks
the opening after all bin cuts and tests whether each printed piece can rest
on the remaining floor without tipping. A piece can bridge an opening if the
surrounding floor supports it.
Inspect the slicer's layer preview and test the fit on your printer and material.

## Existing feature history

Shadow inlay export extends the original **Tool fit template → Save fit template STL**
with geometry that seats in the finished pocket. The original export is present
in the current repository's
[August 26, 2026 Pocketry snapshot](https://github.com/wcscr/pocketry/commit/91aa2deb5bbd55193a5a971a3e924ed8a9c8ed05):
[original Pocketry controls](https://github.com/wcscr/pocketry/blob/91aa2deb5bbd55193a5a971a3e924ed8a9c8ed05/client/src/components/gridfinity/bin-controls-panel.tsx)
and [original Pocketry builder](https://github.com/wcscr/pocketry/blob/91aa2deb5bbd55193a5a971a3e924ed8a9c8ed05/client/src/lib/gridfinity/fit-check.ts).
The locally retained ToolTrace predecessor history dates the implementation to
[9bd14b7f, August 25, 2026](https://github.com/wcscr/tooltrace/commit/9bd14b7f00e34da517e508cd20fc697ad1ea0322).
That predecessor commit belongs to ToolTrace, rather than Pocketry's current
history. Dates here use America/New_York.

The main export workflow adds bottom rounding, assembly clearance, preserved
islands, and seat checks for the separate inlay.
