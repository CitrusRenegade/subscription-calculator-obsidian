export type OpenMode = "right-sidebar" | "main-tab";
export type FaviconProvider = "google-s2" | "none";
export type SubscriptionStatus = "enabled" | "disabled";
export type BillingPeriod = "weekly" | "monthly" | "quarterly" | "yearly" | "custom";
export type DateOnly = string;
export type IconMode = "auto" | "manual-url" | "emoji" | "none";

export interface PluginSettings {
  openMode: OpenMode;
  defaultCurrency: string;
  showDisabled: boolean;
  faviconProvider: FaviconProvider;
  confirmBeforeDelete: boolean;
}

export interface Money {
  amountMinor: number;
  currencyCode: string;
}

export interface SubscriptionIcon {
  mode: IconMode;
  manualUrl?: string;
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
  billingPeriod: BillingPeriod;
  customBillingPeriodDays?: number;
  serviceUrl?: string;
  cancelUrl?: string;
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
}

export interface CurrencyMeta {
  code: string;
  name: string;
  symbol: string;
  scale: number;
  source: "builtin" | "generated" | "custom";
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
  billingPeriod: BillingPeriod;
  customBillingPeriodDays?: number;
  serviceUrl?: string;
  cancelUrl?: string;
  icon?: Partial<SubscriptionIcon>;
}

export interface UpdateSubscriptionInput {
  name?: string;
  priceText?: string;
  currencyCode?: string;
  billingPeriod?: BillingPeriod;
  customBillingPeriodDays?: number;
  serviceUrl?: string;
  cancelUrl?: string;
  icon?: Partial<SubscriptionIcon>;
}

export interface SubscriptionViewItem extends SubscriptionItem {
  effectiveStatus: SubscriptionStatus;
  inDisableGracePeriod: boolean;
}
