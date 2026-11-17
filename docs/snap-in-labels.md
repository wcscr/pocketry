# Snap-in labels

The retaining profile adapts [Cullenect Labels v2](https://github.com/CullenJWebb/Cullenect-Labels)
by Cullen J Webb under the MIT license. The pinned source revision, copyright
notice, and full license text are in [NOTICE](../NOTICE).

Pocketry can cut retaining sockets into label tabs and export the bin and
separate, flat-on-bed labels as 3MF objects. The latch is 11 mm tall and its
width and total socket clearance are editable. Changing either affects fit.
The 2 × 3 metric-bin PLA test retained Pocketry-native labels at 0.20, 0.25, and 0.30 mm
total clearance; the reported fit varies by position and material, so these
numbers are test results rather than a universal setting.

An **expanded face** sits on top of the latch, without changing its profile or
socket. In Auto mode Pocketry intersects the tab shelf with its writing area,
then insets that outline by the chosen edge margin. Each label follows its
assigned tab, including edits to bin and compartment dimensions or irregular
boundaries. Manual mode uses the entered width and height and blocks export if
the face does not fit that tab. Face thickness and text size are independent
controls. Pocketry also checks text fit, a single connected label solid, and
seated collision with the bin before export. Labels in older saved projects
without an expanded face retain their earlier geometry.

The tab **Recess** control is independent. Set it to 0 mm for a shelf at the
wall or divider top. An expanded label face rests on that shelf and therefore
projects above it by its chosen thickness. A recess equal to the face thickness
puts the face top level with the surrounding wall, where geometry permits.
The raised text projects another 0.4 mm above the face.

Auto sizing and collision validation describe printable geometry, not a physical
fit guarantee for a new material, nozzle, orientation, or tab design. Confirm
the expanded face does not catch when removing a sample label before applying
it to a complete bin set.
