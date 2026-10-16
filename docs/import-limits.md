# Import limits

Pocketry checks backup size before reading JSON and checks structure before schema
migration or geometry processing. These limits also apply to direct project parsing,
including browser recovery; an unreadable saved document is retained for recovery.
Library import validates the complete backup before writing any designs.

| Limit | Project | Library backup |
| --- | --- | --- |
| File size | 64 MiB | 128 MiB |
| Designs | 1 | 500 |
| Stored coordinate points | 100,000 | 500,000 total |
| Points across repeated shape placements and sampled font glyphs | 1,000,000 | 5,000,000 total |
| Visited values | 400,000 | 2,000,000 total |
| Unique string characters and property names | 64 Mi | 128 Mi total |
| Font outline characters across all occurrences | 16,000,000 | 64,000,000 total |

Each project also allows at most 64 nesting levels, 50 undo entries,
512 shapes/pockets/finger holes/interior holes per collection, and 10,000 entries
per other array (including points per ring and custom footprint cells). Existing
schema limits can be stricter. Geometry includes undo history and transform sources;
claimed point counts in the file are not trusted. Repeated label characters count
each glyph again, with 12 samples per quadratic/cubic segment. Portable font source strings
are counted once, so repeated references do not multiply their storage budget.

If a backup exceeds a limit, split the library or simplify the design in the version
that created it. Keep the original backup. Pocketry never silently trims imported
geometry or partially imports an over-limit library.

Trace accepts still PNG, JPEG and WebP up to 10 MiB, 50 megapixels and 16,384 pixels
per side. Header checks happen before browser decoding, including both current and
original photos restored from a saved Trace draft. Recovery keeps the existing
60-million-character data-URL allowance because perspective correction generates
PNG files that can exceed the original upload byte limit. The same pixel and side
limits still apply before decoding. Animated PNG/WebP, deferred-height
JPEG, malformed headers and conflicting WebP frame dimensions are rejected. Resize
large photos before importing. These input limits do not change the existing 800×600
working coordinate system or calibrated exports.
