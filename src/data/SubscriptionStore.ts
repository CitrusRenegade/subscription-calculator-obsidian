import { Notice } from "obsidian";
import {
  DEFAULT_CUSTOM_BILLING_PERIOD_DAYS,
  DISABLE_GRACE_PERIOD_MS,
} from "../constants";
import type {
  AddSubscriptionInput,
  BillingPeriod,
  CurrencyMeta,
  MoneyTotal,
  PluginData,
  SubscriptionItem,
  SubscriptionViewItem,
  UpdateSubscriptionInput,
} from "../types";
import type { IconService } from "../icons/IconService";
import type { CurrencyRegistry } from "../money/CurrencyRegistry";
import type { Clock } from "../date/Clock";
import { systemClock } from "../date/Clock";
import { parseDateOnly, todayLocalDate } from "../date/dateOnly";
import { normalizeUrlInput } from "../icons/url";
import { moneyToInputValue } from "../money/formatMoney";
import { parseMoneyInput } from "../money/parseMoneyInput";
import { calculateTotalsByCurrency } from "../money/totals";
import { getCurrencySelectLabel } from "../money/currencyDisplay";
import {
  type CustomCurrencyInput,
  normalizeCustomCurrencyInput,
  normalizeNewCustomCurrencyInput,
} from "../money/currencyValidation";

interface DisableGracePeriod {
  subscriptionId: string;
  timeoutId: number;
}

export interface IconRefreshSummary {
  refreshed: number;
  failed: number;
  skipped: number;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createCustomCurrencyCode(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
    return `CUSTOM_${Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("").toUpperCase()}`;
  }
  return `CUSTOM_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

function normalizeCurrencyCode(code: string): string {
  return code.trim().toUpperCase();
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

function isBillingPeriod(value: string): value is BillingPeriod {
  return (
    value === "weekly" ||
    value === "monthly" ||
    value === "quarterly" ||
    value === "yearly" ||
    value === "custom"
  );
}

function isMvpCurrencyScale(value: number): boolean {
  return value === 0 || value === 2;
}

export class SubscriptionStore {
  private readonly listeners = new Set<() => void>();
  private readonly disableGracePeriods = new Map<string, DisableGracePeriod>();

  constructor(
    private readonly data: PluginData,
    private readonly currencyRegistry: CurrencyRegistry,
    private readonly iconService: IconService,
    private readonly saveData: () => Promise<void>,
    private readonly clock: Clock = systemClock
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    for (const gracePeriod of this.disableGracePeriods.values()) {
      window.clearTimeout(gracePeriod.timeoutId);
    }
    this.disableGracePeriods.clear();
    this.listeners.clear();
  }

  async flushDisableGracePeriods(): Promise<void> {
    if (!this.disableGracePeriods.size) return;

    for (const gracePeriod of this.disableGracePeriods.values()) {
      window.clearTimeout(gracePeriod.timeoutId);
    }

    const subscriptionIds = Array.from(this.disableGracePeriods.keys());
    this.disableGracePeriods.clear();

    let changed = false;
    for (const id of subscriptionIds) {
      changed = this.disableSubscriptionNow(id) || changed;
    }

    if (changed) {
      await this.saveData();
      this.notify();
    }
  }

  notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  async saveSettings(): Promise<void> {
    this.ensureDefaultCurrencyValid();
    await this.saveData();
    this.notify();
  }

  private findItem(id: string): SubscriptionItem | null {
    return this.data.subscriptions.find((item) => item.id === id) ?? null;
  }

  private findCustomCurrency(code: string): CurrencyMeta | null {
    const normalized = normalizeCurrencyCode(code);
    return (
      this.data.customCurrencies.find(
        (currency) => normalizeCurrencyCode(currency.code) === normalized
      ) ?? null
    );
  }

  private ensureDefaultCurrencyValid(): boolean {
    const defaultCurrency = this.currencyRegistry.getDefault().code;
    if (this.data.settings.defaultCurrency === defaultCurrency) return false;

    this.data.settings.defaultCurrency = defaultCurrency;
    return true;
  }

  private assertUniqueCurrencyDisplay(
    next: Pick<CurrencyMeta, "code" | "label" | "amountMarker" | "scale" | "source">,
    currentCode?: string
  ): void {
    const normalizedCurrentCode = currentCode
      ? normalizeCurrencyCode(currentCode)
      : null;
    const nextDisplay = getCurrencySelectLabel(next).toLocaleLowerCase();
    const duplicate = this.currencyRegistry
      .listSelectable()
      .some(
        (currency) =>
          normalizeCurrencyCode(currency.code) !== normalizedCurrentCode &&
          getCurrencySelectLabel(currency).toLocaleLowerCase() === nextDisplay
      );

    if (duplicate) {
      throw new Error("A currency with this label already exists.");
    }
  }

  private pruneUnusedArchivedCustomCurrencies(): boolean {
    const usedCurrencyCodes = new Set(
      this.data.subscriptions.map((item) =>
        normalizeCurrencyCode(item.price.currencyCode)
      )
    );
    const before = this.data.customCurrencies.length;
    this.data.customCurrencies = this.data.customCurrencies.filter(
      (currency) =>
        !currency.isArchived || usedCurrencyCodes.has(normalizeCurrencyCode(currency.code))
    );
    return this.data.customCurrencies.length !== before;
  }

  private getEffectiveStatus(item: SubscriptionItem): "enabled" | "disabled" {
    return this.disableGracePeriods.has(item.id) ? "disabled" : item.status;
  }

  private toViewItem(item: SubscriptionItem): SubscriptionViewItem {
    return {
      ...item,
      effectiveStatus: this.getEffectiveStatus(item),
      inDisableGracePeriod: this.disableGracePeriods.has(item.id),
    };
  }

  async addSubscription(input: AddSubscriptionInput): Promise<void> {
    const name = input.name.trim();
    if (!name) throw new Error("Subscription name is required.");

    const currencyCode = input.currencyCode.trim().toUpperCase();
    const money = parseMoneyInput(input.priceText, currencyCode, this.currencyRegistry);
    if (!money) throw new Error("Enter a valid price for the selected currency.");

    if (!isBillingPeriod(input.billingPeriod)) {
      throw new Error("Select a valid billing period.");
    }
    const startDate = input.startDate?.trim()
      ? parseDateOnly(input.startDate) ?? undefined
      : undefined;
    if (input.startDate?.trim() && !startDate) {
      throw new Error("Select a valid start date.");
    }
    if (
      input.billingPeriod === "custom" &&
      (!input.customBillingPeriodDays || input.customBillingPeriodDays <= 0)
    ) {
      throw new Error("Custom billing period must be greater than 0 days.");
    }

    const today = todayLocalDate(this.clock);
    const item: SubscriptionItem = {
      id: createId(),
      name,
      status: "enabled",
      price: money,
      startDate,
      billingPeriod: input.billingPeriod,
      customBillingPeriodDays:
        input.billingPeriod === "custom" ? input.customBillingPeriodDays : undefined,
      serviceUrl: normalizeUrlInput(input.serviceUrl),
      icon: {
        mode: input.icon?.mode ?? "auto",
        emoji: input.icon?.emoji?.trim() || undefined,
      },
      createdOn: today,
      updatedOn: today,
    };

    this.data.subscriptions.push(item);
    await this.tryEnsureIcon(item);
    await this.saveData();
    this.notify();
  }

  async addCustomCurrency(input: CustomCurrencyInput): Promise<void> {
    const normalized = normalizeNewCustomCurrencyInput(input);
    if (!normalized) throw new Error("Enter valid custom currency details.");

    let code = createCustomCurrencyCode();
    while (this.currencyRegistry.get(code)) {
      code = createCustomCurrencyCode();
    }

    const currency: CurrencyMeta = {
      code,
      label: normalized.label,
      amountMarker: normalized.amountMarker,
      scale: normalized.scale,
      source: "custom",
    };
    this.assertUniqueCurrencyDisplay(currency);
    this.data.customCurrencies.push(currency);

    await this.saveData();
    this.notify();
  }

  async cleanupUnusedArchivedCustomCurrencies(): Promise<void> {
    const defaultChanged = this.ensureDefaultCurrencyValid();
    const pruned = this.pruneUnusedArchivedCustomCurrencies();
    if (!defaultChanged && !pruned) return;

    await this.saveData();
    this.notify();
  }

  async updateCustomCurrency(
    code: string,
    patch: Partial<CustomCurrencyInput>
  ): Promise<void> {
    const currency = this.findCustomCurrency(code);
    if (!currency) throw new Error("Custom currency not found.");

    const next = normalizeCustomCurrencyInput({
      label: patch.label ?? currency.label,
      amountMarker: patch.amountMarker ?? currency.amountMarker,
      scale: patch.scale ?? currency.scale,
    });
    if (!next) throw new Error("Enter valid custom currency details.");

    if (this.isCurrencyUsed(currency.code) && next.scale !== currency.scale) {
      throw new Error("Price format cannot be changed while this currency is used.");
    }
    const preservesLegacyScale =
      !isMvpCurrencyScale(currency.scale) && next.scale === currency.scale;
    if (!preservesLegacyScale && !isMvpCurrencyScale(next.scale)) {
      throw new Error("Price format must use whole numbers or decimals.");
    }

    this.assertUniqueCurrencyDisplay(
      {
        code: currency.code,
        label: next.label,
        amountMarker: next.amountMarker,
        scale: next.scale,
        source: "custom",
      },
      currency.code
    );

    currency.label = next.label;
    currency.amountMarker = next.amountMarker;
    currency.scale = next.scale;

    this.ensureDefaultCurrencyValid();
    await this.saveData();
    this.notify();
  }

  async archiveCustomCurrency(code: string): Promise<void> {
    const currency = this.findCustomCurrency(code);
    if (!currency) throw new Error("Custom currency not found.");
    currency.isArchived = true;
    this.ensureDefaultCurrencyValid();
    this.pruneUnusedArchivedCustomCurrencies();
    await this.saveData();
    this.notify();
  }

  async deleteCustomCurrency(code: string): Promise<void> {
    const currency = this.findCustomCurrency(code);
    if (!currency) throw new Error("Custom currency not found.");

    if (this.isCurrencyUsed(currency.code)) {
      currency.isArchived = true;
    } else {
      this.data.customCurrencies = this.data.customCurrencies.filter(
        (item) => normalizeCurrencyCode(item.code) !== normalizeCurrencyCode(currency.code)
      );
    }

    this.ensureDefaultCurrencyValid();
    await this.saveData();
    this.notify();
  }

  isCurrencyUsed(code: string): boolean {
    const normalized = normalizeCurrencyCode(code);
    return this.data.subscriptions.some(
      (item) => normalizeCurrencyCode(item.price.currencyCode) === normalized
    );
  }

  async updateSubscription(
    id: string,
    patch: UpdateSubscriptionInput
  ): Promise<void> {
    const item = this.findItem(id);
    if (!item) return;

    if (typeof patch.name === "string") {
      const name = patch.name.trim();
      if (!name) throw new Error("Subscription name is required.");
      item.name = name;
    }

    const nextCurrency = patch.currencyCode?.trim().toUpperCase() ?? item.price.currencyCode;
    if (typeof patch.priceText === "string" || patch.currencyCode) {
      const priceText =
        typeof patch.priceText === "string"
          ? patch.priceText
          : moneyToInputValue(item.price, this.currencyRegistry);
      const money = parseMoneyInput(priceText, nextCurrency, this.currencyRegistry);
      if (!money) throw new Error("Enter a valid price for the selected currency.");
      item.price = money;
    }

    if (patch.billingPeriod) {
      if (!isBillingPeriod(patch.billingPeriod)) {
        throw new Error("Select a valid billing period.");
      }
      item.billingPeriod = patch.billingPeriod;
      if (
        item.billingPeriod === "custom" &&
        !item.customBillingPeriodDays
      ) {
        item.customBillingPeriodDays = DEFAULT_CUSTOM_BILLING_PERIOD_DAYS;
      }
    }

    if (patch.startDate !== undefined) {
      const startDate = patch.startDate.trim()
        ? parseDateOnly(patch.startDate) ?? undefined
        : undefined;
      if (patch.startDate.trim() && !startDate) {
        throw new Error("Select a valid start date.");
      }
      item.startDate = startDate;
    }

    if (patch.customBillingPeriodDays !== undefined) {
      item.customBillingPeriodDays =
        patch.customBillingPeriodDays > 0 ? patch.customBillingPeriodDays : undefined;
    }
    if (item.billingPeriod !== "custom") {
      item.customBillingPeriodDays = undefined;
    }

    let shouldRefreshIcon = false;
    if (patch.serviceUrl !== undefined) {
      const serviceUrl = normalizeUrlInput(patch.serviceUrl);
      shouldRefreshIcon = serviceUrl !== item.serviceUrl;
      item.serviceUrl = serviceUrl;
      if (shouldRefreshIcon) this.iconService.clearIcon(item);
    }
    if (patch.icon) {
      item.icon = {
        ...item.icon,
        ...patch.icon,
        emoji: patch.icon.emoji?.trim() || undefined,
      };
      if (item.icon.mode !== "auto") {
        this.iconService.clearIcon(item);
      }
      shouldRefreshIcon = item.icon.mode === "auto";
    }

    item.updatedOn = todayLocalDate(this.clock);
    if (shouldRefreshIcon) await this.tryEnsureIcon(item);
    this.pruneUnusedArchivedCustomCurrencies();
    await this.saveData();
    this.notify();
  }

  async setSubscriptionEnabled(id: string, enabled: boolean): Promise<void> {
    const item = this.findItem(id);
    if (!item) return;

    if (enabled) {
      const gracePeriod = this.disableGracePeriods.get(id);
      if (gracePeriod) {
        window.clearTimeout(gracePeriod.timeoutId);
        this.disableGracePeriods.delete(id);
        this.notify();
        return;
      }

      if (item.status === "disabled") {
        item.status = "enabled";
        item.disabledOn = undefined;
        item.updatedOn = todayLocalDate(this.clock);
        await this.saveData();
        this.notify();
      }
      return;
    }

    if (item.status === "disabled" || this.disableGracePeriods.has(id)) return;

    const timeoutId = window.setTimeout(() => {
      this.disableGracePeriods.delete(id);
      if (!this.disableSubscriptionNow(id)) {
        this.notify();
        return;
      }
      void this.saveData().catch((e) => {
        console.error("Failed to save disabled subscription:", e);
        new Notice("Failed to save disabled subscription");
      });
      this.notify();
    }, DISABLE_GRACE_PERIOD_MS);

    this.disableGracePeriods.set(id, { subscriptionId: id, timeoutId });
    this.notify();
  }

  async deleteSubscription(id: string): Promise<void> {
    const gracePeriod = this.disableGracePeriods.get(id);
    if (gracePeriod) {
      window.clearTimeout(gracePeriod.timeoutId);
      this.disableGracePeriods.delete(id);
    }
    const before = this.data.subscriptions.length;
    this.data.subscriptions = this.data.subscriptions.filter((item) => item.id !== id);
    if (this.data.subscriptions.length !== before) {
      this.pruneUnusedArchivedCustomCurrencies();
      await this.saveData();
      this.notify();
    }
  }

  async refreshIcon(id: string): Promise<boolean> {
    const item = this.findItem(id);
    if (!item) return false;
    const refreshed = await this.tryRefreshIcon(item);
    if (refreshed) {
      item.updatedOn = todayLocalDate(this.clock);
      await this.saveData();
      this.notify();
    }
    return refreshed;
  }

  async refreshAllIcons(): Promise<IconRefreshSummary> {
    const summary: IconRefreshSummary = { refreshed: 0, failed: 0, skipped: 0 };
    const today = todayLocalDate(this.clock);

    for (const item of this.data.subscriptions) {
      if (item.icon.mode !== "auto" || !item.serviceUrl) {
        summary.skipped += 1;
        continue;
      }

      try {
        const refreshed = await this.iconService.refreshAutoIcon(item);
        if (!refreshed) {
          summary.skipped += 1;
          continue;
        }
        item.updatedOn = today;
        summary.refreshed += 1;
      } catch (e) {
        console.warn(`Failed to refresh subscription icon for ${item.name}:`, e);
        summary.failed += 1;
      }
    }

    if (summary.refreshed > 0) {
      await this.saveData();
      this.notify();
    }
    return summary;
  }

  async clearIcon(id: string): Promise<void> {
    const item = this.findItem(id);
    if (!item) return;
    this.iconService.clearIcon(item);
    item.updatedOn = todayLocalDate(this.clock);
    await this.saveData();
    this.notify();
  }

  getVisibleSubscriptions(): SubscriptionViewItem[] {
    const viewItems = this.data.subscriptions.map((item) => this.toViewItem(item));
    return sortByName(
      viewItems.filter(
        (item) =>
          item.effectiveStatus === "enabled" || this.data.settings.showDisabled
      )
    );
  }

  getEnabledSubscriptions(): SubscriptionItem[] {
    return sortByName(
      this.data.subscriptions.filter((item) => this.getEffectiveStatus(item) === "enabled")
    );
  }

  getDisabledSubscriptions(): SubscriptionViewItem[] {
    return sortByName(
      this.data.subscriptions
        .map((item) => this.toViewItem(item))
        .filter((item) => item.effectiveStatus === "disabled")
    );
  }

  getTotalsByCurrency(): MoneyTotal[] {
    return calculateTotalsByCurrency(this.getEnabledSubscriptions());
  }

  private async tryEnsureIcon(item: SubscriptionItem): Promise<void> {
    try {
      await this.iconService.ensureAutoIcon(item);
    } catch (e) {
      console.warn("Failed to fetch subscription icon:", e);
    }
  }

  private async tryRefreshIcon(item: SubscriptionItem): Promise<boolean> {
    try {
      return await this.iconService.refreshAutoIcon(item);
    } catch (e) {
      console.warn("Failed to refresh subscription icon:", e);
      return false;
    }
  }

  private disableSubscriptionNow(id: string): boolean {
    const current = this.findItem(id);
    if (!current || current.status === "disabled") return false;

    current.status = "disabled";
    current.disabledOn = todayLocalDate(this.clock);
    current.updatedOn = current.disabledOn;
    return true;
  }
}
