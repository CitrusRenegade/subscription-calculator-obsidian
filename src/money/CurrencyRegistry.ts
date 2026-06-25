import type { CurrencyMeta } from "../types";
import { BUILTIN_CURRENCIES } from "./currencies";

export interface CurrencyRegistry {
  get(code: string): CurrencyMeta | null;
  list(): CurrencyMeta[];
  listSelectable(): CurrencyMeta[];
  getDefault(): CurrencyMeta;
}

function normalizeCurrencyCode(code: string): string {
  return code.trim().toUpperCase();
}

export class DataBackedCurrencyRegistry implements CurrencyRegistry {
  constructor(
    private readonly getDefaultCode: () => string,
    private readonly getCustomCurrencies: () => CurrencyMeta[],
    private readonly builtins = BUILTIN_CURRENCIES
  ) {}

  get(code: string): CurrencyMeta | null {
    const normalized = normalizeCurrencyCode(code);
    return (
      this.builtins.find((currency) => currency.code === normalized) ??
      this.getCustomCurrencies().find(
        (currency) => normalizeCurrencyCode(currency.code) === normalized
      ) ??
      null
    );
  }

  list(): CurrencyMeta[] {
    return this.listSelectable();
  }

  listSelectable(): CurrencyMeta[] {
    return [
      ...this.builtins,
      ...this.getCustomCurrencies().filter((currency) => !currency.isArchived),
    ];
  }

  getDefault(): CurrencyMeta {
    const defaultCode = normalizeCurrencyCode(this.getDefaultCode());
    return (
      this.listSelectable().find(
        (currency) => normalizeCurrencyCode(currency.code) === defaultCode
      ) ?? this.builtins[0]
    );
  }
}

export class BuiltinCurrencyRegistry extends DataBackedCurrencyRegistry {
  constructor(defaultCode = "USD", currencies = BUILTIN_CURRENCIES) {
    super(() => defaultCode, () => [], currencies);
  }
}

export function getBuiltinCurrency(code: string): CurrencyMeta | null {
  const normalized = normalizeCurrencyCode(code);
  return BUILTIN_CURRENCIES.find((currency) => currency.code === normalized) ?? null;
}

export function isBuiltinCurrencyCode(code: string): boolean {
  return getBuiltinCurrency(code) !== null;
}
