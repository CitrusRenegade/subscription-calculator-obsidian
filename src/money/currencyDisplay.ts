import type { CurrencyMeta } from "../types";
import { getGraphemes } from "./currencyValidation";

export function getCurrencyAmountMarker(currency: CurrencyMeta): string {
  return currency.amountMarker?.trim() || currency.label.trim();
}

export function getCurrencySelectLabel(currency: CurrencyMeta): string {
  const label = currency.label.trim();
  const marker = currency.amountMarker?.trim();

  if (!marker) return label;
  if (marker.toLocaleLowerCase() === label.toLocaleLowerCase()) {
    return label;
  }

  return `${label} ${marker}`;
}

export function getCurrencyFallbackIconText(currency: CurrencyMeta): string {
  if (currency.icon?.mode === "text" || currency.icon?.mode === "emoji") {
    const iconText = currency.icon.value?.trim();
    if (iconText) return getGraphemes(iconText).slice(0, 2).join("");
  }

  return getGraphemes(currency.label || currency.code)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
