# Tilted pockets

These tools are experimental and hidden by default. Open **Settings** in the
header (on mobile, **More options → Settings**) and turn on **Enable experimental
features**. The setting exposes X/Y tilt, the 3D move/rotate widget,
multi-selection, alignment/distribution, and linked designs. It persists in this
browser and is independent of project files; importing a project never enables
it automatically. If browser storage is blocked, it applies for the current tab.

Turning it off cancels an unfinished group drag and returns to single selection.
It does not remove tilt, break links, rewrite history, or alter exports. Projects
that already use these features show a notice with a shortcut to settings.
Existing linked designs still propagate ordinary size/depth edits to their
copies; enable the tools to manage or remove those links.

Select a pocket and open **Position & rotation**. X and Y tilt turn its depth
axis; the existing Z rotation sets its heading in the bin. **Reset tilt** returns
the pocket upright while keeping its heading. Each placement has its own angles,
including copied pockets, and changes survive undo, redo, saving and import.

Tilt is useful for storing tall objects in a drawer with less vertical space.
The object slides in and out along the tilted axis. The horizontal opening grows
with tilt so that this path stays clear. The outline dimensions still describe
the object's cross-section perpendicular to that axis. For example, a 3 mm wide
rectangular slot tilted 45 degrees has a nominal 4.24 mm wide top opening.

- Fixed depth is measured **along the pocket axis**, from the bin's fill surface
  at the placement centre to the seat centre.
- Remaining floor sets the **lowest point** of the sloped seat above the bin's
  underside. Positive fit clearance is included conservatively.
- Through depth continues along the tilted axis through the base.
- Split regions keep their own depths and share the same orientation.
- Bottom rounds and floor material layers follow the seat; top rounds are added
  at the actual horizontal opening. Finger access stays in the bin's frame.

The depth summary shows axial depth, actual vertical depth, lowest floor and
combined axis tilt. The 2D layout shows the nominal top opening; the selected
pocket also shows a dashed conservative envelope of its shaft. The 3D view
shows the selected opening and seat as a wireframe. Fit and arrange account for the shaft as
well as the opening. They can leave extra space around complicated outlines.

Preview and printable export check actual pocket solids for hidden pocket
intersections and cuts into walls, label tabs and stacking rims. Export rechecks
the current design. Shafts with less than 1.2 mm of material between them or
beside a wall produce a warning. A floor that crosses the opening, or a combined axis too
close to horizontal, must be corrected. These checks do not model the complete
stored object, attached cables or the space above the bin.

SVG/DXF layout exports describe nominal horizontal top openings, without fit
clearance or rounding. They cannot encode tilted depth. A surface fit template
is a thin section of the actual cavity and checks that section only; print a
small bin with the full slot depth to assess insertion and retention.

## Move and rotate in 3D

Click an opening or use the checkboxes in the object list. **Move (W)**
shows red X, green Y and blue Z arrows. X/Y move the opening across the surface;
Z changes depth beneath it. Plane handles combine their named axes.
**Rotate (E)** shows only X/Y/Z axis rings. All handles stay aligned with the
bin's fixed XYZ coordinate system, even when the pocket is tilted. There is
no local-axis mode or free/view-plane rotation target.

The floating object panel contains **Move**, **Rotate**, and **Arrange** tools.
Numeric XYZ fields apply relative millimetres or degrees in one undo step.
Solid axis lines and labeled grips identify the fixed bin axes.

Use Shift, Command, or Control + click to add/remove pockets and thumb-access
features from a selection; checkboxes work without a keyboard. Command/Control+A
selects all objects when a text field or dialog does not own the shortcut.
Selection carries between 3D and Layout. Each group drag or command is one undo
step and changes only selected objects. In Layout, drag any selected body to move
the group; arrows nudge it (Shift = 10 mm), R rotates 15 degrees (Shift reverses).
Escape, blur, and pointer cancellation discard incomplete drags.

Group rotation defaults to **Each object's center**. **Selection center** also
rotates their positions around the shared bounding-box center. Rotated pocket
origins project back to the top surface, retaining the rigidly rotated seats.
If any member reaches a floor or tilt limit, the entire group retains the last
valid rotation. Z movement uses the most restrictive depth limit of all selected
objects, so their relative floor depths remain unchanged. Through pockets have
no floor to move. Thumb access remains upright: mixed selections support XYZ
movement/depth changes and Z rotation; select only pockets to enable X/Y tilt.

**Arrange** aligns nominal opening bounds on X or Y: minimum edge, center, or
maximum edge. Choose the selection bounds or the last selected object as the
reference. Rotated, tilted, and mirrored openings use their transformed outline.
**Equal centers** and **Equal gaps** require at least three objects and leave the
two outer objects fixed. Equal gaps is unavailable when the objects cannot fit
between those endpoints without overlap. Clearance/rounding and collisions still
use the normal layout warnings; arrangement never auto-resizes the bin.

The **magnet** toggles 1 mm move increments and 5° rotation increments. Its
tooltip describes the increments and whether snapping is on or off. For combined rotations, the displayed Euler
angles may differ from the snapped rotation about a fixed bin axis.

Each drag previews the opening and seat immediately, rebuilds the solid on
release, and adds one undo step. **Escape** cancels the active drag. Camera
orbit is suspended while dragging a handle; drag empty space to orbit normally.
The ruler temporarily hides the transform handles. Keyboard shortcuts leave
text and number fields alone.

Pulling Z up makes the pocket shallower; pulling down makes it deeper. Both
the opening and the handles stay at the bin surface throughout the drag.
Fixed axial depth or remaining-floor thickness updates directly, with the
same vertical depth change applied to both split seats. Movement stops with
at least 0.5 mm below the surface above the highest seat, and before the lowest
seat passes the underside. A through pocket has no floor to adjust. Its Z
drag has no effect. Use the existing Depth fields for exact dimensions.

Older saved Z offsets remain readable. On editing, the offset is converted to
an equivalent surface position and depth, preserving the existing cavity.
New drags never store an above-surface pocket position.

A gizmo rotation keeps the seat geometry rigid around the anchor. Remaining-floor
settings convert to equivalent fixed axial depths at the start of a completed
rotation, including both seats in a split pocket. Numeric tilt controls continue
to honor remaining-floor mode. The drag retains its last valid orientation if
either seat would come within 0.5 mm of the surface or pass the underside.
This prevents the floor and opening from crossing into an inverted preview or
a failed solid build. Adjust depth or bin height if more tilt is needed.
Angles retain full precision internally. Depth limits tolerate only numerical
roundoff at the underside, and remaining-floor values clamp to zero so limit
drags remain valid in saved projects and their undo history.
The depth readout measures the selected split section, and switching between
fixed depth and remaining-floor depth uses that section's tilted axis and floor.
Check the resulting floor, wall and intersection
warnings after rotating or lowering a pocket. Undo restores both orientation
and the original depth mode.

## Implementation

The shared transform is `Rz * Ry * Rx`, applied after outline scaling and mirroring.
The oblique section at the fill surface is used consistently for placement,
selection, resizing and contour edits. The geometry kernel constructs the shaft,
seats and floor bands in the pocket frame, then rotates them into the bin frame.
Legacy placements without tilt or Z translation use the existing geometry path.
Project schema 20 added optional `tilt: { xDeg, yDeg }`; schema 21 adds optional
`zOffsetMm`, including history snapshots. Older saves migrate without introducing
angles or offsets. Each input axis is limited to ±89 degrees, and the combined
axis must retain a vertical component of at least 0.01.

Regression coverage includes oblique opening dimensions, axial and remaining
floor depths, combined transforms, resize anchors, split seats, floor colors,
hidden intersections, through cuts, packing, legacy saves and export validation.

## Linked designs

**Duplicate linked** creates another instance of the selected pocket or thumb
slot. Ordinary pocket duplication remains independent. To link existing objects,
select two or more pockets (or two or more thumb slots), open their properties,
and choose **Link selected…**. Choose the source design before applying it. Only
selected objects join the new set; unselected members of previous sets retain
their links and designs. Pockets and thumb slots use separate design sets.

Linked pockets share their outline, dimensions, aspect-ratio preference, depth,
split settings, fit clearance, and edge rounding. Names, positions, mirroring,
and orientation remain independent. **Link X/Y tilt** optionally shares tilt;
Z heading always remains independent. Enabling it adopts the active pocket's
tilt for the set. Thumb slots share opening shape, width, length, depth and edge
settings while keeping their positions, headings and names independent.

The properties panel displays the linked member count. **Select linked** selects
that set. **Make independent** (or **Make selected independent**) removes links
without changing geometry. There is no master instance: deleting the original
does not delete or disconnect the remaining copies. Every link, unlink, linked
edit and linked duplication is one undo step, including changes to unselected
copies. Links survive project/library export, import and saved undo/redo history.

Movement across the surface stays independent. Z movement edits shared depth,
so it changes all linked copies' depths. A group transform that gives linked
members contradictory shared settings is rejected as a whole. Edit one member,
use each-object rotation, or make copies independent when distinct designs are
needed. Transform previews check affected unselected seats too. Normal layout
and solid-build checks still report overlaps and wall conflicts after design
changes. Linked thumb dimensions clamp to a size compatible with all members'
headings when the bin or opening is resized.

Project format 22 reconciles the two historical version-20 variants (adjustable
fill height and pocket tilt) and legacy version-21 offsets. Format 23 adds explicit
linked-design membership. Each saved snapshot validates consistent design values
within a linked set. Existing duplicates are never linked implicitly just because
they reference the same outline.
