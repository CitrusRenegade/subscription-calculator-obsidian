import { afterEach, vi } from "vitest";
import { SubscriptionStore } from "../../src/data/SubscriptionStore";
import { createDefaultData } from "../../src/data/defaultData";
import { IconService } from "../../src/icons/IconService";
import { DataBackedCurrencyRegistry } from "../../src/money/CurrencyRegistry";
import type { Clock } from "../../src/date/Clock";
import type { PluginData } from "../../src/types";
import { deferred } from "./deferred";

const cleanupModes = new WeakMap<SubscriptionStore, () => void>();

export function storeFixture(
  data: PluginData = createDefaultData(),
  save: () => Promise<void> = async () => undefined,
  clock?: Clock
) {
  const registry = new DataBackedCurrencyRegistry(
    () => data.settings.defaultCurrency, () => data.customCurrencies
  );
  const icons = new IconService(data, () => data.settings.faviconProvider);
  let cleaningUp = false;
  const store = new SubscriptionStore(data, registry, icons,
    () => cleaningUp ? Promise.resolve() : save(), clock);
  cleanupModes.set(store, () => { cleaningUp = true; });
  return { data, registry, icons, store };
}

/** Settle test-owned gates before draining and disposing their stores. */
export async function disposeStores(
  stores: SubscriptionStore[],
  releases: Array<() => void> = [],
  jobs: Promise<unknown>[] = []
): Promise<void> {
  for (const store of stores) cleanupModes.get(store)?.();
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(jobs.splice(0));
  for (const store of stores.splice(0)) {
    // Assertions are over; disposal must not start another gated/failing test save.
    await store.readSnapshot();
    store.dispose();
    await store.readSnapshot();
  }
}

/** Own a concurrent operation without changing the rejection asserted by its test. */
export function ownStoreJob<T>(jobs: Promise<unknown>[], job: Promise<T>): Promise<T> {
  jobs.push(job);
  void job.catch(() => undefined);
  return job;
}

/** Gates the save at `ordinal` (1-based) behind an explicit test-owned gate; other saves pass through. */
export function saveGate(releases: Array<() => void>, ordinal: number) {
  const started = deferred<void>();
  const gate = deferred<void>();
  releases.push(() => gate.resolve());
  let calls = 0;
  return {
    started: started.promise,
    save: async () => {
      calls += 1;
      if (calls !== ordinal) return;
      started.resolve();
      await gate.promise;
    },
    open: () => gate.resolve(),
    fail: (reason?: unknown) => gate.reject(reason ?? new Error("disk full")),
    get calls() { return calls; },
  };
}

/** Blocks the first save behind an explicit test-owned gate; later saves pass through. */
export function primaryGate(releases: Array<() => void>) {
  return saveGate(releases, 1);
}

/** Gates the first `count` saves individually behind explicit test-owned gates. */
export function gatedSaves(releases: Array<() => void>, count: number) {
  const started = Array.from({ length: count }, () => deferred<void>());
  const gates = Array.from({ length: count }, () => deferred<void>());
  gates.forEach((gate) => releases.push(() => gate.resolve()));
  let saveCount = 0;
  return {
    started: started.map((gate) => gate.promise),
    open: (index: number) => gates[index]?.resolve(),
    fail: (index: number, reason?: unknown) => gates[index]?.reject(reason ?? new Error("disk full")),
    save: async () => {
      const index = saveCount;
      saveCount += 1;
      if (index >= count || !started[index] || !gates[index]) return;
      started[index].resolve();
      await gates[index].promise;
    },
    get calls() { return saveCount; },
  };
}

/** Saves pass through until `arm()`, then wait until `open()`/`fail()` settle the gate. */
export function manualGate(releases: Array<() => void>) {
  const started = deferred<void>();
  const gate = deferred<void>();
  releases.push(() => gate.resolve());
  let armed = false;
  return {
    started: started.promise,
    save: async () => {
      if (!armed) return;
      started.resolve();
      await gate.promise;
    },
    arm: () => { armed = true; },
    open: () => gate.resolve(),
    fail: (reason?: unknown) => gate.reject(reason ?? new Error("disk full")),
  };
}

/** Per-file store-test harness: shared registries plus the unified teardown every store suite needs. */
export function storeTest() {
  const stores: SubscriptionStore[] = [];
  const pendingReleases: Array<() => void> = [];
  const jobs: Promise<unknown>[] = [];
  afterEach(async () => {
    try { await disposeStores(stores, pendingReleases, jobs); }
    finally { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
  });
  const fixture = (...args: Parameters<typeof storeFixture>) => {
    const f = storeFixture(...args);
    stores.push(f.store);
    return f;
  };
  return { stores, pendingReleases, jobs, fixture };
}
