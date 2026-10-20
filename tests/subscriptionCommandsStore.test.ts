import { describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import { createDefaultData } from "../src/data/defaultData";
import { formatLocalDate } from "../src/date/dateOnly";
import type { Clock } from "../src/date/Clock";
import { ownStoreJob, primaryGate, storeTest } from "./helpers/storeFixture";
import { deferred, errorOf } from "./helpers/deferred";
import { buildData } from "./helpers/subscriptionFactory";

vi.mock("obsidian", async () => ({ ...(await import("./obsidianMock")), requestUrl: vi.fn() }));

const { pendingReleases, jobs, fixture } = storeTest();

const fixedClock: Clock = { now: () => new Date("2026-06-27T12:00:00Z") };
const today = formatLocalDate(fixedClock.now());
const ICON_RESPONSE = {
  status: 200,
  json: null,
  text: "",
  headers: { "content-type": "image/png" },
  arrayBuffer: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
};

function cachedIcon(domain: string) {
  return {
    cacheKey: `google-s2:${domain}`,
    sourceUrl: `https://www.google.com/s2/favicons?domain=${domain}`,
    serviceDomain: domain,
    dataUrl: "data:image/png;base64,AAA",
    contentType: "image/png",
    fetchedOn: "2026-06-27",
  };
}

/** One gated requestUrl call: `started` proves the boundary, settle/fail resolve it. */
function iconCall(response: Record<string, unknown>, releases: Array<() => void>) {
  const started = deferred<void>();
  const gate = deferred<Record<string, unknown>>();
  releases.push(() => gate.resolve(response));
  const pending = gate.promise;
  const request = Object.assign(pending, {
    // Failure flows through the main promise; the derived props must not add
    // unhandled rejections.
    arrayBuffer: pending.then((value) => value.arrayBuffer, () => undefined),
    json: pending.then((value) => value.json, () => undefined),
    text: pending.then((value) => value.text, () => undefined),
  });
  return {
    started,
    request: request as unknown as ReturnType<typeof requestUrl>,
    settle: () => gate.resolve(response),
    fail: (reason: unknown) => gate.reject(reason),
  };
}

/** The auto-icon record with a stale cached icon; captures any fetch the command triggers. */
function iconCommandFixture(saves: () => Promise<void>) {
  const data = buildData();
  data.subscriptions[0].icon = { mode: "auto", cacheKey: "google-s2:old.example.com" };
  data.iconCache["google-s2:old.example.com"] = cachedIcon("old.example.com");
  const { data: storeData, store } = fixture(data, saves, fixedClock);
  let fetchRequested = false;
  const call = iconCall(ICON_RESPONSE, pendingReleases);
  vi.mocked(requestUrl).mockImplementation(() => {
    fetchRequested = true;
    call.started.resolve();
    return call.request;
  });
  return { storeData, store, call, fetchRequested: () => fetchRequested };
}

describe("subscription command store APIs", () => {

  it("returns a detached subscription with captured currency metadata after one primary save", async () => {
    const saves = vi.fn(async () => undefined);
    const { data, store } = fixture(undefined, saves, fixedClock);
    data.settings.faviconProvider = "none";

    const result = await store.createSubscription({
      name: "CLI service",
      priceText: "12.34",
      billingPeriod: "yearly",
      startDate: "2026-06-01",
      serviceUrl: "example.com",
    });

    const item = data.subscriptions[0];
    expect(item).toBeDefined();
    expect(saves).toHaveBeenCalledTimes(1);
    expect(result.id).toBe(item.id);
    // Default currency resolved without being passed in; metadata captured for the DTO.
    expect(result.currencyScale).toBe(2);
    expect(result.currencyArchived).toBe(false);
    expect(result.persistedStatus).toBe("enabled");
    expect(result.effectiveStatus).toBe("enabled");
    expect(result.statusPending).toBe(false);
    expect(result.changed).toBe(true);
    expect(item).toMatchObject({
      name: "CLI service",
      status: "enabled",
      price: { amountMinor: 1234, currencyCode: "USD" },
      billingPeriod: "yearly",
      startDate: "2026-06-01",
      serviceUrl: "https://example.com/",
      createdOn: today,
      updatedOn: today,
    });
    // The result is detached: later queued store writes must not reach it.
    await store.setSubscription(item.id, { name: "Renamed by a later write", priceText: "99" });
    expect(result.item.name).toBe("CLI service");
    expect(result.item.price.amountMinor).toBe(1234);
    expect(result.persistedStatus).toBe("enabled");
    expect(item.name).toBe("Renamed by a later write");
  });

  it("captures each command result inside its own queue transaction", async () => {
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save, fixedClock);
    // A view listener mutating live records between queue slots must not leak into
    // an earlier command's already-returned transaction.
    let listenerFired = false;
    store.subscribe(() => {
      if (listenerFired) return;
      listenerFired = true;
      const record = data.subscriptions[0];
      if (record) record.price.currencyCode = "LISTENER";
    });

    const first = ownStoreJob(jobs, store.setSubscription("ab1", { priceText: "12.34" }));
    await gate.started;
    const second = ownStoreJob(jobs, store.setSubscription("ab1", {
      currencyCode: "JPY",
      priceText: "1000",
    }));
    gate.open();

    await second;
    const result = await first;

    expect(result.item.price).toEqual({ amountMinor: 1234, currencyCode: "USD" });
    expect(result.currencyScale).toBe(2);
    expect(result.currencyArchived).toBe(false);
    expect(result.item.name).toBe("Old name");
    expect(data.subscriptions[0]?.price).toEqual({ amountMinor: 1000, currencyCode: "JPY" });
  });

  it("atomically updates requested fields for an arbitrary short id and preserves the rest", async () => {
    const saves = vi.fn(async () => undefined);
    const { data, store } = fixture(buildData(), saves, fixedClock);

    const result = await store.setSubscription("ab1", {
      name: "Renamed",
      priceText: "30",
      currencyCode: "eur",
      status: "disabled",
    });

    expect(saves).toHaveBeenCalledTimes(1);
    expect(data.subscriptions[0]).toMatchObject({
      id: "ab1",
      name: "Renamed",
      status: "disabled",
      price: { amountMinor: 3000, currencyCode: "EUR" },
      billingPeriod: "monthly",
      serviceUrl: "https://old.example.com/",
      icon: { mode: "none" },
      createdOn: "2026-01-01",
      disabledOn: today,
      updatedOn: today,
    });
    expect(result).toMatchObject({
      id: "ab1",
      currencyScale: 2,
      currencyArchived: false,
      persistedStatus: "disabled",
      effectiveStatus: "disabled",
      statusPending: false,
      changed: true,
      dryRun: false,
    });
  });

  it("applies nothing, saves nothing and notifies nobody when a later field fails validation", async () => {
    const saves = vi.fn(async () => undefined);
    const { data, store } = fixture(buildData(), saves, fixedClock);
    const notified = vi.fn();
    store.subscribe(notified);

    const error = await errorOf(store.setSubscription(
      "ab1",
      { name: "Renamed", priceText: "1.234", status: "disabled" }
    ));

    expect(error).toMatchObject({ code: "VALIDATION_FAILED", field: "price" });
    expect(saves).not.toHaveBeenCalled();
    expect(notified).not.toHaveBeenCalled();
    expect(data.subscriptions[0]).toMatchObject({
      name: "Old name",
      status: "enabled",
      price: { amountMinor: 2000, currencyCode: "USD" },
      updatedOn: "2026-01-01",
    });
  });

  it("restores every requested field and reports SAVE_FAILED when the primary save fails", async () => {
    const saves = vi.fn(async () => {
      throw new Error("disk full");
    });
    const { data, store } = fixture(buildData(), saves, fixedClock);

    const error = await errorOf(store.setSubscription(
      "ab1",
      { name: "Renamed", priceText: "30", status: "disabled" }
    ));

    expect(error).toMatchObject({ code: "SAVE_FAILED" });
    expect((error as { cause?: { message?: string } }).cause).toMatchObject({ message: "disk full" });
    expect(saves).toHaveBeenCalledTimes(1);
    expect(data.subscriptions[0]).toMatchObject({
      name: "Old name",
      status: "enabled",
      price: { amountMinor: 2000, currencyCode: "USD" },
      updatedOn: "2026-01-01",
    });
    expect(data.subscriptions[0]?.disabledOn).toBeUndefined();
  });

  it("reconciles a gui enable issued while the cli disable save is unresolved and succeeds", async () => {
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save, fixedClock);

    const disabling = ownStoreJob(jobs, store.setSubscription("ab1", { status: "disabled" }));
    await gate.started;
    const enabling = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", true));
    gate.open();

    await disabling;
    await enabling;

    expect(data.subscriptions[0]).toMatchObject({
      name: "Old name",
      status: "enabled",
      price: { amountMinor: 2000, currencyCode: "USD" },
      disabledOn: undefined,
    });
    expect(gate.calls).toBe(2);
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
    expect(store.getDisabledSubscriptions()).toHaveLength(0);
  });

  it("keeps prior fields and the later gui enable intent when the cli disable save fails", async () => {
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save, fixedClock);

    const disabling = ownStoreJob(jobs, store.setSubscription("ab1", {
      name: "Race rename",
      priceText: "40",
      status: "disabled",
    }));
    await gate.started;
    const enabling = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", true));
    gate.fail();

    const error = await errorOf(disabling);
    await enabling;

    expect(error).toMatchObject({ code: "SAVE_FAILED" });
    expect(data.subscriptions[0]).toMatchObject({
      name: "Old name",
      status: "enabled",
      price: { amountMinor: 2000, currencyCode: "USD" },
      updatedOn: "2026-01-01",
    });
    expect(data.subscriptions[0]?.disabledOn).toBeUndefined();
    expect(gate.calls).toBe(1);
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
  });

  it("reports NOT_FOUND for an unknown id without saving", async () => {
    const saves = vi.fn(async () => undefined);
    const { data, store } = fixture(buildData(), saves, fixedClock);

    await expect(store.setSubscription("missing", { name: "X" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(saves).not.toHaveBeenCalled();
    expect(data.subscriptions[0]?.name).toBe("Old name");
  });

  it("treats a fully identical set as a semantic no-op without save, dates, notify or icon work", async () => {
    const saves = vi.fn(async () => undefined);
    const data = buildData();
    data.subscriptions[0].icon = { mode: "auto", cacheKey: "existing-key" };
    const { store } = fixture(data, saves, fixedClock);
    const notified = vi.fn();
    store.subscribe(notified);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await store.setSubscription("ab1", {
      name: "  Old name  ",
      priceText: "20.00",
      serviceUrl: "https://old.example.com/",
    });

    expect(result.changed).toBe(false);
    expect(saves).not.toHaveBeenCalled();
    expect(notified).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(data.subscriptions[0]).toMatchObject({
      name: "Old name",
      price: { amountMinor: 2000, currencyCode: "USD" },
      icon: { mode: "auto", cacheKey: "existing-key" },
      updatedOn: "2026-01-01",
    });
  });

  it("counts consuming a pending gui disable as a runtime-only change without a financial save", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const saves = vi.fn(async () => undefined);
    const { data, store } = fixture(buildData(), saves, fixedClock);
    const notified = vi.fn();
    store.subscribe(notified);
    await store.setSubscriptionEnabled("ab1", false);

    const result = await store.setSubscription("ab1", { status: "enabled" });

    expect(result.changed).toBe(true);
    expect(result.persistedStatus).toBe("enabled");
    expect(result.effectiveStatus).toBe("enabled");
    expect(result.statusPending).toBe(false);
    expect(saves).not.toHaveBeenCalled();
    expect(notified).toHaveBeenCalled();
    expect(data.subscriptions[0]).toMatchObject({ status: "enabled", updatedOn: "2026-01-01" });
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
  });

  it("retains all data references when validation fails before any mutation", async () => {
    const saves = vi.fn(async () => undefined);
    const data = buildData();
    data.customCurrencies.push({ code: "OLD", label: "OLD", amountMarker: undefined, scale: 2, source: "custom" });
    const { store } = fixture(data, saves, fixedClock);
    const settingsRef = data.settings;
    const recordRef = data.subscriptions[0];
    const customRef = data.customCurrencies;
    const cacheRef = data.iconCache;
    const notified = vi.fn();
    store.subscribe(notified);

    const error = await errorOf(store.setSubscription(
      "ab1",
      { name: "Renamed", priceText: "1.234", status: "disabled" }
    ));

    expect(error).toMatchObject({ code: "VALIDATION_FAILED" });
    // Zero effects means zero reference churn, not merely equal values.
    expect(data.settings).toBe(settingsRef);
    expect(data.subscriptions[0]).toBe(recordRef);
    expect(data.customCurrencies).toBe(customRef);
    expect(data.iconCache).toBe(cacheRef);
    expect(saves).not.toHaveBeenCalled();
    expect(notified).not.toHaveBeenCalled();
  });

  it.each([
    ["only the price changes", { priceText: "30" }, 3000],
    ["it is explicitly re-selected", { currencyCode: "tok", priceText: "2" }, 200],
  ] as const)("retains an already-used archived currency when %s", async (_label, update, amountMinor) => {
    const saves = vi.fn(async () => undefined);
    const data = buildData({ currencyCode: "TOK" });
    data.customCurrencies.push({
      code: "TOK", label: "TOKEN", amountMarker: undefined, scale: 2, source: "custom", isArchived: true,
    });
    const { data: storeData, store } = fixture(data, saves, fixedClock);

    const result = await store.setSubscription("ab1", update);

    expect(saves).toHaveBeenCalledTimes(1);
    expect(storeData.subscriptions[0]?.price).toEqual({ amountMinor, currencyCode: "TOK" });
    expect(result.currencyScale).toBe(2);
    expect(result.currencyArchived).toBe(true);
  });

  it("rejects newly assigning an archived currency", async () => {
    const saves = vi.fn(async () => undefined);
    const data = buildData();
    data.customCurrencies.push({
      code: "TOK", label: "TOKEN", amountMarker: undefined, scale: 2, source: "custom", isArchived: true,
    });
    const { store } = fixture(data, saves, fixedClock);

    await expect(store.setSubscription("ab1", { currencyCode: "tok", priceText: "30" }))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(saves).not.toHaveBeenCalled();
    expect(data.subscriptions[0]?.price).toEqual({ amountMinor: 2000, currencyCode: "USD" });
  });

  it.each([
    ["set", {}],
    ["dry-run preview", { dryRun: true }],
  ] as const)("rejects a %s whose record currency no longer resolves, without saving", async (_label, options) => {
    const saves = vi.fn(async () => undefined);
    const { data, store } = fixture(buildData({ currencyCode: "ZZZ" }), saves, fixedClock);

    await expect(store.setSubscription("ab1", { name: "New name" }, options))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED", field: "currency", message: "Unknown currency." });
    expect(saves).not.toHaveBeenCalled();
    expect(data.subscriptions[0]?.name).toBe("Old name");
  });

  it("rejects assigning a currency archived by a queued operation ahead of the command", async () => {
    const gate = primaryGate(pendingReleases);
    const data = buildData();
    data.customCurrencies.push({ code: "X7", label: "TOKEN", amountMarker: undefined, scale: 2, source: "custom" });
    const { store } = fixture(data, gate.save, fixedClock);

    const archiving = ownStoreJob(jobs, store.archiveCustomCurrency("X7"));
    await gate.started;
    const setting = ownStoreJob(jobs, store.setSubscription("ab1", {
      currencyCode: "X7",
      priceText: "3",
    }));
    gate.open();

    await archiving;
    await expect(setting).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(data.customCurrencies.some((currency) => currency.code === "X7")).toBe(false);
    expect(data.subscriptions[0]?.price).toEqual({ amountMinor: 2000, currencyCode: "USD" });
  });

  it("resolves the create default currency inside the write queue", async () => {
    const saves = vi.fn(async () => undefined);
    const data = createDefaultData();
    data.settings.defaultCurrency = "EUR";
    const { data: storeData, store } = fixture(data, saves, fixedClock);
    storeData.settings.faviconProvider = "none";

    const result = await store.createSubscription({ name: "EUR service", priceText: "5" });

    expect(saves).toHaveBeenCalledTimes(1);
    expect(storeData.subscriptions[0]?.price).toEqual({ amountMinor: 500, currencyCode: "EUR" });
    expect(result.currencyScale).toBe(2);
    expect(result.currencyArchived).toBe(false);
  });

  it("resolves the create default from a currency change queued ahead of the command", async () => {
    const gate = primaryGate(pendingReleases);
    const data = createDefaultData();
    const { data: storeData, store } = fixture(data, gate.save, fixedClock);
    storeData.settings.faviconProvider = "none";

    const settings = ownStoreJob(jobs, store.updateSettings((s) => { s.defaultCurrency = "EUR"; }));
    await gate.started;
    const creating = ownStoreJob(jobs, store.createSubscription({ name: "EU service", priceText: "4" }));
    gate.open();

    await settings;
    const result = await creating;

    expect(storeData.subscriptions[0]?.price).toEqual({ amountMinor: 400, currencyCode: "EUR" });
    expect(result.currencyScale).toBe(2);
  });

  it("waits for queued settings changes and previews the settled committed state", async () => {
    const gate = primaryGate(pendingReleases);
    const data = createDefaultData();
    const { data: storeData, store } = fixture(data, gate.save, fixedClock);
    storeData.settings.faviconProvider = "none";

    const settings = ownStoreJob(jobs, store.updateSettings((s) => { s.defaultCurrency = "EUR"; }));
    await gate.started;
    const preview = ownStoreJob(jobs, store.createSubscription(
      { name: "Previewed service", priceText: "10" },
      { dryRun: true }
    ));
    gate.open();

    await settings;
    const result = await preview;

    expect(result).toMatchObject({
      id: null,
      dryRun: true,
      changed: true,
      currencyScale: 2,
      currencyArchived: false,
      persistedStatus: "enabled",
      effectiveStatus: "enabled",
      statusPending: false,
    });
    expect(result.item.id).toBe("");
    expect(result.item).toMatchObject({
      name: "Previewed service",
      price: { amountMinor: 1000, currencyCode: "EUR" },
      billingPeriod: "monthly",
      status: "enabled",
    });
    // The preview allocates no real record.
    expect(storeData.subscriptions).toHaveLength(0);
    expect(gate.calls).toBe(1);

    const invalid = await errorOf(store.createSubscription(
      { name: "Bad", priceText: "abc" },
      { dryRun: true }
    ));
    expect(invalid).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(storeData.subscriptions).toHaveLength(0);
  });

  it("previews the rolled-back default after a failed queued settings save", async () => {
    const gate = primaryGate(pendingReleases);
    const data = createDefaultData();
    const { store } = fixture(data, gate.save, fixedClock);

    const settings = ownStoreJob(jobs, store.updateSettings((s) => { s.defaultCurrency = "EUR"; }));
    await gate.started;
    const preview = ownStoreJob(jobs, store.createSubscription(
      { name: "Previewed service", priceText: "10" },
      { dryRun: true }
    ));
    gate.fail();

    await expect(settings).rejects.toThrow("disk full");
    const result = await preview;

    expect(result.item.price).toEqual({ amountMinor: 1000, currencyCode: "USD" });
  });

  it("predicts commit-identical status, dates and intent cancellation in previews", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const saves = vi.fn(async () => undefined);
    const { store } = fixture(buildData(), saves, fixedClock);
    await store.setSubscriptionEnabled("ab1", false);

    const enablePreview = await store.setSubscription("ab1", { status: "enabled" }, { dryRun: true });

    expect(enablePreview).toMatchObject({
      id: "ab1",
      dryRun: true,
      changed: true,
      persistedStatus: "enabled",
      effectiveStatus: "enabled",
      statusPending: false,
    });
    expect(enablePreview.item.updatedOn).toBe("2026-01-01");
    // The preview must not consume the real intent.
    expect(store.getEnabledSubscriptions()).toHaveLength(0);

    const disablePreview = await store.setSubscription("ab1", { status: "disabled" }, { dryRun: true });

    expect(disablePreview).toMatchObject({
      changed: true,
      persistedStatus: "disabled",
      effectiveStatus: "disabled",
      statusPending: false,
    });
    expect(disablePreview.item.disabledOn).toBe(today);
    expect(disablePreview.item.updatedOn).toBe(today);
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
    expect(saves).not.toHaveBeenCalled();
  });

  it("previews sets against the current record without any effect", async () => {
    const saves = vi.fn(async () => undefined);
    const { data, store } = fixture(buildData(), saves, fixedClock);

    const preview = await store.setSubscription("ab1", { priceText: "40" }, { dryRun: true });

    expect(preview).toMatchObject({
      id: "ab1",
      dryRun: true,
      changed: true,
      persistedStatus: "enabled",
      effectiveStatus: "enabled",
      statusPending: false,
    });
    expect(preview.item).toMatchObject({ name: "Old name", price: { amountMinor: 4000, currencyCode: "USD" } });
    expect(data.subscriptions[0]?.price.amountMinor).toBe(2000);
    expect(saves).not.toHaveBeenCalled();

    const noopPreview = await store.setSubscription("ab1", { priceText: "20" }, { dryRun: true });
    expect(noopPreview.changed).toBe(false);
    expect(saves).not.toHaveBeenCalled();
  });

  it("keeps the unload flush working while rejecting new writes and previews after disposal", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const saves = vi.fn(async () => undefined);
    const { data, store } = fixture(buildData(), saves, fixedClock);
    await store.setSubscriptionEnabled("ab1", false);

    store.dispose();
    await store.flushDisableGracePeriods();
    expect(data.subscriptions[0]?.status).toBe("disabled");

    await expect(store.createSubscription({ name: "Late", priceText: "1" }))
      .rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(store.setSubscription("ab1", { name: "Late" }))
      .rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(store.createSubscription({ name: "Late", priceText: "1" }, { dryRun: true }))
      .rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(store.setSubscription("ab1", { name: "Late" }, { dryRun: true }))
      .rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(store.updateSubscription("ab1", { name: "Late" }))
      .rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(store.updateSettings((settings) => { settings.showDisabled = true; }))
      .rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(store.restoreBackupJson("not a backup", () => true))
      .rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(saves).toHaveBeenCalledTimes(1);
    expect(data.settings.showDisabled).toBe(false);
  });

  it.each([
    ["createSubscription", (store: SubscriptionStore) => store.createSubscription({ name: "X", priceText: "1" })],
    ["setSubscription", (store: SubscriptionStore) => store.setSubscription("ab1", { name: "X" })],
    ["addSubscription", (store: SubscriptionStore) => store.addSubscription({ name: "X", priceText: "1", currencyCode: "USD", billingPeriod: "monthly" })],
    ["updateSubscription", (store: SubscriptionStore) => store.updateSubscription("ab1", { name: "X" })],
    ["updateSettings", (store: SubscriptionStore) => store.updateSettings((settings) => { settings.showDisabled = true; })],
    ["restoreBackupJson", (store: SubscriptionStore) => store.restoreBackupJson("{}", () => true)],
    ["addCustomCurrency", (store: SubscriptionStore) => store.addCustomCurrency({ label: "X", amountMarker: "X", scale: 2 })],
    ["updateCustomCurrency", (store: SubscriptionStore) => store.updateCustomCurrency("USD", { label: "Y" })],
    ["archiveCustomCurrency", (store: SubscriptionStore) => store.archiveCustomCurrency("USD")],
    ["deleteCustomCurrency", (store: SubscriptionStore) => store.deleteCustomCurrency("USD")],
    ["cleanupUnusedArchivedCustomCurrencies", (store: SubscriptionStore) => store.cleanupUnusedArchivedCustomCurrencies()],
    ["deleteSubscription", (store: SubscriptionStore) => store.deleteSubscription("ab1")],
    ["refreshIcon", (store: SubscriptionStore) => store.refreshIcon("ab1")],
    ["refreshAllIcons", (store: SubscriptionStore) => store.refreshAllIcons()],
  ])("rejects %s with UNAVAILABLE after disposal", async (_name, invoke) => {
    const data = buildData();
    const { data: storeData, store } = fixture(data, async () => undefined, fixedClock);
    const settingsRef = storeData.settings;
    const recordRef = storeData.subscriptions[0];

    store.dispose();
    const error = await errorOf(invoke(store));

    expect(error).toMatchObject({ code: "UNAVAILABLE" });
    // Rejections leave state, references and records untouched.
    expect(storeData.settings).toBe(settingsRef);
    expect(storeData.subscriptions[0]).toBe(recordRef);
    expect(storeData.subscriptions).toHaveLength(1);
    expect(storeData.subscriptions[0]?.name).toBe("Old name");
    expect(storeData.settings.showDisabled).toBe(false);
  });

  it("rejects a user write queued before its slot when the store is disposed meanwhile", async () => {
    const saves = vi.fn(async () => undefined);
    const data = buildData();
    const { data: storeData, store } = fixture(data, saves, fixedClock);
    const settingsRef = storeData.settings;

    const pending = store.updateSettings((settings) => { settings.showDisabled = true; });
    store.dispose();

    await expect(pending).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(storeData.settings).toBe(settingsRef);
    expect(storeData.settings.showDisabled).toBe(false);
    expect(saves).not.toHaveBeenCalled();
  });

  it("clears the stale icon cache and refetches when the command changes the URL", async () => {
    const saves = vi.fn(async () => undefined);
    const { storeData, store, call } = iconCommandFixture(saves);
    const attached = deferred<void>();
    store.subscribe(() => {
      if (storeData.subscriptions[0]?.icon.cacheKey === "google-s2:new.example.com") attached.resolve();
    });

    const result = await store.setSubscription("ab1", { serviceUrl: "new.example.com" });

    expect(result.item.icon.cacheKey).toBeUndefined();
    expect(storeData.iconCache["google-s2:old.example.com"]).toBeUndefined();
    await call.started.promise;
    call.settle();
    await attached.promise;

    expect(storeData.subscriptions[0]?.icon.cacheKey).toBe("google-s2:new.example.com");
    expect(storeData.iconCache["google-s2:new.example.com"]).toBeDefined();
  });

  it("removes the cached icon on clear-url without any network fetch", async () => {
    const saves = vi.fn(async () => undefined);
    const { storeData, store, fetchRequested } = iconCommandFixture(saves);

    const result = await store.setSubscription("ab1", { clearServiceUrl: true });

    expect(result.item.serviceUrl).toBeUndefined();
    expect(result.item.icon.cacheKey).toBeUndefined();
    expect(storeData.iconCache).toEqual({});
    await store.readSnapshot();
    expect(fetchRequested()).toBe(false);
  });

  it("leaves the cached icon untouched when the URL change cannot be saved", async () => {
    const saves = vi.fn(async () => {
      throw new Error("disk full");
    });
    const { storeData, store, fetchRequested } = iconCommandFixture(saves);

    await expect(store.setSubscription("ab1", { serviceUrl: "new.example.com" }))
      .rejects.toMatchObject({ code: "SAVE_FAILED" });

    expect(storeData.subscriptions[0]?.icon).toEqual({ mode: "auto", cacheKey: "google-s2:old.example.com" });
    expect(Object.keys(storeData.iconCache)).toEqual(["google-s2:old.example.com"]);
    await store.readSnapshot();
    expect(fetchRequested()).toBe(false);
  });

  it("discards an in-flight icon response for a superseded URL", async () => {
    const saves = vi.fn(async () => undefined);
    const data = buildData();
    data.subscriptions[0].icon = { mode: "auto" };
    const { data: storeData, store } = fixture(data, saves, fixedClock);
    const warnCaught = deferred<void>();
    vi.spyOn(console, "warn").mockImplementation(() => { warnCaught.resolve(); });
    const firstCall = iconCall(ICON_RESPONSE, pendingReleases);
    const secondCall = iconCall(ICON_RESPONSE, pendingReleases);
    const callQueue = [firstCall, secondCall];
    vi.mocked(requestUrl).mockImplementation(() => {
      const call = callQueue.shift();
      call?.started.resolve();
      return (call ?? secondCall).request;
    });

    const refreshing = ownStoreJob(jobs, store.refreshIcon("ab1"));
    await firstCall.started.promise;

    const result = await store.setSubscription("ab1", { serviceUrl: "new.example.com" });
    firstCall.settle();
    expect(await refreshing).toBe(false);

    expect(result.item.icon.cacheKey).toBeUndefined();
    expect(storeData.iconCache).toEqual({});
    expect(storeData.subscriptions[0]?.icon.cacheKey).toBeUndefined();

    secondCall.fail(new Error("offline"));
    await warnCaught.promise;
    expect(storeData.iconCache).toEqual({});
    expect(storeData.subscriptions[0]?.icon.cacheKey).toBeUndefined();
  });

  it("starts favicon work only after the primary save and never delays the financial result", async () => {
    const saves = vi.fn(async () => undefined);
    const { data, store } = fixture(undefined, saves, fixedClock);
    const warnCaught = deferred<void>();
    vi.spyOn(console, "warn").mockImplementation(() => { warnCaught.resolve(); });
    const fetchStarted = deferred<void>();
    let releaseFetch: () => void = () => undefined;
    vi.mocked(requestUrl).mockImplementation(() => {
      fetchStarted.resolve();
      const pending = new Promise<never>((_, reject) => {
        releaseFetch = () => reject(new Error("offline"));
      });
      return Object.assign(pending, {
        arrayBuffer: pending,
        json: pending,
        text: pending,
      });
    });
    pendingReleases.push(() => releaseFetch());

    const result = await store.createSubscription({
      name: "Icon service",
      priceText: "9",
      serviceUrl: "example.com",
    });

    expect(result.changed).toBe(true);
    expect(saves).toHaveBeenCalledTimes(1);
    await fetchStarted.promise;
    expect(data.iconCache).toEqual({});

    releaseFetch();
    await warnCaught.promise;
    expect(data.iconCache).toEqual({});
    expect(data.subscriptions[0]?.icon.cacheKey).toBeUndefined();
  });
});
