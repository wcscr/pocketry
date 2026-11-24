# Shadow inlays

Open **Export → Export shadow inlay**, choose a pocket, and save its STL.
Print it in a contrasting color at 100% scale and place it on the pocket floor.
This provides a separate color insert without an AMS or another multicolor
printing system. Surface fit tests remain under **Check fit**.

The default thickness is 0.6 mm. It occupies that much of the available tool
depth; allow for it when choosing the pocket depth. **Edge gap** defaults to
0.2 mm on each side, independently of the pocket's tool clearance. Adjust the
gap for the printer, filament, and desired fit.

The inlay retains the pocket's scale, mirroring, signed clearance, corner
rounding, and interior islands. Its lower edge follows the same bottom-fillet
profile as the pocket, with the radius limited by the pocket depth rather than
the inlay thickness. Position and Z rotation are omitted so the part prints
flat on the build plate. Finger access and the pocket's top-edge flare do not
enlarge the insert.

Inlays currently require a solid bin and an untilted pocket with a single
supporting floor. Through cuts, kept holes, split floors, and tilted/profile
pockets show an explanation instead of exporting an insert with an unsuitable
seat. Inspect the slicer's layer preview; geometry tests do not establish
physical printer/material fit.

## Existing feature history

This is the renamed and relocated **Tool fit template → Save fit template STL**
export, rather than a newly introduced silhouette-export feature. It is present
in the current repository's
[August 26, 2026 Pocketry snapshot](https://github.com/wcscr/pocketry/commit/91aa2deb5bbd55193a5a971a3e924ed8a9c8ed05):
[original Pocketry controls](https://github.com/wcscr/pocketry/blob/91aa2deb5bbd55193a5a971a3e924ed8a9c8ed05/client/src/components/gridfinity/bin-controls-panel.tsx)
and [original Pocketry builder](https://github.com/wcscr/pocketry/blob/91aa2deb5bbd55193a5a971a3e924ed8a9c8ed05/client/src/lib/gridfinity/fit-check.ts).
The locally retained ToolTrace predecessor history dates the implementation to
[9bd14b7f, August 25, 2026](https://github.com/wcscr/tooltrace/commit/9bd14b7f00e34da517e508cd20fc697ad1ea0322).
That predecessor commit belongs to ToolTrace, rather than Pocketry's current
history. Dates here use America/New_York.

The current change exposes that existing export in the main workflow and adds
the floor-fit adjustments needed for its use as a separate inlay: bottom
rounding, assembly clearance, preserved islands, and seat checks.
