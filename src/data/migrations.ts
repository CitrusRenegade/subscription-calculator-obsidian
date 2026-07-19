import {
  DEFAULT_CUSTOM_BILLING_PERIOD_DAYS,
  SCHEMA_VERSION,
} from "../constants";
import type {
  BillingPeriod,
  CachedIcon,
  FaviconProvider,
  IconMode,
  MoneyDisplayPrecision,
  PluginData,
  PluginSettings,
  SubscriptionItem,
  SubscriptionSortDirection,
  SubscriptionSortMode,
  SubscriptionStatus,
} from "../types";
import { parseDateOnly } from "../date/dateOnly";
import { DEFAULT_SETTINGS, createDefaultData } from "./defaultData";
import { sanitizeCustomCurrency } from "../money/currencyValidation";
import { BUILTIN_CURRENCIES } from "../money/currencies";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asOpenMode(value: unknown): PluginSettings["openMode"] {
  return value === "main-tab" || value === "right-sidebar"
    ? value
    : DEFAULT_SETTINGS.openMode;
}

function asFaviconProvider(value: unknown): FaviconProvider {
  return value === "none" || value === "google-s2"
    ? value
    : DEFAULT_SETTINGS.faviconProvider;
}

function asStatus(value: unknown): SubscriptionStatus {
  return value === "disabled" ? "disabled" : "enabled";
}

function asSortMode(value: unknown): SubscriptionSortMode {
  if (value === "status" || value === "next-payment") return value;
  return "alphabetical";
}

function asSortDirection(value: unknown): SubscriptionSortDirection {
  return value === "descending" ? "descending" : "ascending";
}

function asMoneyDisplayPrecision(value: unknown): MoneyDisplayPrecision {
  return value === 1 ? 1 : DEFAULT_SETTINGS.moneyDisplayPrecision;
}

function asPeriod(value: unknown): BillingPeriod {
  if (
    value === "weekly" ||
    value === "monthly" ||
    value === "quarterly" ||
    value === "yearly" ||
    value === "custom"
  ) {
    return value;
  }
  return "monthly";
}

function asIconMode(value: unknown): IconMode {
  if (value === "emoji" || value === "none") return value;
  return "auto";
}

function asSafeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}

function migrateSettings(value: unknown): PluginSettings {
  const raw = isRecord(value) ? value : {};
  const defaultCurrency = asString(raw.defaultCurrency)?.trim().toUpperCase();
  return {
    openMode: asOpenMode(raw.openMode),
    defaultCurrency: defaultCurrency || DEFAULT_SETTINGS.defaultCurrency,
    showDisabled: asBoolean(raw.showDisabled, DEFAULT_SETTINGS.showDisabled),
    faviconProvider: asFaviconProvider(raw.faviconProvider),
    confirmBeforeDelete: asBoolean(
      raw.confirmBeforeDelete,
      DEFAULT_SETTINGS.confirmBeforeDelete
    ),
    moneyDisplayPrecision: asMoneyDisplayPrecision(raw.moneyDisplayPrecision),
    floatingYearlyTotal: asBoolean(
      raw.floatingYearlyTotal,
      DEFAULT_SETTINGS.floatingYearlyTotal
    ),
    sortMode: asSortMode(raw.sortMode),
    sortDirection: asSortDirection(raw.sortDirection),
  };
}

function migrateSubscription(value: unknown): SubscriptionItem | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id)?.trim();
  const name = asString(value.name)?.trim();
  const price = isRecord(value.price) ? value.price : null;
  const amountMinor = price
    ? asSafeInteger(price.amountMinor, Number.NaN)
    : Number.NaN;
  const currencyCode = price ? asString(price.currencyCode)?.trim().toUpperCase() : null;
  const createdOn = parseDateOnly(value.createdOn);
  const updatedOn = parseDateOnly(value.updatedOn);
  if (!id || !name || !Number.isSafeInteger(amountMinor) || !currencyCode || !createdOn || !updatedOn) {
    return null;
  }

  const rawIcon = isRecord(value.icon) ? value.icon : {};
  const status = asStatus(value.status);
  const disabledOn = parseDateOnly(value.disabledOn);
  const billingPeriod = asPeriod(value.billingPeriod);
  const customBillingPeriodDays =
    typeof value.customBillingPeriodDays === "number" &&
    value.customBillingPeriodDays > 0
      ? value.customBillingPeriodDays
      : billingPeriod === "custom"
        ? DEFAULT_CUSTOM_BILLING_PERIOD_DAYS
        : undefined;

  return {
    id,
    name,
    status,
    price: { amountMinor, currencyCode },
    startDate: parseDateOnly(value.startDate) ?? undefined,
    billingPeriod,
    customBillingPeriodDays,
    serviceUrl: asString(value.serviceUrl)?.trim() || undefined,
    icon: {
      mode: asIconMode(rawIcon.mode),
      emoji: asString(rawIcon.emoji)?.trim() || undefined,
      cacheKey: asString(rawIcon.cacheKey)?.trim() || undefined,
    },
    createdOn,
    updatedOn,
    disabledOn: status === "disabled" ? disabledOn ?? undefined : undefined,
  };
}

function migrateIconCache(value: unknown): Record<string, CachedIcon> {
  if (!isRecord(value)) return {};
  const result: Record<string, CachedIcon> = {};
  for (const [key, rawIcon] of Object.entries(value)) {
    if (!isRecord(rawIcon)) continue;
    const sourceUrl = asString(rawIcon.sourceUrl);
    const serviceDomain = asString(rawIcon.serviceDomain);
    const dataUrl = asString(rawIcon.dataUrl);
    const contentType = asString(rawIcon.contentType);
    const fetchedOn = parseDateOnly(rawIcon.fetchedOn);
    if (!sourceUrl || !serviceDomain || !dataUrl || !contentType || !fetchedOn) continue;
    result[key] = {
      cacheKey: key,
      sourceUrl,
      serviceDomain,
      dataUrl,
      contentType,
      fetchedOn,
      width:
        typeof rawIcon.width === "number" && rawIcon.width > 0
          ? rawIcon.width
          : undefined,
      height:
        typeof rawIcon.height === "number" && rawIcon.height > 0
          ? rawIcon.height
          : undefined,
    };
  }
  return result;
}

function migrateCustomCurrencies(value: unknown): PluginData["customCurrencies"] {
  if (!Array.isArray(value)) return [];
  const result: PluginData["customCurrencies"] = [];
  const seenCodes = new Set<string>();

  for (const rawCurrency of value) {
    const currency = sanitizeCustomCurrency(rawCurrency);
    if (!currency || seenCodes.has(currency.code)) continue;
    seenCodes.add(currency.code);
    result.push(currency);
  }

  return result;
}

function migrateSubscriptions(
  value: unknown,
  validCurrencyCodes: ReadonlySet<string>
): SubscriptionItem[] {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  const result: SubscriptionItem[] = [];
  for (const item of value) {
    const migrated = migrateSubscription(item);
    if (
      migrated === null ||
      migrated.price.amountMinor < 0 ||
      !validCurrencyCodes.has(migrated.price.currencyCode) ||
      seenIds.has(migrated.id)
    ) {
      continue;
    }

    seenIds.add(migrated.id);
    result.push(migrated);
  }
  return result;
}

export function migratePluginData(value: unknown): PluginData {
  const raw = isRecord(value) ? value : {};
  const data = createDefaultData();
  data.schemaVersion = SCHEMA_VERSION;
  data.settings = migrateSettings(raw.settings);
  data.customCurrencies = migrateCustomCurrencies(raw.customCurrencies);
  const validCurrencyCodes = new Set(
    [...BUILTIN_CURRENCIES, ...data.customCurrencies].map((currency) => currency.code)
  );
  data.subscriptions = migrateSubscriptions(raw.subscriptions, validCurrencyCodes);
  data.iconCache = migrateIconCache(raw.iconCache);
  return data;
}
