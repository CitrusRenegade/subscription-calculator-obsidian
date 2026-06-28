import { describe, expect, it } from "vitest";
import { SubscriptionStore } from "../src/data/SubscriptionStore";
import { createDefaultData } from "../src/data/defaultData";
import type { Clock } from "../src/date/Clock";
import type { IconService } from "../src/icons/IconService";
import { DataBackedCurrencyRegistry } from "../src/money/CurrencyRegistry";
import type { PluginData } from "../src/types";

function createStore(
  data: PluginData,
  saveData: () => Promise<void> = async () => undefined,
  clock: Clock = { now: () => new Date("2026-06-27T12:00:00Z") }
): SubscriptionStore {
  const registry = new DataBackedCurrencyRegistry(
    () => data.settings.defaultCurrency,
    () => data.customCurrencies
  );
  const iconService = {
    ensureAutoIcon: async () => undefined,
    refreshAutoIcon: async () => false,
    clearIcon: () => undefined,
    getCachedIcon: () => null,
  } as unknown as IconService;

  return new SubscriptionStore(data, registry, iconService, saveData, clock);
}

describe("subscription store", () => {
  it("can create disabled subscriptions that are excluded from totals", async () => {
    const data = createDefaultData();
    const store = createStore(data);

    await store.addSubscription({
      name: "Paused service",
      priceText: "20",
      currencyCode: "USD",
      billingPeriod: "monthly",
      status: "disabled",
    });

    expect(data.subscriptions[0]).toMatchObject({
      name: "Paused service",
      status: "disabled",
    });
    expect(data.subscriptions[0]?.disabledOn).toBeUndefined();
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
    expect(store.getTotalsByCurrency()).toEqual([]);
  });
});
