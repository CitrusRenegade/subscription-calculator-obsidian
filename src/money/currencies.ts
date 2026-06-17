import type { CurrencyMeta } from "../types";

export const BUILTIN_CURRENCIES: CurrencyMeta[] = [
  { code: "USD", name: "US Dollar", symbol: "$", scale: 2, source: "builtin" },
  { code: "EUR", name: "Euro", symbol: "€", scale: 2, source: "builtin" },
  { code: "RUB", name: "Russian Ruble", symbol: "₽", scale: 2, source: "builtin" },
  { code: "GBP", name: "British Pound", symbol: "£", scale: 2, source: "builtin" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", scale: 2, source: "builtin" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", scale: 0, source: "builtin" },
];

