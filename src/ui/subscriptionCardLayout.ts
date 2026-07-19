export interface NextPaymentLayoutGeometry {
  cardLeft: number;
  cardTop: number;
  nameRight: number;
  actionsLeft: number;
  actionsTop: number;
  actionsBottom: number;
  countdownWidth: number;
}

export type NextPaymentLayout =
  | { wrapped: true }
  | { wrapped: false; left: number; top: number };

export function getNextPaymentLayout({
  cardLeft,
  cardTop,
  nameRight,
  actionsLeft,
  actionsTop,
  actionsBottom,
  countdownWidth,
}: NextPaymentLayoutGeometry): NextPaymentLayout {
  const clearance = 3;
  const availableWidth = actionsLeft - nameRight - clearance * 2;
  if (countdownWidth > availableWidth) return { wrapped: true };

  return {
    wrapped: false,
    left: (nameRight + actionsLeft) / 2 - cardLeft,
    top: (actionsTop + actionsBottom) / 2 - cardTop,
  };
}
