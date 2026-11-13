import { expect, it } from "vitest";
import type { ValidationIssue } from "./validate";
import { mergeValidationIssues } from "./validation-issues";

const wall: ValidationIssue = { code: "wall-breach", severity: "warning", cutoutIds: ["a"], message: "Cuts into the wall" };
const exact: ValidationIssue = { code: "tilted-pocket-wall", severity: "error", cutoutIds: ["a"], message: "Pocket at this height cuts into a wall" };

it("replaces a duplicate wall warning with the exact export-blocking error", () => {
  const otherPocket = { ...wall, cutoutIds: ["b"] };
  const floor = { ...exact, code: "too-deep", message: "Raise the pocket" };
  expect(mergeValidationIssues([wall, otherPocket, floor], [exact])).toEqual([otherPocket, floor, exact]);
  expect(wall.severity).toBe("warning");
});

it("keeps the layout check while solid validation is pending or reports only a warning", () => {
  expect(mergeValidationIssues([wall], [])).toEqual([wall]);
  const warning = { ...exact, severity: "warning" as const };
  expect(mergeValidationIssues([wall], [warning])).toEqual([wall, warning]);
  expect(mergeValidationIssues([{ ...wall, cutoutIds: ["a", "b"] }], [exact])).toHaveLength(2);
});

it("deduplicates identical issues while keeping separate labels and finger accesses", () => {
  const issue: ValidationIssue = { code: "placement", severity: "error", message: "Invalid", fingerHoleIds: ["one"] };
  const second = { ...issue, fingerHoleIds: ["two"] };
  const label = { ...issue, surfaceTextIds: ["label"] };
  expect(mergeValidationIssues([issue], [issue, second, label])).toEqual([issue, second, label]);
});
