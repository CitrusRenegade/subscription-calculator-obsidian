import type { CurrencyMeta } from "../types";

export const BUILTIN_CURRENCIES: CurrencyMeta[] = [
  {
    code: "USD",
    label: "USD",
    amountMarker: "$",
    scale: 2,
    source: "builtin",
  },
  {
    code: "EUR",
    label: "EUR",
    amountMarker: "€",
    scale: 2,
    source: "builtin",
  },
  {
    code: "RUB",
    label: "RUB",
    amountMarker: "₽",
    scale: 2,
    source: "builtin",
  },
  {
    code: "GBP",
    label: "GBP",
    amountMarker: "£",
    scale: 2,
    source: "builtin",
  },
  {
    code: "CHF",
    label: "CHF",
    scale: 2,
    source: "builtin",
  },
  {
    code: "JPY",
    label: "JPY",
    amountMarker: "¥",
    scale: 0,
    source: "builtin",
  },
];
