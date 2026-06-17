import type { CurrencyRegistry } from "./CurrencyRegistry";
import type { Money } from "../types";

export function parseMoneyInput(
  value: string,
  currencyCode: string,
  registry: CurrencyRegistry
): Money | null {
  const currency = registry.get(currencyCode);
  if (!currency) return null;

  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;

  const [majorPart, fractionPart = ""] = normalized.split(".");
  if (fractionPart.length > currency.scale) return null;

  const paddedFraction = fractionPart.padEnd(currency.scale, "0");
  const majorMinor = Number(majorPart) * 10 ** currency.scale;
  const fractionMinor = paddedFraction ? Number(paddedFraction) : 0;
  const amountMinor = majorMinor + fractionMinor;

  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return null;
  return { amountMinor, currencyCode: currency.code };
}

