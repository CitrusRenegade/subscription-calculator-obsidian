import type { CurrencyMeta } from "../types";
import { BUILTIN_CURRENCIES } from "./currencies";

interface SegmenterLike {
  segment(value: string): Iterable<{ segment: string }>;
}

interface IntlWithSegmenter {
  Segmenter?: new (
    locale: string | undefined,
    options: { granularity: "grapheme" }
  ) => SegmenterLike;
}

export interface CustomCurrencyInput {
  label: string;
  amountMarker?: string;
  scale: number;
}

export interface NormalizedCustomCurrencyInput {
  label: string;
  amountMarker?: string;
  scale: number;
}

function isMvpCurrencyScale(value: number): boolean {
  return value === 0 || value === 2;
}

export function getGraphemes(value: string): string[] {
  const normalized = value.trim().normalize("NFC");
  const intlWithSegmenter = Intl as IntlWithSegmenter;

  if (typeof Intl !== "undefined" && intlWithSegmenter.Segmenter) {
    const segmenter = new intlWithSegmenter.Segmenter(undefined, {
      granularity: "grapheme",
    });

    return Array.from(segmenter.segment(normalized), (part) => part.segment);
  }

  return Array.from(normalized);
}

export function normalizeCurrencyLabel(value: string): string | null {
  const normalized = value.trim().normalize("NFC");
  const graphemes = getGraphemes(normalized);

  if (graphemes.length < 1) return null;
  if (graphemes.length > 8) return null;

  return normalized.toUpperCase();
}

export function normalizeCurrencyAmountMarker(value: string): string | undefined | null {
  const normalized = value.trim().normalize("NFC");
  if (!normalized) return undefined;

  const graphemes = getGraphemes(normalized);
  if (graphemes.length > 6) return null;

  return normalized;
}

export function normalizeCurrencyIconText(value: string): string | null {
  const normalized = value.trim().normalize("NFC");
  const graphemes = getGraphemes(normalized);

  if (graphemes.length < 1) return null;
  if (graphemes.length > 2) return null;

  return normalized;
}

export function normalizeCurrencyScale(value: number): number | null {
  if (!Number.isInteger(value)) return null;
  if (value < 0 || value > 8) return null;
  return value;
}

export function normalizeNewCurrencyScale(value: number): number | null {
  if (!isMvpCurrencyScale(value)) return null;
  return value;
}

export function normalizeExistingCustomCurrencyCode(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,32}$/.test(code)) return null;
  if (BUILTIN_CURRENCIES.some((currency) => currency.code === code)) return null;

  return code;
}

export function normalizeCustomCurrencyInput(
  input: CustomCurrencyInput
): NormalizedCustomCurrencyInput | null {
  const label = normalizeCurrencyLabel(input.label);
  const amountMarker = normalizeCurrencyAmountMarker(input.amountMarker ?? "");
  const scale = normalizeCurrencyScale(input.scale);

  if (!label || amountMarker === null || scale === null) return null;
  return { label, amountMarker, scale };
}

export function normalizeNewCustomCurrencyInput(
  input: CustomCurrencyInput
): NormalizedCustomCurrencyInput | null {
  const label = normalizeCurrencyLabel(input.label);
  const amountMarker = normalizeCurrencyAmountMarker(input.amountMarker ?? "");
  const scale = normalizeNewCurrencyScale(input.scale);

  if (!label || amountMarker === null || scale === null) return null;
  return { label, amountMarker, scale };
}

export function sanitizeCustomCurrency(value: unknown): CurrencyMeta | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.source !== "custom") return null;

  const code = normalizeExistingCustomCurrencyCode(raw.code);
  if (!code) return null;

  const rawLabel =
    typeof raw.label === "string"
      ? raw.label
      : typeof raw.shortName === "string"
        ? raw.shortName
        : "";
  const rawAmountMarker =
    typeof raw.amountMarker === "string"
      ? raw.amountMarker
      : typeof raw.symbol === "string"
        ? raw.symbol
        : "";
  const label = normalizeCurrencyLabel(rawLabel);
  const amountMarker = normalizeCurrencyAmountMarker(rawAmountMarker);
  const scale =
    typeof raw.scale === "number" ? normalizeCurrencyScale(raw.scale) : null;

  if (!label || amountMarker === null || scale === null) return null;
  return {
    code,
    label,
    amountMarker,
    scale,
    source: "custom",
    isArchived: raw.isArchived === true,
  };
}
