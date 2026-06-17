import type { CurrencyMeta } from "../types";
import { BUILTIN_CURRENCIES } from "./currencies";

export interface CurrencyRegistry {
  get(code: string): CurrencyMeta | null;
  list(): CurrencyMeta[];
  getDefault(): CurrencyMeta;
}

export class BuiltinCurrencyRegistry implements CurrencyRegistry {
  private readonly currencies: CurrencyMeta[];
  private readonly defaultCurrency: CurrencyMeta;

  constructor(defaultCode = "USD", currencies = BUILTIN_CURRENCIES) {
    this.currencies = currencies;
    this.defaultCurrency =
      currencies.find((currency) => currency.code === defaultCode) ?? currencies[0];
  }

  get(code: string): CurrencyMeta | null {
    const normalized = code.trim().toUpperCase();
    return this.currencies.find((currency) => currency.code === normalized) ?? null;
  }

  list(): CurrencyMeta[] {
    return [...this.currencies];
  }

  getDefault(): CurrencyMeta {
    return this.defaultCurrency;
  }
}

