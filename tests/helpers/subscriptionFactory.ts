import { createDefaultData } from "../../src/data/defaultData";
import type { PluginData, SubscriptionItem, SubscriptionStatus, SubscriptionViewItem } from "../../src/types";

/** Minimal valid subscription with shared defaults; tests pass only the fields that matter to them. */
export function sub(
  overrides: Partial<SubscriptionItem> & { id: string } & Record<string, unknown>
): SubscriptionItem {
  return {
    name: overrides.id,
    status: "enabled",
    price: { amountMinor: 1000, currencyCode: "USD" },
    billingPeriod: "monthly",
    icon: { mode: "none" },
    createdOn: "2026-06-01",
    updatedOn: "2026-06-01",
    ...overrides,
  };
}

/** `sub` extended with the two view-only status fields. */
export function viewItem(
  id: string,
  overrides: Partial<SubscriptionViewItem> = {}
): SubscriptionViewItem {
  return {
    ...sub({ ...overrides, id }),
    effectiveStatus: overrides.effectiveStatus ?? "enabled",
    inDisableGracePeriod: overrides.inDisableGracePeriod ?? false,
  };
}

/** The canonical CLI/store command test record shared by both command suites. */
export function buildData(
  options: { status?: SubscriptionStatus; disabledOn?: string; currencyCode?: string } = {}
): PluginData {
  const data = createDefaultData();
  data.subscriptions.push({
    id: "ab1",
    name: "Old name",
    status: options.status ?? "enabled",
    price: { amountMinor: 2000, currencyCode: options.currencyCode ?? "USD" },
    billingPeriod: "monthly",
    serviceUrl: "https://old.example.com/",
    icon: { mode: "none" },
    createdOn: "2026-01-01",
    updatedOn: "2026-01-01",
    ...(options.disabledOn ? { disabledOn: options.disabledOn } : {}),
  });
  return data;
}
