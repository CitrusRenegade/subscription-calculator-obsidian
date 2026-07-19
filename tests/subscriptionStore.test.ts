import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("keeps a pending disable when flushing it cannot be saved", async () => {
    const setTimeout = vi.fn(() => 1);
    const clearTimeout = vi.fn();
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const data = createDefaultData();
    let saveFails = false;
    const store = createStore(data, async () => {
      if (saveFails) throw new Error("disk full");
    });
    await store.addSubscription({
      name: "Pending disable",
      priceText: "20",
      currencyCode: "USD",
      billingPeriod: "monthly",
    });

    await store.setSubscriptionEnabled(data.subscriptions[0].id, false);
    saveFails = true;

    await expect(store.flushDisableGracePeriods()).rejects.toThrow("disk full");

    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
    expect(setTimeout).toHaveBeenCalledTimes(2);
  });

  it("does not restore a pending disable after a newer enable during a failed flush", async () => {
    const setTimeout = vi.fn(() => 1);
    const clearTimeout = vi.fn();
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const data = createDefaultData();
    let rejectFlushSave: ((reason?: unknown) => void) | undefined;
    let saveCount = 0;
    const store = createStore(data, async () => {
      saveCount += 1;
      if (saveCount !== 2) return;
      await new Promise<void>((_resolve, reject) => {
        rejectFlushSave = reject;
      });
    });
    await store.addSubscription({
      name: "Concurrent enable",
      priceText: "20",
      currencyCode: "USD",
      billingPeriod: "monthly",
    });
    const id = data.subscriptions[0].id;
    await store.setSubscriptionEnabled(id, false);

    const flushing = store.flushDisableGracePeriods();
    await Promise.resolve();
    await store.setSubscriptionEnabled(id, true);
    rejectFlushSave?.(new Error("disk full"));

    await expect(flushing).rejects.toThrow("disk full");
    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
    expect(setTimeout).toHaveBeenCalledTimes(1);
  });
});
