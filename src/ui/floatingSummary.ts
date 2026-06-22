interface FloatingSummaryGeometry {
  rootTop: number | null | undefined;
  rootHeight: number;
  summaryBottom: number;
  summaryHeight: number;
}

export function shouldShowFloatingSummary({
  rootTop,
  rootHeight,
  summaryBottom,
  summaryHeight,
}: FloatingSummaryGeometry): boolean {
  return (
    rootTop !== null &&
    rootTop !== undefined &&
    rootHeight > 0 &&
    summaryHeight > 0 &&
    summaryBottom <= rootTop
  );
}
