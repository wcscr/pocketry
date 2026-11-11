# Photo-outline experiments

We compared color/GrabCut refinement, TEED edge guidance, automatic sensitivity,
and line/curve reconstruction on tools photographed on white Pocketry sheets.
GrabCut reduced some shadows but could not recover material absent from its
starting mask. TEED supplied the stronger outer silhouettes at a higher CPU cost.

The default now combines background-aware method selection, learned outlines,
color/GrabCut fallback, bounded automatic sensitivity, localized strip and
rail/slit repair, and automatic line/curve cleanup. The latest addition recovers
supported enclosed regions from crop-spanning printing and checks finer edge
thresholds for stable improvements. Color fusion was rejected: it introduced
shadows and filled real recesses. All photos use the same rules; no per-photo
threshold tuning or manually selected diagnostic results are substituted.

Across 36 distinct white-sheet subjects, the latest addition improved four,
produced two mixed results and left 30 unchanged versus the previous PR default.
All five earlier color-fusion regressions disappeared; its syringe improvement
was lost too. Reflective material, printing and transparent parts remain difficult.
An unseeded thin shaft remains a known failing synthetic case. Phone performance
and physical fit are untested.

See [current behavior, limits and model provenance](teed-outline-integration.md)
and the [single-tool HTML report](../client/public/reports/outline-comparison/index.html).
The report identifies the enabled default and offers the original pre-PR detector
and rejected fusion experiment as historical comparisons. Per-tool findings and
timings are included; detailed evaluation records remain local. Development
evaluators accept local photo manifests, which are not required for unit tests.
