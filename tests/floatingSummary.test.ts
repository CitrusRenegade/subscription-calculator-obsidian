import { describe, expect, it } from "vitest";
import {
  getFloatingSummaryPresentation,
  getFloatingSummaryPosition,
  getStaticSummaryPlacement,
  getBottomSheetStatusBarInset,
  shouldShowFloatingSummary,
} from "../src/ui/floatingSummary";

describe("getFloatingSummaryPosition", () => {
  it("OBS-36 keeps the original top overlay as the default position", () => {
    expect(getFloatingSummaryPosition(false)).toBe("top");
  });

  it("OBS-36 moves the floating summary to the bottom when enabled", () => {
    expect(getFloatingSummaryPosition(true)).toBe("bottom");
  });

  it("OBS-36 places the static summary at the sentinel end for each mode", () => {
    expect(getStaticSummaryPlacement("top")).toBe("before-content");
    expect(getStaticSummaryPlacement("bottom")).toBe("after-content");
  });
});

describe("getFloatingSummaryPresentation", () => {
  it("OBS-36 presents the default top overlay and reserves top scroll space", () => {
    expect(getFloatingSummaryPresentation("top", true, 120)).toEqual({
      visible: true,
      overlayHeight: 120,
      sheetHeight: 0,
    });
  });

  it("OBS-36 presents the bottom sheet and reserves bottom body space", () => {
    expect(getFloatingSummaryPresentation("bottom", true, 120)).toEqual({
      visible: true,
      overlayHeight: 0,
      sheetHeight: 120,
    });
  });

  it("OBS-36 reserves no space while the top overlay is hidden", () => {
    expect(getFloatingSummaryPresentation("top", false, 120)).toEqual({
      visible: false,
      overlayHeight: 0,
      sheetHeight: 0,
    });
  });

  it("OBS-36 removes bottom scroll space after hiding the sheet", () => {
    expect(getFloatingSummaryPresentation("bottom", false, 120)).toEqual({
      visible: false,
      overlayHeight: 0,
      sheetHeight: 0,
    });
  });
});

describe("shouldShowFloatingSummary", () => {
  it("OBS-36 shows the default top overlay after the static summary scrolls above the view", () => {
    expect(
      shouldShowFloatingSummary({
        position: "top",
        viewTop: 100,
        viewBottom: 700,
        sentinelTop: 70,
        sentinelBottom: 100,
        sentinelHeight: 30,
      })
    ).toBe(true);
    expect(
      shouldShowFloatingSummary({
        position: "top",
        viewTop: 100,
        viewBottom: 700,
        sentinelTop: 71,
        sentinelBottom: 101,
        sentinelHeight: 30,
      })
    ).toBe(false);
  });

  it("OBS-36 hides the bottom sheet when annual values enter the viewport", () => {
    expect(
      shouldShowFloatingSummary({
        position: "bottom",
        viewTop: 100,
        viewBottom: 700,
        sentinelTop: 701,
        sentinelBottom: 731,
        sentinelHeight: 30,
      })
    ).toBe(true);
    expect(
      shouldShowFloatingSummary({
        position: "bottom",
        viewTop: 100,
        viewBottom: 700,
        sentinelTop: 700,
        sentinelBottom: 730,
        sentinelHeight: 30,
      })
    ).toBe(false);
  });

  it("OBS-36.FLOATING_SUMMARY.3 keeps the sheet hidden until its title and view are measurable", () => {
    expect(
      shouldShowFloatingSummary({
        position: "bottom",
        viewTop: null,
        viewBottom: 0,
        sentinelTop: 0,
        sentinelBottom: 0,
        sentinelHeight: 0,
      })
    ).toBe(false);
    expect(
      shouldShowFloatingSummary({
        position: "top",
        viewTop: 0,
        viewBottom: 0,
        sentinelTop: 70,
        sentinelBottom: 100,
        sentinelHeight: 30,
      })
    ).toBe(false);
  });

  it("OBS-36.FLOATING_SUMMARY.2 insets content by vertical status-bar overlap only when it overlaps horizontally", () => {
    expect(
      getBottomSheetStatusBarInset({
        sheet: { left: 0, right: 500, top: 580, bottom: 700 },
        statusBar: { left: 0, right: 500, top: 670, bottom: 710 },
      })
    ).toBe(30);
    expect(
      getBottomSheetStatusBarInset({
        sheet: { left: 0, right: 500, top: 580, bottom: 700 },
        statusBar: { left: 600, right: 800, top: 670, bottom: 710 },
      })
    ).toBe(0);
    expect(
      getBottomSheetStatusBarInset({
        sheet: { left: 0, right: 500, top: 580, bottom: 700 },
        statusBar: { left: 0, right: 500, top: 710, bottom: 740 },
      })
    ).toBe(0);
  });
});
