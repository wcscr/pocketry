# Photo-outline experiments

The work began with color segmentation and guarded, mask-seeded GrabCut, then
compared TEED edge guidance on tools photographed on white Pocketry sheets.
GrabCut helped remove some shadows but could not recover material absent from
its starting mask. TEED provided the stronger outer silhouettes across the
reviewed photos, at a higher CPU cost.

The implementation now combines automatic background choice, learned outlines
for suitable white-sheet regions, color/GrabCut fallback, conservative automatic
sensitivity, local rail/slit repair and automatic line/curve reconstruction.
Early single-photo results and intermediate curve prototypes are superseded by
the current comparison.

See [current behavior, limits and model provenance](teed-outline-integration.md)
and the [single-tool HTML report](../client/public/reports/outline-comparison/index.html).
Raw benchmarks and per-regression logs are retained locally rather than shipped
as repository documentation. Development evaluators in `scripts/` accept local
photo manifests; source photos are not required to run the application tests.
