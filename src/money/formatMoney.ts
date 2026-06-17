import type { CurrencyRegistry } from "./CurrencyRegistry";
import type { Money } from "../types";

export function formatMoney(money: Money, registry: CurrencyRegistry): string {
  const currency = registry.get(money.currencyCode) ?? registry.getDefault();
  const factor = 10 ** currency.scale;
  const amount = money.amountMinor / factor;
  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: currency.scale,
    maximumFractionDigits: currency.scale,
  });
  const formatted = formatter.format(amount);
  return currency.symbol.length === 1
    ? `${currency.symbol}${formatted}`
    : `${formatted} ${currency.symbol}`;
}

export function moneyToInputValue(money: Money, registry: CurrencyRegistry): string {
  const currency = registry.get(money.currencyCode) ?? registry.getDefault();
  const factor = 10 ** currency.scale;
  return (money.amountMinor / factor).toFixed(currency.scale);
}

