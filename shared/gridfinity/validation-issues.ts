import type { ValidationIssue } from "./validate";

/** Combine fast layout checks with exact solid checks for display. Keep the
 * export-blocking solid error when both report a wall contact on one pocket.
 * Other pockets and distinct problems must retain their own messages. */
export function mergeValidationIssues(layout: readonly ValidationIssue[], solids: readonly ValidationIssue[]): ValidationIssue[] {
  const exactWallErrors = new Set(solids.flatMap(issue =>
    issue.code === "tilted-pocket-wall" && issue.severity === "error" ? issue.cutoutIds ?? [] : []));
  const issues = layout.filter(issue => !(issue.code === "wall-breach" && issue.cutoutIds?.length
    && issue.cutoutIds.every(id => exactWallErrors.has(id))));
  for (const issue of solids) {
    if (!issues.some(other => other.code === issue.code && other.message === issue.message && other.severity === issue.severity
      && JSON.stringify(other.cutoutIds) === JSON.stringify(issue.cutoutIds)
      && JSON.stringify(other.fingerHoleIds) === JSON.stringify(issue.fingerHoleIds)
      && JSON.stringify(other.surfaceTextIds) === JSON.stringify(issue.surfaceTextIds))) issues.push(issue);
  }
  return issues;
}
