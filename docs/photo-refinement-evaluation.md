# Photo-outline experiments

The work began with color segmentation and guarded, mask-seeded GrabCut, then
compared TEED edge guidance on tools photographed on white Pocketry sheets.
GrabCut helped remove some shadows but could not recover material absent from
its starting mask. TEED provided the stronger outer silhouettes across the
reviewed photos, at a higher CPU cost.

The implementation now combines automatic background choice, learned outlines
for suitable white-sheet regions, color/GrabCut fallback, conservative automatic
sensitivity, local rail/slit repair and automatic line/curve reconstruction.
The full comparison now tests removing color fusion from the combined research
policy. Raw and gap-repaired edge regions, finer sensitivity confirmation and
local feature checks remain identical. It uses the same 36 distinct white-sheet
subjects and automatic point cleanup on both sides, without per-photo tuning.
The previous experiment with color fusion is available as an extra comparison.
Rejected proposals retain the current result; the application imports neither
experimental policy.

The report distinguishes current defaults from experimental results, retains
the original detector as another optional comparison, and includes visual findings,
feature losses and fresh desktop timings. Sparse feature checks are not contour
ground truth; unseeded tips, reflective material and attached printing remain
limitations. Phone performance and physical fit are untested.

See [current behavior, limits and model provenance](teed-outline-integration.md)
and the [single-tool HTML report](../client/public/reports/outline-comparison/index.html).
Raw benchmarks and per-regression logs are retained locally rather than shipped
as repository documentation. Development evaluators in `scripts/` accept local
photo manifests; source photos are not required to run the application tests.
