import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackup } from "../src/data/backup";
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
    vi.restoreAllMocks();
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

  it("rejects an invalid custom period update without discarding its saved days", async () => {
    const data = createDefaultData();
    const store = createStore(data);
    await store.addSubscription({
      name: "Custom service",
      priceText: "20",
      currencyCode: "USD",
      billingPeriod: "custom",
      customBillingPeriodDays: 30,
    });

    await expect(
      store.updateSubscription(data.subscriptions[0]?.id ?? "", {
        customBillingPeriodDays: 0,
      })
    ).rejects.toThrow("Custom billing period must be greater than 0 days.");

    expect(data.subscriptions[0]?.customBillingPeriodDays).toBe(30);
  });

  it("rolls a subscription back when its updated data cannot be saved", async () => {
    const data = createDefaultData();
    let saveFails = false;
    const store = createStore(data, async () => {
      if (saveFails) throw new Error("disk full");
    });
    await store.addSubscription({
      name: "Reliable service",
      priceText: "20",
      currencyCode: "USD",
      billingPeriod: "monthly",
    });

    saveFails = true;
    await expect(
      store.updateSubscription(data.subscriptions[0]?.id ?? "", { priceText: "30" })
    ).rejects.toThrow("disk full");

    expect(data.subscriptions[0]?.price.amountMinor).toBe(2000);
  });

  it("does not roll back a later update when an earlier save fails", async () => {
    const data = createDefaultData();
    let saveCount = 0;
    let rejectFirstUpdate: ((reason?: unknown) => void) | undefined;
    let signalFirstUpdateSave: (() => void) | undefined;
    const firstUpdateSaveStarted = new Promise<void>((resolve) => {
      signalFirstUpdateSave = resolve;
    });
    const store = createStore(data, async () => {
      saveCount += 1;
      if (saveCount !== 2) return;
      await new Promise<void>((_resolve, reject) => {
        rejectFirstUpdate = reject;
        signalFirstUpdateSave?.();
      });
    });
    await store.addSubscription({
      name: "Reliable service",
      priceText: "20",
      currencyCode: "USD",
      billingPeriod: "monthly",
    });
    const id = data.subscriptions[0]?.id ?? "";

    const firstUpdate = store.updateSubscription(id, { priceText: "30" });
    const secondUpdate = store.updateSubscription(id, { name: "Renamed service" });
    await firstUpdateSaveStarted;
    rejectFirstUpdate?.(new Error("disk full"));

    await expect(firstUpdate).rejects.toThrow("disk full");
    await secondUpdate;

    expect(data.subscriptions[0]).toMatchObject({
      name: "Renamed service",
      price: { amountMinor: 2000, currencyCode: "USD" },
    });
  });

  it("keeps restored data when a prior queued save fails", async () => {
    const data = createDefaultData();
    let saveCount = 0;
    let rejectUpdateSave: ((reason?: unknown) => void) | undefined;
    let signalUpdateSave: (() => void) | undefined;
    const updateSaveStarted = new Promise<void>((resolve) => {
      signalUpdateSave = resolve;
    });
    const store = createStore(data, async () => {
      saveCount += 1;
      if (saveCount !== 2) return;
      await new Promise<void>((_resolve, reject) => {
        rejectUpdateSave = reject;
        signalUpdateSave?.();
      });
    });
    await store.addSubscription({
      name: "Current service",
      priceText: "20",
      currencyCode: "USD",
      billingPeriod: "monthly",
    });
    const updated = store.updateSubscription(data.subscriptions[0]?.id ?? "", {
      priceText: "30",
    });
    await updateSaveStarted;

    const replacement = createDefaultData();
    replacement.settings.defaultCurrency = "EUR";
    const restored = store.restoreBackupJson(
      JSON.stringify(createBackup(replacement)),
      () => true
    );
    rejectUpdateSave?.(new Error("disk full"));

    await expect(updated).rejects.toThrow("disk full");
    await restored;
    expect(data.settings.defaultCurrency).toBe("EUR");
    expect(data.subscriptions).toEqual([]);
  });

  it("keeps committed data when a listener throws", async () => {
    const data = createDefaultData();
    const store = createStore(data);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.subscribe(() => {
      throw new Error("render failed");
    });

    await store.addSubscription({
      name: "Reliable service",
      priceText: "20",
      currencyCode: "USD",
      billingPeriod: "monthly",
    });

    expect(data.subscriptions[0]?.name).toBe("Reliable service");
    expect(error).toHaveBeenCalledWith(
      "Subscription view listener failed:",
      expect.any(Error)
    );
  });

  it("rolls settings back when they cannot be saved", async () => {
    const data = createDefaultData();
    const store = createStore(data, async () => {
      throw new Error("disk full");
    });

    await expect(
      store.updateSettings((settings) => {
        settings.showDisabled = true;
      })
    ).rejects.toThrow("disk full");

    expect(data.settings.showDisabled).toBe(false);
  });

  it("does not retain a new subscription when its first save fails", async () => {
    const data = createDefaultData();
    const store = createStore(data, async () => {
      throw new Error("disk full");
    });

    await expect(
      store.addSubscription({
        name: "Unsaved service",
        priceText: "20",
        currencyCode: "USD",
        billingPeriod: "monthly",
      })
    ).rejects.toThrow("disk full");

    expect(data.subscriptions).toEqual([]);
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

  it("restores a pending disable when deleting it cannot be saved", async () => {
    const setTimeout = vi.fn(() => 1);
    const clearTimeout = vi.fn();
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const data = createDefaultData();
    let saveFails = false;
    const store = createStore(data, async () => {
      if (saveFails) throw new Error("disk full");
    });
    await store.addSubscription({
      name: "Pending delete",
      priceText: "20",
      currencyCode: "USD",
      billingPeriod: "monthly",
    });
    const id = data.subscriptions[0].id;
    await store.setSubscriptionEnabled(id, false);
    saveFails = true;

    await expect(store.deleteSubscription(id)).rejects.toThrow("disk full");

    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
    expect(setTimeout).toHaveBeenCalledTimes(2);
  });

  it("keeps a later enable when the grace timer fires behind a busy write queue", async () => {
    const timerCallbacks: Array<() => void> = [];
    const setTimeout = vi.fn((callback: () => void) => {
      timerCallbacks.push(callback);
      return timerCallbacks.length;
    });
    const clearTimeout = vi.fn();
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const data = createDefaultData();
    let saveCount = 0;
    let releaseBusySave: (() => void) | undefined;
    let signalBusySave: (() => void) | undefined;
    const busySaveStarted = new Promise<void>((resolve) => {
      signalBusySave = resolve;
    });
    const busySaveFinished = new Promise<void>((resolve) => {
      releaseBusySave = resolve;
    });
    const store = createStore(data, async () => {
      saveCount += 1;
      if (saveCount !== 2) return;
      signalBusySave?.();
      await busySaveFinished;
    });
    await store.addSubscription({
      name: "Queued enable",
      priceText: "20",
      currencyCode: "USD",
      billingPeriod: "monthly",
    });
    const id = data.subscriptions[0].id;
    const busyUpdate = store.updateSubscription(id, { name: "Still queued" });
    await busySaveStarted;

    await store.setSubscriptionEnabled(id, false);
    const enabling = store.setSubscriptionEnabled(id, true);
    timerCallbacks[0]?.();
    releaseBusySave?.();

    await busyUpdate;
    await enabling;

    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
  });

  it("flushes a pending disable even when the store is disposed immediately", async () => {
    const setTimeout = vi.fn(() => 1);
    const clearTimeout = vi.fn();
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const data = createDefaultData();
    const store = createStore(data);
    await store.addSubscription({
      name: "Pending disable",
      priceText: "20",
      currencyCode: "USD",
      billingPeriod: "monthly",
    });

    await store.setSubscriptionEnabled(data.subscriptions[0].id, false);
    const flushing = store.flushDisableGracePeriods();
    store.dispose();
    await flushing;

    expect(data.subscriptions[0]?.status).toBe("disabled");
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
    const enabling = store.setSubscriptionEnabled(id, true);
    rejectFlushSave?.(new Error("disk full"));

    await expect(flushing).rejects.toThrow("disk full");
    await enabling;
    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
    expect(setTimeout).toHaveBeenCalledTimes(1);
  });

  it("rolls a queued enable back when it cannot be saved after a flush", async () => {
    const setTimeout = vi.fn(() => 1);
    const clearTimeout = vi.fn();
    vi.stubGlobal("window", { setTimeout, clearTimeout });

    const data = createDefaultData();
    let saveCount = 0;
    let finishFlushSave: (() => void) | undefined;
    const flushSaveFinished = new Promise<void>((resolve) => {
      finishFlushSave = resolve;
    });
    const store = createStore(data, async () => {
      saveCount += 1;
      if (saveCount === 2) {
        await flushSaveFinished;
        return;
      }
      if (saveCount === 3) throw new Error("enable save failed");
    });
    await store.addSubscription({
      name: "Pending disable",
      priceText: "20",
      currencyCode: "USD",
      billingPeriod: "monthly",
    });
    const id = data.subscriptions[0].id;
    await store.setSubscriptionEnabled(id, false);

    const flushing = store.flushDisableGracePeriods();
    await Promise.resolve();
    const enabling = store.setSubscriptionEnabled(id, true);
    finishFlushSave?.();

    await flushing;
    await expect(enabling).rejects.toThrow("enable save failed");
    expect(data.subscriptions[0]?.status).toBe("disabled");
  });
});
