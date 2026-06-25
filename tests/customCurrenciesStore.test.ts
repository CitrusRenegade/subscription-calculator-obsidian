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

function createStore(
  data: PluginData,
  saveData: () => Promise<void> = async () => undefined
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

  return new SubscriptionStore(data, registry, iconService, saveData);
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

  it("only creates custom currencies with MVP price formats", async () => {
    const data = createDefaultData();
    const store = createStore(data);

    await expect(
      store.addCustomCurrency({
        label: "tok",
        amountMarker: "🪙",
        scale: 8,
      })
    ).rejects.toThrow("Enter valid custom currency details.");
    expect(data.customCurrencies).toHaveLength(0);
  });

  it("does not allow duplicate visible currency labels", async () => {
    const data = createDefaultData();
    const store = createStore(data);

    await expect(
      store.addCustomCurrency({
        label: "usd",
        amountMarker: "$",
        scale: 2,
      })
    ).rejects.toThrow("A currency with this label already exists.");
    expect(data.customCurrencies).toHaveLength(0);
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

  it("does not allow unused MVP currencies to switch to advanced precision", async () => {
    const data = createDefaultData();
    data.customCurrencies = [{ ...customCurrency }];
    const store = createStore(data);

    await expect(
      store.updateCustomCurrency(customCurrency.code, { scale: 8 })
    ).rejects.toThrow("Price format must use whole numbers or decimals.");
    expect(data.customCurrencies[0]?.scale).toBe(2);
  });

  it("preserves legacy advanced precision while editing labels", async () => {
    const data = createDefaultData();
    data.customCurrencies = [{ ...customCurrency, scale: 8 }];
    const store = createStore(data);

    await store.updateCustomCurrency(customCurrency.code, { label: "coin" });

    expect(data.customCurrencies[0]).toMatchObject({
      label: "COIN",
      scale: 8,
    });
  });

  it("does not allow updates to duplicate visible currency labels", async () => {
    const data = createDefaultData();
    data.customCurrencies = [{ ...customCurrency }];
    const store = createStore(data);

    await expect(
      store.updateCustomCurrency(customCurrency.code, {
        label: "usd",
        amountMarker: "$",
      })
    ).rejects.toThrow("A currency with this label already exists.");
    expect(data.customCurrencies[0]?.label).toBe("TOK");
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

  it("saves when cleanup only resets an archived default currency", async () => {
    const data = createDefaultData();
    let saveCount = 0;
    data.customCurrencies = [{ ...customCurrency, isArchived: true }];
    data.settings.defaultCurrency = customCurrency.code;
    data.subscriptions = [createSubscription(customCurrency.code)];
    const store = createStore(data, async () => {
      saveCount += 1;
    });

    await store.cleanupUnusedArchivedCustomCurrencies();

    expect(data.settings.defaultCurrency).toBe("USD");
    expect(data.customCurrencies).toHaveLength(1);
    expect(saveCount).toBe(1);
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
