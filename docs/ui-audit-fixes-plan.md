# Published UI audit fixes

Scope: fix findings 1–5 from the October 21 published UI audit. The highlighted Trace a Photo mode remains unchanged.

| Finding | Implementation and controls | Adversarial checks |
| --- | --- | --- |
| Draw loses depth | Carry validated dialog depth into the next canvas drawing; direct drawing keeps its existing default. | 5 mm survives placement; invalid depth cannot begin drawing; cancellation cannot leak depth into later tools. |
| Group member properties hidden | Show active group member geometry in both layouts, with explicit member scope; keep group transforms and ordinary multiselect batch controls. | Edit either member without ungrouping; mixed pocket/finger groups; linked copies still update; selection/history remain intact. |
| Rotate translates groups | Add a selection rotation handle and honor Rotate when dragging selected members, using existing fixed group pivot and gesture baseline. | Mouse/touch, multiple pointer moves, undo/redo, mixed groups, ordinary multiselection; preserve Move. |
| Linking changes names | Materialize current fallback display names before replacing linked geometry. | Different source names, explicit names, undo/redo, persistence and unlink. |
| Toasts block mobile navigation | Place mobile toasts above bottom tools and keep empty viewport space transparent to pointer input; make dismiss touch-friendly. | Narrow viewport, error/success toast, navigation remains usable, bottom tools and safe area remain clear. |

Verification: focused regressions, Node 22 type check, full local test suite, production build, diff check, and local browser checks. No hosted CI or production deployment.
