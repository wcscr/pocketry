import { expect, it } from "vitest";
import { issueSettingsTarget } from "./issue-settings";

it("directs clipped tabs to recess while keeping placement problems at the style controls", () => {
  expect(issueSettingsTarget("label-tab-clipped")).toEqual({
    id: "bin-settings-construction", label: "Edit label tab", focusId: "bin-label-tab-recess",
  });
  for (const code of ["label-tab-edge-missing", "label-tab-shadow"]) {
    expect(issueSettingsTarget(code)).toEqual({
      id: "bin-settings-construction", label: "Edit label tab", focusId: "bin-label-tab",
    });
  }
});

it("retains direct setting destinations and leaves object issues to the object editor", () => {
  expect(issueSettingsTarget("cutouts-require-solid-fill")?.focusId).toBe("bin-solid-fill");
  expect(issueSettingsTarget("fractional-grid-holes")?.focusId).toBe("bin-grid-pitch");
  expect(issueSettingsTarget("floor-color-on-underside")?.focusId).toBe("input-pocket-floor-thickness");
  expect(issueSettingsTarget("out-of-bounds")).toBeNull();
  expect(issueSettingsTarget("unknown-issue")).toBeNull();
});
