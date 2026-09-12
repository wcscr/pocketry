# Grid pitch

Full, half, and quarter pitch select 42, 21, and 10.5 mm grid cells. Changing
pitch preserves the bin's physical dimensions, its custom outline, and all
pocket and split positions. Label tabs stay on the same boundary run.

For a custom footprint, a finer pitch subdivides each occupied cell. A coarser
pitch is available only when the smaller cells form complete larger cells.
Otherwise its option says **would change shape**; the existing outline is kept.
The current pitch always remains available.

Pitch changes support undo and save in the usual project format. Magnet and
screw holes remain available only on full pitch, following the existing rule.
