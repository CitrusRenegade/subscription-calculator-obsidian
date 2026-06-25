import type { CurrencyRegistry } from "./CurrencyRegistry";
import type { Money, MoneyDisplayPrecision } from "../types";
import { getCurrencyAmountMarker } from "./currencyDisplay";

export function formatMoney(
  money: Money,
  registry: CurrencyRegistry,
  displayPrecision: MoneyDisplayPrecision = 0
): string {
  const currency = registry.get(money.currencyCode);
  const scale = currency?.scale ?? 0;
  const factor = 10 ** scale;
  const amount = money.amountMinor / factor;
  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: displayPrecision,
    maximumFractionDigits: displayPrecision,
  });
  const formatted = formatter
    .formatToParts(amount)
    .map((part) => (part.type === "group" ? "\u00A0" : part.value))
    .join("");
  return `${formatted} ${currency ? getCurrencyAmountMarker(currency) : "?"}`;
}

export function moneyToInputValue(money: Money, registry: CurrencyRegistry): string {
  const currency = registry.get(money.currencyCode);
  if (!currency) return String(money.amountMinor);
  const factor = 10 ** currency.scale;
  return (money.amountMinor / factor).toFixed(currency.scale);
}
