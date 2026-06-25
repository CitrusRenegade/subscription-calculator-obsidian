import { describe, expect, it } from "vitest";
import { SubscriptionStore } from "../src/data/SubscriptionStore";
import { createDefaultData } from "../src/data/defaultData";
import type { IconService } from "../src/icons/IconService";
import { DataBackedCurrencyRegistry } from "../src/money/CurrencyRegistry";
import type { CurrencyMeta, PluginData, SubscriptionItem } from "../src/types";

const customCurrency: CurrencyMeta = {
  code: "CUSTOM_AB12CD",
  label: "TOK",
  amountMarker: "🪙",
  scale: 2,
  source: "custom",
};

function createSubscription(currencyCode: string): SubscriptionItem {
  return {
    id: "item-1",
    name: "Token Service",
    status: "enabled",
    price: { amountMinor: 1999, currencyCode },
    startDate: "2026-06-16",
    billingPeriod: "monthly",
    icon: { mode: "none" },
    createdOn: "2026-06-16",
    updatedOn: "2026-06-16",
  };
}

function createStore(data: PluginData): SubscriptionStore {
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

  return new SubscriptionStore(data, registry, iconService, async () => undefined);
}

describe("custom currency store rules", () => {
  it("adds custom currencies with stable internal codes", async () => {
    const data = createDefaultData();
    const store = createStore(data);

    await store.addCustomCurrency({
      label: "tok",
      amountMarker: "🪙",
      scale: 2,
    });

    expect(data.customCurrencies).toHaveLength(1);
    expect(data.customCurrencies[0]).toMatchObject({
      label: "TOK",
      amountMarker: "🪙",
      scale: 2,
      source: "custom",
    });
    expect(data.customCurrencies[0]?.code).toMatch(/^CUSTOM_[A-Z0-9]+$/);
  });

  it("archives used custom currencies instead of deleting metadata", async () => {
    const data = createDefaultData();
    data.customCurrencies = [{ ...customCurrency }];
    data.subscriptions = [createSubscription(customCurrency.code)];
    const store = createStore(data);

    await store.deleteCustomCurrency(customCurrency.code);

    expect(data.customCurrencies).toHaveLength(1);
    expect(data.customCurrencies[0]?.isArchived).toBe(true);
  });

  it("physically deletes unused custom currencies", async () => {
    const data = createDefaultData();
    data.customCurrencies = [{ ...customCurrency }];
    const store = createStore(data);

    await store.deleteCustomCurrency(customCurrency.code);

    expect(data.customCurrencies).toHaveLength(0);
  });

  it("does not allow scale changes while a custom currency is used", async () => {
    const data = createDefaultData();
    data.customCurrencies = [{ ...customCurrency }];
    data.subscriptions = [createSubscription(customCurrency.code)];
    const store = createStore(data);

    await expect(
      store.updateCustomCurrency(customCurrency.code, { scale: 0 })
    ).rejects.toThrow("Price format cannot be changed");
    expect(data.customCurrencies[0]?.scale).toBe(2);
  });

  it("resets a custom default currency when it is archived", async () => {
    const data = createDefaultData();
    data.customCurrencies = [{ ...customCurrency }];
    data.settings.defaultCurrency = customCurrency.code;
    data.subscriptions = [createSubscription(customCurrency.code)];
    const store = createStore(data);

    await store.deleteCustomCurrency(customCurrency.code);

    expect(data.settings.defaultCurrency).toBe("USD");
    expect(data.customCurrencies[0]?.isArchived).toBe(true);
  });

  it("cleans up archived unused currencies on startup", async () => {
    const data = createDefaultData();
    data.customCurrencies = [
      { ...customCurrency, isArchived: true },
      { ...customCurrency, code: "CUSTOM_USED", isArchived: true },
    ];
    data.subscriptions = [createSubscription("CUSTOM_USED")];
    const store = createStore(data);

    await store.cleanupUnusedArchivedCustomCurrencies();

    expect(data.customCurrencies.map((currency) => currency.code)).toEqual([
      "CUSTOM_USED",
    ]);
  });

  it("deletes archived currencies when their last subscription is deleted", async () => {
    const data = createDefaultData();
    data.customCurrencies = [{ ...customCurrency, isArchived: true }];
    data.subscriptions = [createSubscription(customCurrency.code)];
    const store = createStore(data);

    await store.deleteSubscription("item-1");

    expect(data.customCurrencies).toHaveLength(0);
  });

  it("deletes archived currencies when subscriptions move away from them", async () => {
    const data = createDefaultData();
    data.customCurrencies = [{ ...customCurrency, isArchived: true }];
    data.subscriptions = [createSubscription(customCurrency.code)];
    const store = createStore(data);

    await store.updateSubscription("item-1", {
      priceText: "19.99",
      currencyCode: "USD",
    });

    expect(data.customCurrencies).toHaveLength(0);
    expect(data.subscriptions[0]?.price.currencyCode).toBe("USD");
  });
});
