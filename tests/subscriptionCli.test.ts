import { afterEach, describe, expect, it, vi } from "vitest";
import { exportBackup, querySubscriptions } from "../src/cli/subscriptions";
import { parseBackup } from "../src/data/backup";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import { disposeStores, ownStoreJob, storeFixture } from "./helpers/storeFixture";
import { deferred } from "./helpers/deferred";

const stores: SubscriptionStore[] = [];
const pendingReleases: Array<() => void> = [];
const jobs: Promise<unknown>[] = [];

function setup(save: () => Promise<void> = async () => undefined) {
  const { data, registry, store } = storeFixture(undefined, save);
  stores.push(store);
  const add = (name: string, status: "enabled" | "disabled" = "enabled") => store.addSubscription({
    name, status, priceText: "12.34", currencyCode: "USD", billingPeriod: "monthly", icon: { mode: "none" },
  });
  return { data, registry, store, add };
}

describe("subscription CLI", () => {
  afterEach(async () => {
    try { await disposeStores(stores, pendingReleases, jobs); }
    finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });

  it("lists only names and full IDs, including hidden disabled subscriptions", async () => {
    const { data, registry, store, add } = setup();
    await add("Netflix"); await add("YouTube", "disabled");
    data.subscriptions[0].id = "12345678-1234-1234-1234-123456789abc";
    data.subscriptions[1].id = "87654321-4321-4321-4321-cba987654321";
    data.settings.showDisabled = false;
    expect(await querySubscriptions("list", {}, store, registry)).toBe([
      "Name     ID",
      "Netflix  12345678-1234-1234-1234-123456789abc",
      "YouTube  87654321-4321-4321-4321-cba987654321",
    ].join("\n"));
    expect(await querySubscriptions("list", { status: "disabled", currency: "usd" }, store, registry)).toBe(
      "Name     ID\nYouTube  87654321-4321-4321-4321-cba987654321"
    );
  });

  it("reads exact names and IDs as human-readable details", async () => {
    const { data, registry, store, add } = setup();
    await add("Netflix family"); data.subscriptions[0].id = "full-id";
    const expected = "Netflix family\nID: full-id\nStatus: enabled\nPrice: 12.34 USD (monthly)";
    expect(await querySubscriptions("get", { name: "NETFLIX FAMILY" }, store, registry)).toBe(expected);
    expect(await querySubscriptions("get", { id: "full-id" }, store, registry)).toBe(expected);
  });

  it("shows ambiguous names with full candidate IDs", async () => {
    const { data, registry, store, add } = setup();
    await add("Same"); await add("same");
    data.subscriptions[0].id = "a"; data.subscriptions[1].id = "b";
    expect(await querySubscriptions("get", { name: "same" }, store, registry)).toBe(
      "Error: Several subscriptions have this name. Specify id.\nName  ID\nSame  a\nsame  b"
    );
  });

  it("reports empty results and invalid flags as readable messages", async () => {
    const { registry, store } = setup();
    expect(await querySubscriptions("list", {}, store, registry)).toBe("No subscriptions found.");
    expect(await querySubscriptions("get", {}, store, registry)).toBe("Error: Specify either id or name.");
    expect(await querySubscriptions("get", { name: "x", id: "y" }, store, registry)).toBe("Error: Specify either id or name.");
    expect(await querySubscriptions("get", { id: "missing" }, store, registry)).toBe("Error: Subscription not found.");
    expect(await querySubscriptions("list", { query: "Netflix" }, store, registry)).toBe("Error: Unknown parameter: query.");
    expect(await querySubscriptions("list", { format: "json" }, store, registry)).toBe("Error: Unknown parameter: format.");
    expect(await querySubscriptions("list", { status: "maybe" }, store, registry)).toBe("Error: status must be enabled or disabled.");
    expect(await querySubscriptions("list", { currency: "invalid" }, store, registry)).toBe("Error: Unknown currency.");
  });

  it("neutralizes control characters in list and detail output", async () => {
    const { data, registry, store, add } = setup();
    await add("Name\nwith\ttabs"); data.subscriptions[0].id = "full-id";
    expect(await querySubscriptions("list", {}, store, registry)).toBe("Name            ID\nName with tabs  full-id");
    expect(await querySubscriptions("get", { id: "full-id" }, store, registry)).toBe(
      "Name with tabs\nID: full-id\nStatus: enabled\nPrice: 12.34 USD (monthly)"
    );
  });

  it("preserves currency scale, custom periods, dates and URL in readable details", async () => {
    const { registry, store } = setup();
    await store.addSubscription({ name: "Japanese service", priceText: "1234", currencyCode: "JPY",
      billingPeriod: "custom", customBillingPeriodDays: 10, startDate: "2026-01-01", serviceUrl: "https://example.com", icon: { mode: "none" } });
    const output = await querySubscriptions("get", { name: "Japanese service" }, store, registry);
    expect(output).toContain("Price: 1234 JPY (every 10 days)");
    expect(output).toContain("Start date: 2026-01-01");
    expect(output).toContain("URL: https://example.com");
  });

  it("prints large minor-unit amounts exactly and keeps Unicode output on one line", async () => {
    const { data, registry, store, add } = setup();
    await add("Service");
    data.subscriptions[0].price.amountMinor = 9007199254740990;
    data.subscriptions[0].name = "Service\u202eabc\u2028next\u2069 👩‍💻";
    const output = await querySubscriptions("get", { id: data.subscriptions[0].id }, store, registry);
    expect(output).toContain("Price: 90071992547409.90 USD (monthly)");
    expect(output.split("\n")[0]).toBe("Service abc next  👩‍💻");
  });

  it("keeps pending-disable details distinct from backup status without consuming undo", async () => {
    vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout, clearTimeout });
    const save = vi.fn(async () => undefined);
    const { data, registry, store, add } = setup(save);
    await add("Привет 😀"); const id = data.subscriptions[0].id;
    await store.setSubscriptionEnabled(id, false); const before = save.mock.calls.length;
    expect(await querySubscriptions("get", { id }, store, registry)).toContain("Status: disabled (pending disable; undo available)");
    expect(parseBackup(await exportBackup(store)).data.subscriptions[0].status).toBe("enabled");
    expect(save).toHaveBeenCalledTimes(before);
    await store.setSubscriptionEnabled(id, true);
    expect(await querySubscriptions("get", { id }, store, registry)).toContain("Status: enabled\n");

  });

  it("keeps an expired disable effective while its save waits in the queue", async () => {
    vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout, clearTimeout });
    const savingStarted = deferred<void>();
    const savingGate = deferred<void>();
    pendingReleases.push(() => savingGate.resolve());
    let blocked = false;
    const { data, registry, store, add } = setup(() => {
      if (!blocked) return Promise.resolve();
      savingStarted.resolve();
      return savingGate.promise;
    });
    await add("Pending"); const id = data.subscriptions[0].id;
    await store.setSubscriptionEnabled(id, false);
    blocked = true;
    const saving = ownStoreJob(jobs, store.updateSettings((settings) => { settings.showDisabled = false; }));
    await savingStarted.promise;
    const reading = ownStoreJob(jobs, querySubscriptions("get", { id }, store, registry));
    await vi.advanceTimersByTimeAsync(1500);
    blocked = false; savingGate.resolve(); await saving;
    expect(await reading).toContain("Status: disabled");
    expect(await querySubscriptions("get", { id }, store, registry)).toContain("Status: disabled\n");

  });

  it("filters currencies and restores exported settings, custom currencies and IDs without caches", async () => {
    const { data, registry, store, add } = setup();
    await add("USD enabled"); await add("USD disabled", "disabled");
    await store.addSubscription({ name: "EUR enabled", priceText: "9", currencyCode: "EUR",
      billingPeriod: "yearly", icon: { mode: "none" } });
    data.customCurrencies.push({ code: "TOK", label: "TOKEN", amountMarker: undefined, scale: 2, source: "custom", isArchived: true });
    data.subscriptions[1].price.currencyCode = "TOK";
    data.subscriptions[1].icon = { mode: "auto", cacheKey: "private-cache" };
    data.iconCache["private-cache"] = { cacheKey: "private-cache", sourceUrl: "https://example.com/icon", serviceDomain: "example.com", dataUrl: "private", contentType: "image/png", fetchedOn: "2026-01-01" };
    const filtered = await querySubscriptions("list", { status: "enabled", currency: "usd" }, store, registry);
    expect(filtered).toContain("USD enabled");
    expect(filtered).not.toContain("EUR enabled");
    expect(filtered).not.toContain("USD disabled");
    expect(await querySubscriptions("list", { status: "disabled", currency: "TOK" }, store, registry)).toContain("USD disabled");
    expect(await querySubscriptions("get", { name: "USD disabled" }, store, registry)).toContain("Price: 12.34 TOK");
    data.settings.showDisabled = false;
    const backup = await exportBackup(store);
    expect(backup).not.toContain("private-cache");
    expect(backup).not.toContain("iconCache");
    const parsed = parseBackup(backup);
    expect(parsed.data.settings).toEqual(data.settings);
    expect(parsed.data.customCurrencies).toEqual(data.customCurrencies);
    expect(parsed.data.subscriptions.map((item) => item.id)).toEqual(data.subscriptions.map((item) => item.id));
    const target = setup();
    await target.store.restoreBackupJson(backup, () => true);
    expect(await target.store.readSnapshot()).toMatchObject({ data: parsed.data });
  });

  it.each([
    ["edit", false], ["edit", true], ["delete", false], ["delete", true],
    ["restore", false], ["restore", true],
  ] as const)("reads and exports settled %s state after save failure=%s", async (kind, fails) => {
    const savingStarted = deferred<void>();
    const savingGate = deferred<void>();
    pendingReleases.push(() => savingGate.resolve());
    let blocked = false;
    const { data, registry, store, add } = setup(() => {
      if (!blocked) return Promise.resolve();
      savingStarted.resolve();
      return savingGate.promise;
    });
    await add("Original"); const id = data.subscriptions[0].id;
    const replacement = setup(); await replacement.add("Replacement");
    const replacementBackup = await exportBackup(replacement.store);
    blocked = true;
    const mutation = kind === "edit" ? store.updateSubscription(id, { name: "Edited" })
      : kind === "delete" ? store.deleteSubscription(id)
      : store.restoreBackupJson(replacementBackup, () => true);
    const outcome = mutation.catch((error: unknown) => error);
    jobs.push(outcome);
    await savingStarted.promise;
    const listing = ownStoreJob(jobs, querySubscriptions("list", {}, store, registry));
    const exporting = ownStoreJob(jobs, exportBackup(store));
    if (fails) savingGate.reject(new Error("disk full"));
    else savingGate.resolve();
    await outcome;
    const expectedName = fails ? "Original" : kind === "edit" ? "Edited" : kind === "restore" ? "Replacement" : undefined;
    expect(await listing).toContain(expectedName ?? "No subscriptions found.");
    const parsed = parseBackup(await exporting);
    expect(parsed.data.subscriptions.map((item) => item.name)).toEqual(expectedName ? [expectedName] : []);

  });

  it("waits for failed deletion rollback, including grace state, and isolates snapshots", async () => {
    vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout, clearTimeout });
    const savingStarted = deferred<void>();
    const savingGate = deferred<void>();
    pendingReleases.push(() => savingGate.resolve());
    let fail = false;
    const { data, registry, store, add } = setup(() => {
      if (!fail) return Promise.resolve();
      savingStarted.resolve();
      return savingGate.promise;
    });
    await add("Keep me"); const id = data.subscriptions[0].id;
    await store.setSubscriptionEnabled(id, false); fail = true;
    const deletion = ownStoreJob(jobs, store.deleteSubscription(id));
    const rejected = expect(deletion).rejects.toThrow("disk full");
    const reading = ownStoreJob(jobs, querySubscriptions("get", { id }, store, registry));
    await savingStarted.promise;
    savingGate.reject(new Error("disk full")); await rejected;
    expect(await reading).toContain("Status: disabled (pending disable; undo available)");
    const snapshot = await store.readSnapshot(); snapshot.data.subscriptions[0].price.amountMinor = 999;
    expect(data.subscriptions[0].price.amountMinor).toBe(1234);

  });
});
