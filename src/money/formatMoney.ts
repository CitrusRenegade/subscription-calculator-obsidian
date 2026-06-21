import type { CurrencyRegistry } from "./CurrencyRegistry";
import type { Money } from "../types";

export function formatMoney(money: Money, registry: CurrencyRegistry): string {
  const currency = registry.get(money.currencyCode) ?? registry.getDefault();
  const factor = 10 ** currency.scale;
  const amount = money.amountMinor / factor;
  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const formatted = formatter
    .formatToParts(amount)
    .map((part) => (part.type === "group" ? "\u00A0" : part.value))
    .join("");
  return `${formatted} ${currency.symbol}`;
}

export function moneyToInputValue(money: Money, registry: CurrencyRegistry): string {
  const currency = registry.get(money.currencyCode) ?? registry.getDefault();
  const factor = 10 ** currency.scale;
  return (money.amountMinor / factor).toFixed(currency.scale);
}
