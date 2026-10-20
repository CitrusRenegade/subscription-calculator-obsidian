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
  floatingYearlyTotal: boolean;
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
  status?: SubscriptionStatus;
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

/** Strict `new` command shared by the CLI adapter and dry-run preview. */
export interface SubscriptionCreateCommand {
  name: string;
  priceText: string;
  currencyCode?: string;
  billingPeriod?: BillingPeriod;
  customBillingPeriodDays?: number;
  startDate?: DateOnly;
  serviceUrl?: string;
  status?: SubscriptionStatus;
}

/** Strict `set` command; omitted fields are preserved, `clear*` switches remove optional ones. */
export interface SubscriptionSetCommand {
  name?: string;
  priceText?: string;
  currencyCode?: string;
  billingPeriod?: BillingPeriod;
  customBillingPeriodDays?: number;
  startDate?: DateOnly;
  clearStartDate?: boolean;
  serviceUrl?: string;
  clearServiceUrl?: boolean;
  status?: SubscriptionStatus;
}

export interface SubscriptionCommandOptions {
  /** Validate and preview without allocating ids or touching any persisted/runtime state. */
  dryRun?: boolean;
}

export interface SubscriptionCommandResult {
  /** Record id; null for a create preview, which allocates no id. */
  id: string | null;
  /** Detached snapshot taken at the transaction return point. */
  item: SubscriptionItem;
  currencyScale: number;
  currencyArchived: boolean;
  persistedStatus: SubscriptionStatus;
  effectiveStatus: SubscriptionStatus;
  /** True when a runtime status intent still differs from the persisted status. */
  statusPending: boolean;
  /** Persisted or observable runtime intent change; false for semantic no-ops. */
  changed: boolean;
  dryRun: boolean;
}
