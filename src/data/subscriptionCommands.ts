import { MAX_CUSTOM_BILLING_PERIOD_DAYS } from "../constants";
import { parseDateOnly } from "../date/dateOnly";
import { getOpenableServiceUrl } from "../icons/url";
import { moneyToInputValue } from "../money/formatMoney";
import type { CurrencyRegistry } from "../money/CurrencyRegistry";
import { parseMoneyInput } from "../money/parseMoneyInput";
import type {
  BillingPeriod,
  CurrencyMeta,
  Money,
  PluginData,
  SubscriptionCreateCommand,
  SubscriptionItem,
  SubscriptionSetCommand,
  SubscriptionStatus,
} from "../types";

export type StoreCommandErrorCode =
  | "INVALID_ARGUMENT"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "SAVE_FAILED"
  | "UNAVAILABLE"
  | "INTERNAL_ERROR";

/** Domain error carrying a stable code; adapters translate it without text matching. */
export class StoreCommandError extends Error {
  readonly code: StoreCommandErrorCode;
  readonly field: string | undefined;
  readonly cause: unknown;

  constructor(code: StoreCommandErrorCode, message: string, field?: string, cause?: unknown) {
    super(message);
    this.name = "StoreCommandError";
    this.code = code;
    this.field = field;
    this.cause = cause;
  }
}

export interface CreateCandidate {
  name: string;
  price: Money;
  currency: CurrencyMeta;
  billingPeriod: BillingPeriod;
  customBillingPeriodDays?: number;
  startDate?: string;
  serviceUrl?: string;
  status: SubscriptionStatus;
}

/**
 * Normalized provided-fields-only patch. `null` for startDate/serviceUrl clears the field;
 * an absent key means the field was not provided. `null` candidate = every provided field
 * already matches the record (semantic no-op).
 */
export interface SetCandidate {
  name?: string;
  price?: Money;
  currency?: CurrencyMeta;
  billingPeriod?: BillingPeriod;
  customBillingPeriodDays?: number;
  startDate?: string | null;
  serviceUrl?: string | null;
}

/** Shared strict-command predicates; the store reuses them for its own validations. */
export function isBillingPeriodValue(value: unknown): value is BillingPeriod {
  return (
    value === "weekly" ||
    value === "monthly" ||
    value === "quarterly" ||
    value === "yearly" ||
    value === "custom"
  );
}

export function isSubscriptionStatusValue(value: unknown): value is SubscriptionStatus {
  return value === "enabled" || value === "disabled";
}

export function isValidCustomPeriodDays(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_CUSTOM_BILLING_PERIOD_DAYS
  );
}

function normalizeCurrencyCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Codes select currencies; labels never do. Newly assigning archived currencies is rejected. */
export function resolveCommandCurrency(
  registry: CurrencyRegistry,
  code: string,
  field: string
): CurrencyMeta {
  const normalized = normalizeCurrencyCode(code);
  const currency = registry.get(normalized);
  if (!currency) {
    throw new StoreCommandError(
      "VALIDATION_FAILED",
      `Unknown currency: ${normalized || "(empty)"}.`,
      field
    );
  }
  if (currency.isArchived) {
    throw new StoreCommandError(
      "VALIDATION_FAILED",
      `Currency ${normalized} is archived and cannot be assigned to subscriptions.`,
      field
    );
  }
  return currency;
}

/** Retaining the currency a record already uses is allowed even when it is archived. */
function resolveRetainedCurrency(registry: CurrencyRegistry, code: string): CurrencyMeta {
  const currency = registry.get(code);
  if (!currency) {
    throw new StoreCommandError("VALIDATION_FAILED", `Unknown currency: ${code}.`, "price");
  }
  return currency;
}

/**
 * An explicitly selected currency behaves like retention when it canonically equals
 * the code the record already uses; every other archived assignment is rejected.
 */
function resolveSetCurrency(
  registry: CurrencyRegistry,
  code: string,
  item: SubscriptionItem
): CurrencyMeta {
  const normalized = normalizeCurrencyCode(code);
  const currency = registry.get(normalized);
  if (!currency) {
    throw new StoreCommandError(
      "VALIDATION_FAILED",
      `Unknown currency: ${normalized || "(empty)"}.`,
      "currency"
    );
  }
  if (currency.isArchived && normalized !== normalizeCurrencyCode(item.price.currencyCode)) {
    throw new StoreCommandError(
      "VALIDATION_FAILED",
      `Currency ${normalized} is archived and cannot be assigned to subscriptions.`,
      "currency"
    );
  }
  return currency;
}

function resolveDefaultCurrency(data: PluginData, registry: CurrencyRegistry): CurrencyMeta {
  const code = data.settings.defaultCurrency;
  const currency = registry.get(code);
  if (!currency || currency.isArchived) {
    throw new StoreCommandError(
      "VALIDATION_FAILED",
      `The default currency ${code} is unavailable.`,
      "currency"
    );
  }
  return currency;
}

/** Strict command URL rule: an http(s) URL, or a bare host[:port]/path normalized to https. */
export function normalizeCommandUrl(value: string, field: string): string {
  // The GUI accepts host[:port] inputs by defaulting the scheme; the CLI matches
  // that instead of misreading "host:" as a URL scheme.
  const withDefaultScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim()) ? value : `https://${value.trim()}`;
  const openable = getOpenableServiceUrl(withDefaultScheme);
  if (!openable) {
    throw new StoreCommandError("VALIDATION_FAILED", "Enter a valid http(s) URL or domain.", field);
  }
  return openable;
}

function parseCommandStartDate(value: string, field: string): string {
  const parsed = parseDateOnly(value);
  if (!parsed) {
    throw new StoreCommandError(
      "VALIDATION_FAILED",
      "Enter a valid start date (YYYY-MM-DD).",
      field
    );
  }
  return parsed;
}

function assertNoClearConflict(
  hasValue: boolean,
  hasClear: boolean,
  field: string,
  label: string
): void {
  if (hasValue && hasClear) {
    throw new StoreCommandError(
      "INVALID_ARGUMENT",
      `Conflicting value and switch: ${label}.`,
      field
    );
  }
}

/**
 * Pure strict candidate construction for `new`; shared by commit and dry-run.
 * Callers resolve the default currency and archive state from queued data.
 */
export function buildCreateCandidate(
  data: PluginData,
  registry: CurrencyRegistry,
  command: SubscriptionCreateCommand
): CreateCandidate {
  const name = typeof command.name === "string" ? command.name.trim() : "";
  if (!name) {
    throw new StoreCommandError("INVALID_ARGUMENT", "Subscription name is required.", "name");
  }
  if (typeof command.priceText !== "string") {
    throw new StoreCommandError("INVALID_ARGUMENT", "A price is required.", "price");
  }

  const currency = command.currencyCode !== undefined
    ? resolveCommandCurrency(registry, command.currencyCode, "currency")
    : resolveDefaultCurrency(data, registry);
  const price = parseMoneyInput(command.priceText, currency.code, registry);
  if (!price) {
    throw new StoreCommandError(
      "VALIDATION_FAILED",
      "Enter a valid price for the selected currency.",
      "price"
    );
  }

  const billingPeriod = command.billingPeriod ?? "monthly";
  if (!isBillingPeriodValue(billingPeriod)) {
    throw new StoreCommandError("VALIDATION_FAILED", "Select a valid billing period.", "period");
  }
  let customBillingPeriodDays: number | undefined;
  if (billingPeriod === "custom") {
    if (!isValidCustomPeriodDays(command.customBillingPeriodDays)) {
      throw new StoreCommandError(
        "VALIDATION_FAILED",
        `Custom billing period must be between 1 and ${MAX_CUSTOM_BILLING_PERIOD_DAYS} days.`,
        "days"
      );
    }
    customBillingPeriodDays = command.customBillingPeriodDays;
  } else if (command.customBillingPeriodDays !== undefined) {
    throw new StoreCommandError(
      "VALIDATION_FAILED",
      "Custom days require the custom billing period.",
      "days"
    );
  }

  let startDate: string | undefined;
  if (command.startDate !== undefined && command.startDate.trim() !== "") {
    startDate = parseCommandStartDate(command.startDate, "start-date");
  }
  let serviceUrl: string | undefined;
  if (command.serviceUrl !== undefined && command.serviceUrl.trim() !== "") {
    serviceUrl = normalizeCommandUrl(command.serviceUrl, "url");
  }
  if (command.status !== undefined && !isSubscriptionStatusValue(command.status)) {
    throw new StoreCommandError("VALIDATION_FAILED", "Status must be enabled or disabled.", "status");
  }

  return {
    name,
    price,
    currency,
    billingPeriod,
    customBillingPeriodDays,
    startDate,
    serviceUrl,
    status: command.status ?? "enabled",
  };
}

function resolveSetPeriod(
  changes: SubscriptionSetCommand,
  item: SubscriptionItem
): { billingPeriod: BillingPeriod; customBillingPeriodDays?: number } | null {
  const { billingPeriod, customBillingPeriodDays } = changes;
  if (billingPeriod === undefined && customBillingPeriodDays === undefined) return null;

  if (billingPeriod !== undefined && !isBillingPeriodValue(billingPeriod)) {
    throw new StoreCommandError("VALIDATION_FAILED", "Select a valid billing period.", "period");
  }
  const finalPeriod = billingPeriod ?? item.billingPeriod;

  if (customBillingPeriodDays !== undefined) {
    if (finalPeriod !== "custom") {
      throw new StoreCommandError(
        "VALIDATION_FAILED",
        "Custom days require the custom billing period.",
        "days"
      );
    }
    if (!isValidCustomPeriodDays(customBillingPeriodDays)) {
      throw new StoreCommandError(
        "VALIDATION_FAILED",
        `Custom billing period must be between 1 and ${MAX_CUSTOM_BILLING_PERIOD_DAYS} days.`,
        "days"
      );
    }
    return { billingPeriod: finalPeriod, customBillingPeriodDays };
  }

  if (finalPeriod === "custom") {
    // Existing custom days are retained when omitted; a transition needs them to exist.
    if (!isValidCustomPeriodDays(item.customBillingPeriodDays)) {
      throw new StoreCommandError(
        "VALIDATION_FAILED",
        "Switching to a custom period requires a number of days.",
        "days"
      );
    }
    return { billingPeriod: "custom", customBillingPeriodDays: item.customBillingPeriodDays };
  }
  // Switching away from custom clears the days.
  return { billingPeriod: finalPeriod };
}

/**
 * Pure strict candidate construction for `set`; shared by commit and dry-run.
 * Only provided fields are normalized; each is diffed against the record so an
 * identical set yields a null (no-op) candidate. Throws before any mutation.
 */
export function buildSetCandidate(
  item: SubscriptionItem,
  data: PluginData,
  registry: CurrencyRegistry,
  changes: SubscriptionSetCommand
): SetCandidate | null {
  if (changes.status !== undefined && !isSubscriptionStatusValue(changes.status)) {
    throw new StoreCommandError("VALIDATION_FAILED", "Status must be enabled or disabled.", "status");
  }
  assertNoClearConflict(
    changes.serviceUrl !== undefined,
    changes.clearServiceUrl === true,
    "url",
    "url and clear-url"
  );
  assertNoClearConflict(
    changes.startDate !== undefined,
    changes.clearStartDate === true,
    "start-date",
    "start-date and clear-start-date"
  );

  const candidate: SetCandidate = {};
  let providedField = false;

  if (changes.name !== undefined) {
    providedField = true;
    const name = changes.name.trim();
    if (!name) {
      throw new StoreCommandError("VALIDATION_FAILED", "Subscription name is required.", "name");
    }
    if (name !== item.name) candidate.name = name;
  }

  const currencyProvided = typeof changes.currencyCode === "string";
  const priceProvided = typeof changes.priceText === "string";
  if (currencyProvided || priceProvided) {
    providedField = true;
    const currency = currencyProvided
      ? resolveSetCurrency(registry, changes.currencyCode as string, item)
      : resolveRetainedCurrency(registry, item.price.currencyCode);
    if (!priceProvided && currency.code !== normalizeCurrencyCode(item.price.currencyCode)) {
      throw new StoreCommandError(
        "VALIDATION_FAILED",
        "Changing the currency requires an explicit price.",
        "price"
      );
    }
    const priceText = priceProvided
      ? (changes.priceText as string)
      : moneyToInputValue(item.price, registry);
    const money = parseMoneyInput(priceText, currency.code, registry);
    if (!money) {
      throw new StoreCommandError(
        "VALIDATION_FAILED",
        "Enter a valid price for the selected currency.",
        "price"
      );
    }
    if (money.amountMinor !== item.price.amountMinor || money.currencyCode !== item.price.currencyCode) {
      candidate.price = money;
      candidate.currency = currency;
    }
  }

  const period = resolveSetPeriod(changes, item);
  if (period) {
    providedField = true;
    if (
      period.billingPeriod !== item.billingPeriod ||
      (period.customBillingPeriodDays ?? undefined) !== (item.customBillingPeriodDays ?? undefined)
    ) {
      candidate.billingPeriod = period.billingPeriod;
      candidate.customBillingPeriodDays = period.customBillingPeriodDays;
    }
  }

  if (changes.clearStartDate === true) {
    providedField = true;
    if (item.startDate !== undefined) candidate.startDate = null;
  } else if (changes.startDate !== undefined) {
    providedField = true;
    const parsed = parseCommandStartDate(changes.startDate, "start-date");
    if (parsed !== item.startDate) candidate.startDate = parsed;
  }

  if (changes.clearServiceUrl === true) {
    providedField = true;
    if (item.serviceUrl !== undefined) candidate.serviceUrl = null;
  } else if (changes.serviceUrl !== undefined) {
    providedField = true;
    const normalized = normalizeCommandUrl(changes.serviceUrl, "url");
    if (normalized !== item.serviceUrl) candidate.serviceUrl = normalized;
  }

  if (!providedField && changes.status === undefined) {
    throw new StoreCommandError("INVALID_ARGUMENT", "Provide at least one change.", "changes");
  }

  return candidate.name !== undefined ||
    candidate.price !== undefined ||
    candidate.billingPeriod !== undefined ||
    candidate.startDate !== undefined ||
    candidate.serviceUrl !== undefined
    ? candidate
    : null;
}
