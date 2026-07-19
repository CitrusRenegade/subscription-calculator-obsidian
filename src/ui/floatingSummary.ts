interface FloatingSummaryGeometry {
  position: FloatingSummaryPosition;
  viewTop: number | null | undefined;
  viewBottom: number;
  sentinelTop: number;
  sentinelBottom: number;
  sentinelHeight: number;
}

interface RectangleEdges {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface BottomSheetStatusBarGeometry {
  sheet: RectangleEdges;
  statusBar: RectangleEdges | null;
}

export interface FloatingSummaryPresentation {
  visible: boolean;
  overlayHeight: number;
  sheetHeight: number;
}

export type FloatingSummaryPosition = "top" | "bottom";
export type StaticSummaryPlacement = "before-content" | "after-content";

export function getFloatingSummaryPosition(
  floatingYearlyTotalAtBottom: boolean
): FloatingSummaryPosition {
  return floatingYearlyTotalAtBottom ? "bottom" : "top";
}

export function getStaticSummaryPlacement(
  position: FloatingSummaryPosition
): StaticSummaryPlacement {
  return position === "top" ? "before-content" : "after-content";
}

export function getFloatingSummaryPresentation(
  position: FloatingSummaryPosition,
  requestedVisible: boolean,
  measuredHeight: number
): FloatingSummaryPresentation {
  const visible = requestedVisible;
  const normalizedHeight = Math.max(0, measuredHeight);
  return {
    visible,
    overlayHeight: position === "top" && visible ? normalizedHeight : 0,
    sheetHeight: position === "bottom" && visible ? normalizedHeight : 0,
  };
}

/** OBS-36.FLOATING_SUMMARY.3 */
export function shouldShowFloatingSummary({
  position,
  viewTop,
  viewBottom,
  sentinelTop,
  sentinelBottom,
  sentinelHeight,
}: FloatingSummaryGeometry): boolean {
  const isMeasurable =
    viewTop !== null &&
    viewTop !== undefined &&
    viewBottom > viewTop &&
    sentinelHeight > 0;
  if (!isMeasurable) return false;

  return position === "top"
    ? sentinelBottom <= viewTop
    : sentinelTop > viewBottom;
}

/** OBS-36.FLOATING_SUMMARY.2 */
export function getBottomSheetStatusBarInset({
  sheet,
  statusBar,
}: BottomSheetStatusBarGeometry): number {
  if (statusBar === null) return 0;

  const horizontalOverlap = Math.max(
    0,
    Math.min(sheet.right, statusBar.right) - Math.max(sheet.left, statusBar.left)
  );
  const verticalOverlap = Math.max(
    0,
    Math.min(sheet.bottom, statusBar.bottom) - Math.max(sheet.top, statusBar.top)
  );
  return horizontalOverlap > 0 ? verticalOverlap : 0;
}
