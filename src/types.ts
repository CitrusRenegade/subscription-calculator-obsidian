export type OpenMode = "right-sidebar" | "main-tab";
export type FaviconProvider = "google-s2" | "none";
export type SubscriptionStatus = "enabled" | "disabled";
export type BillingPeriod = "weekly" | "monthly" | "quarterly" | "yearly" | "custom";
export type DateOnly = string;
export type IconMode = "auto" | "emoji" | "none";
export type SubscriptionSortMode = "alphabetical" | "status" | "next-payment";
export type SubscriptionSortDirection = "ascending" | "descending";
export type MoneyDisplayPrecision = 0 | 1;

export interface PluginSettings {
  openMode: OpenMode;
  defaultCurrency: string;
  showDisabled: boolean;
  faviconProvider: FaviconProvider;
  confirmBeforeDelete: boolean;
  moneyDisplayPrecision: MoneyDisplayPrecision;
  sortMode: SubscriptionSortMode;
  sortDirection: SubscriptionSortDirection;
}

export interface Money {
  amountMinor: number;
  currencyCode: string;
}

export interface SubscriptionIcon {
  mode: IconMode;
  emoji?: string;
  cacheKey?: string;
}

export interface CachedIcon {
  cacheKey: string;
  sourceUrl: string;
  serviceDomain: string;
  dataUrl: string;
  contentType: string;
  fetchedOn: DateOnly;
  width?: number;
  height?: number;
}

export interface SubscriptionItem {
  id: string;
  name: string;
  status: SubscriptionStatus;
  price: Money;
  startDate?: DateOnly;
  billingPeriod: BillingPeriod;
  customBillingPeriodDays?: number;
  serviceUrl?: string;
  icon: SubscriptionIcon;
  createdOn: DateOnly;
  updatedOn: DateOnly;
  disabledOn?: DateOnly;
}

export interface PluginData {
  schemaVersion: number;
  settings: PluginSettings;
  subscriptions: SubscriptionItem[];
  iconCache: Record<string, CachedIcon>;
  customCurrencies: CurrencyMeta[];
}

export interface CurrencyMeta {
  code: string;
  label: string;
  amountMarker?: string;
  scale: number;
  source: "builtin" | "custom";
  isArchived?: boolean;
}

export interface MoneyTotal {
  currencyCode: string;
  perYearMinor: number;
  perMonthMinor: number;
}

export interface AddSubscriptionInput {
  name: string;
  priceText: string;
  currencyCode: string;
  status?: SubscriptionStatus;
  startDate?: DateOnly;
  billingPeriod: BillingPeriod;
  customBillingPeriodDays?: number;
  serviceUrl?: string;
  icon?: Partial<SubscriptionIcon>;
}

export interface UpdateSubscriptionInput {
  name?: string;
  priceText?: string;
  currencyCode?: string;
  startDate?: DateOnly;
  billingPeriod?: BillingPeriod;
  customBillingPeriodDays?: number;
  serviceUrl?: string;
  icon?: Partial<SubscriptionIcon>;
}

export interface SubscriptionViewItem extends SubscriptionItem {
  effectiveStatus: SubscriptionStatus;
  inDisableGracePeriod: boolean;
}
