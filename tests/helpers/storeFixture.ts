import { SubscriptionStore } from "../../src/data/SubscriptionStore";
import { createDefaultData } from "../../src/data/defaultData";
import { IconService } from "../../src/icons/IconService";
import { DataBackedCurrencyRegistry } from "../../src/money/CurrencyRegistry";
import type { Clock } from "../../src/date/Clock";
import type { PluginData } from "../../src/types";

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
