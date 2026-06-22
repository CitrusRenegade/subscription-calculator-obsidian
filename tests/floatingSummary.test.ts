import { describe, expect, it } from "vitest";
import { shouldShowFloatingSummary } from "../src/ui/floatingSummary";

describe("shouldShowFloatingSummary", () => {
  it("keeps the overlay hidden while the summary is inside the viewport", () => {
    expect(
      shouldShowFloatingSummary({
        rootTop: 100,
        rootHeight: 600,
        summaryBottom: 101,
        summaryHeight: 30,
      })
    ).toBe(false);
  });

  it("shows the overlay when the summary reaches or passes the viewport top", () => {
    expect(
      shouldShowFloatingSummary({
        rootTop: 100,
        rootHeight: 600,
        summaryBottom: 100,
        summaryHeight: 30,
      })
    ).toBe(true);
    expect(
      shouldShowFloatingSummary({
        rootTop: 100,
        rootHeight: 600,
        summaryBottom: 80,
        summaryHeight: 30,
      })
    ).toBe(true);
  });

  it("keeps the overlay hidden until the root has measurable bounds", () => {
    expect(
      shouldShowFloatingSummary({
        rootTop: null,
        rootHeight: 0,
        summaryBottom: 0,
        summaryHeight: 0,
      })
    ).toBe(false);
    expect(
      shouldShowFloatingSummary({
        rootTop: 0,
        rootHeight: 0,
        summaryBottom: 0,
        summaryHeight: 0,
      })
    ).toBe(false);
    expect(
      shouldShowFloatingSummary({
        rootTop: undefined,
        rootHeight: 600,
        summaryBottom: 0,
        summaryHeight: 30,
      })
    ).toBe(false);
  });
});
