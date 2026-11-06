import { expect } from "vitest";
import type { buildBinWithCutouts } from "./bin";
import { SURFACE_TEXT_ISSUE_CODES } from "./surface-text";

/**
 * Misplaced labels are reported as error issues and left out of the model;
 * the bin itself must still build. Returns the joined label messages.
 */
export function surfaceTextIssueText(result: ReturnType<typeof buildBinWithCutouts>): string {
  expect(result.solid.status()).toBe("NoError");
  const issues = result.validationIssues.filter(issue => SURFACE_TEXT_ISSUE_CODES.has(issue.code));
  for (const issue of issues) {
    expect(issue.severity).toBe("error");
    expect(issue.surfaceTextIds?.length).toBeGreaterThan(0);
  }
  return issues.map(issue => issue.message).join("\n");
}

/** Every label must build: the regression guard for tests that used to rely on a thrown error. */
export function expectAllSurfaceTextBuilt(result: ReturnType<typeof buildBinWithCutouts>, expected: number): void {
  expect(surfaceTextIssueText(result)).toBe("");
  expect(result.textParts).toHaveLength(expected);
}
