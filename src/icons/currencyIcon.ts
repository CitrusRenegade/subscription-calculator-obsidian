const CURRENCY_ICONS: Readonly<Record<string, string>> = {
  USD: "receipt",
  EUR: "receipt-euro",
  RUB: "receipt-russian-ruble",
  GBP: "receipt-pound-sterling",
  JPY: "receipt-japanese-yen",
  CHF: "receipt-swiss-franc",
};

export function getCurrencyIconName(currencyCode: string): string {
  // Reserved fallback for currencies that are not supported by the built-in registry.
  return CURRENCY_ICONS[currencyCode.trim().toUpperCase()] ?? "receipt-text";
}
