import { afterEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import { migratePluginData } from "../src/data/migrations";
import { createBackup } from "../src/data/backup";
import { disposeStores, ownStoreJob, storeFixture } from "./helpers/storeFixture";
import { deferred } from "./helpers/deferred";

vi.mock("obsidian", async () => ({ ...(await import("./obsidianMock")), requestUrl: vi.fn() }));
const response = { status: 200, json: null, text: "", headers: { "content-type": "image/png" }, arrayBuffer: new Uint8Array([1, 2, 3]).buffer };
const stores: SubscriptionStore[] = [];
const pendingReleases: Array<() => void> = [];
const jobs: Promise<unknown>[] = [];
function deferredResponse(setRelease: (release: (value: typeof response) => void) => void): ReturnType<typeof requestUrl> {
  const gate = deferred<typeof response>();
  setRelease(value => gate.resolve(value));
  pendingReleases.push(() => gate.resolve(response));
  const pending = gate.promise;
  return Object.assign(pending, { arrayBuffer: pending.then(value => value.arrayBuffer), json: pending.then(value => value.json), text: pending.then(value => value.text) });
}
function setup(save = vi.fn(async () => undefined)) {
  const { data, icons, store } = storeFixture(undefined, save);
  stores.push(store);
  const add = (name = "Service", url = "https://example.com") => store.addSubscription({ name, serviceUrl: url, priceText: "12", currencyCode: "USD", billingPeriod: "monthly" });
  return { data, icons, store, add, save };
}
function waitForIcons(data: ReturnType<typeof setup>["data"]): Promise<void> {
  return vi.waitFor(() => expect(data.subscriptions.every(item => !!item.icon.cacheKey)).toBe(true));
}
describe("icon reliability", () => {
  it("rejects an older refresh after a second refresh starts for the same URL and mode", async () => {
    vi.mocked(requestUrl).mockResolvedValue(response);
    const { store, icons, data, add } = setup();
    await add(); await waitForIcons(data);
    const older = deferred<Awaited<ReturnType<typeof icons.fetchAutoIcon>>>();
    const newer = deferred<Awaited<ReturnType<typeof icons.fetchAutoIcon>>>();
    const fetch = vi.spyOn(icons, "fetchAutoIcon").mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
    const candidate = { cacheKey: "google-s2:example.com", serviceDomain: "example.com", sourceUrl: "https://example.com", dataUrl: "data:image/png;base64,AQID", contentType: "image/png", fetchedOn: "2026-10-20" };
    const first = ownStoreJob(jobs, store.refreshIcon(data.subscriptions[0].id));
    try {
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      const second = ownStoreJob(jobs, store.refreshIcon(data.subscriptions[0].id));
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      older.resolve(candidate);
      expect(await first).toBe(false);
      newer.resolve(candidate);
      expect(await second).toBe(true);
    } finally { older.resolve(null); newer.resolve(null); }
  });
  it.each(["fetch", "save"] as const)("retains the successful primary save after a background icon %s failure", async (failure) => {
    const { store, icons, data, save } = setup();
    const gate = deferred<Awaited<ReturnType<typeof icons.fetchAutoIcon>>>();
    vi.spyOn(icons, "fetchAutoIcon").mockImplementation(() => gate.promise);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const saving = ownStoreJob(jobs, store.addSubscription({ name: "Saved", serviceUrl: "https://example.com", priceText: "12", currencyCode: "USD", billingPeriod: "monthly" }));
    try {
      await saving;
      const before = structuredClone(data);
      if (failure === "fetch") gate.reject(new Error("offline"));
      else {
        save.mockRejectedValueOnce(new Error("icon save failed"));
        gate.resolve({ cacheKey: "google-s2:example.com", serviceDomain: "example.com", sourceUrl: "https://example.com", dataUrl: "data:image/png;base64,AQID", contentType: "image/png", fetchedOn: "2026-10-20" });
      }
      await vi.waitFor(() => expect(warning).toHaveBeenCalled());
      expect((await store.readSnapshot()).data).toEqual(before);
    } finally { gate.resolve(null); await saving; }
  });
  it.each(["add", "edit"] as const)("completes %s after the primary save while the icon request is pending", async (action) => {
    const { store, icons, data, save } = setup();
    if (action === "edit") await store.addSubscription({ name: "Before", priceText: "12", currencyCode: "USD", billingPeriod: "monthly", icon: { mode: "none" } });
    const gate = deferred<Awaited<ReturnType<typeof icons.fetchAutoIcon>>>();
    vi.spyOn(icons, "fetchAutoIcon").mockImplementation(() => gate.promise);
    let completed = false;
    const saving = ownStoreJob(jobs, (action === "add" ? store.addSubscription({ name: "Saved", serviceUrl: "https://example.com", priceText: "12", currencyCode: "USD", billingPeriod: "monthly" })
      : store.updateSubscription(data.subscriptions[0].id, { name: "Saved", serviceUrl: "https://example.com", icon: { mode: "auto" } })).then(() => { completed = true; }));
    try {
      await vi.waitFor(() => expect(completed).toBe(true));
      expect(data.subscriptions[0].name).toBe("Saved");
      expect(data.subscriptions[0].icon.cacheKey).toBeUndefined();
      expect(save).toHaveBeenCalledTimes(action === "add" ? 1 : 2);
      gate.resolve({ cacheKey: "google-s2:example.com", serviceDomain: "example.com", sourceUrl: "https://example.com", dataUrl: "data:image/png;base64,AQID", contentType: "image/png", fetchedOn: "2026-10-20" });
      await vi.waitFor(() => expect(data.subscriptions[0].icon.cacheKey).toBe("google-s2:example.com"));
    } finally { gate.resolve(null); await saving; }
  });
  it.each(["none", "delete"] as const)("drops a pending background icon after a newer %s action", async (action) => {
    const { store, icons, data } = setup();
    const gate = deferred<Awaited<ReturnType<typeof icons.fetchAutoIcon>>>();
    const started = deferred<void>();
    vi.spyOn(icons, "fetchAutoIcon").mockImplementation(() => { started.resolve(); return gate.promise; });
    const saving = ownStoreJob(jobs, store.addSubscription({ name: "Saved", serviceUrl: "https://example.com", priceText: "12", currencyCode: "USD", billingPeriod: "monthly" }));
    try {
      await started.promise;
      if (action === "none") await store.updateSubscription(data.subscriptions[0].id, { icon: { mode: "none" } });
      else await store.deleteSubscription(data.subscriptions[0].id);
      const before = structuredClone(data);
      gate.resolve({ cacheKey: "google-s2:example.com", serviceDomain: "example.com", sourceUrl: "https://example.com", dataUrl: "data:image/png;base64,AQID", contentType: "image/png", fetchedOn: "2026-10-20" });
      await saving; await store.readSnapshot();
      expect(data).toEqual(before);
    } finally { gate.resolve(null); await saving; }
  });
  it("creates with emoji or currency icons and switches modes without changing payment data", async () => {
    vi.mocked(requestUrl).mockResolvedValue(response);
    const { store, data } = setup();
    await store.addSubscription({ name: "Music", serviceUrl: "example.com", priceText: "12.34",
      currencyCode: "USD", billingPeriod: "monthly", icon: { mode: "emoji", emoji: "🎵" } });
    const id = data.subscriptions[0].id;
    expect(requestUrl).not.toHaveBeenCalled();
    await store.updateSubscription(id, { icon: { mode: "none", emoji: "🎵" } });
    expect(data.subscriptions[0].icon).toMatchObject({ mode: "none", emoji: "🎵" });
    expect(requestUrl).not.toHaveBeenCalled();
    await store.updateSubscription(id, { icon: { mode: "auto", emoji: "🎵" } });
    await waitForIcons(data);
    expect(requestUrl).toHaveBeenCalledOnce();
    expect(data.subscriptions[0].icon.cacheKey).toBe("google-s2:example.com");
    await store.updateSubscription(id, { icon: { mode: "emoji", emoji: "🎵" } });
    const saved = (await store.readSnapshot()).data.subscriptions[0];
    expect(saved.icon).toMatchObject({ mode: "emoji", emoji: "🎵" });
    expect(saved.icon.cacheKey).toBeUndefined();
    expect(saved.price).toEqual({ amountMinor: 1234, currencyCode: "USD" });
    expect(saved.billingPeriod).toBe("monthly");
    expect(saved.status).toBe("enabled");
  });
  afterEach(async () => {
    try { await disposeStores(stores, pendingReleases, jobs); }
    finally { vi.restoreAllMocks(); vi.mocked(requestUrl).mockReset(); }
  });
  it("saves financial edits and reads backups while an add icon request is unresolved", async () => {
    let release!: (value: typeof response) => void;
    const started = deferred<void>();
    vi.mocked(requestUrl).mockImplementation(() => deferredResponse(resolve => { release = resolve; started.resolve(); }));
    const { store, add, data, save } = setup();
    const adding = ownStoreJob(jobs, add());
    await started.promise;
    try {
      expect(save).toHaveBeenCalledOnce();
      const editing = ownStoreJob(jobs, store.updateSubscription(data.subscriptions[0].id, { name: "Updated" }));
      await editing;
      expect(save).toHaveBeenCalledTimes(2);
      expect(createBackup((await store.readSnapshot()).data).payload.subscriptions[0].name).toBe("Updated");
    } finally { release(response); await adding; }
  });
  it("rejects remote cache sources during migration and before rendering", () => {
    const { data, icons } = setup();
    const cached = { cacheKey: "key", sourceUrl: "https://example.com", serviceDomain: "example.com", dataUrl: "https://example.com/tracker.png", contentType: "image/png", fetchedOn: "2026-10-04" };
    data.iconCache.key = cached;
    expect(migratePluginData(data).iconCache).toEqual({});
    expect(icons.getCachedIcon({ icon: { cacheKey: "key" } } as never)).toBeNull();
  });
  it("reuses a same-domain cache and refreshes each distinct domain once", async () => {
    vi.mocked(requestUrl).mockResolvedValue(response);
    const { add, store, data } = setup();
    await add("One"); await add("Two");
    await waitForIcons(data);
    expect(requestUrl).toHaveBeenCalledOnce();
    expect(data.subscriptions[0].icon.cacheKey).toBe(data.subscriptions[1].icon.cacheKey);
    expect(await store.refreshAllIcons()).toEqual({ refreshed: 2, failed: 0, skipped: 0 });
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });
  it("coalesces concurrent same-domain adds and releases failed requests for retry", async () => {
    let release!: (value: typeof response) => void;
    const started = deferred<void>();
    vi.mocked(requestUrl).mockImplementationOnce(() => deferredResponse(resolve => { release = resolve; started.resolve(); }));
    const { add, data, store } = setup();
    const first = ownStoreJob(jobs, add("One")); const second = ownStoreJob(jobs, add("Two"));
    await started.promise;
    await store.readSnapshot();
    expect(requestUrl).toHaveBeenCalledOnce();
    release(response); await Promise.all([first, second]);
    await waitForIcons(data);
    expect(data.subscriptions.every(item => item.icon.cacheKey === "google-s2:example.com")).toBe(true);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(requestUrl).mockRejectedValueOnce(new Error("offline"));
    expect(await store.refreshIcon(data.subscriptions[0].id)).toBe(false);
    vi.mocked(requestUrl).mockResolvedValueOnce(response);
    expect(await store.refreshIcon(data.subscriptions[0].id)).toBe(true);
    expect(requestUrl).toHaveBeenCalledTimes(3);
  });
  it("does not revive a later batch item switched to a currency icon while another domain refresh waits", async () => {
    vi.mocked(requestUrl).mockResolvedValue(response);
    const { add, store, data } = setup();
    await add("One"); await add("Two", "https://two.example.com");
    await waitForIcons(data);
    let release!: (value: typeof response) => void;
    const started = deferred<void>();
    vi.mocked(requestUrl).mockImplementationOnce(() => deferredResponse(resolve => { release = resolve; started.resolve(); }));
    const refreshing = ownStoreJob(jobs, store.refreshAllIcons());
    await started.promise;
    await store.updateSubscription(data.subscriptions[1].id, { icon: { mode: "none" } });
    release(response);
    expect(await refreshing).toEqual({ refreshed: 1, failed: 0, skipped: 1 });
    expect(data.subscriptions[1].icon.cacheKey).toBeUndefined();
    expect(requestUrl).toHaveBeenCalledTimes(3);
  });
  it("keeps a newer shared-domain refresh when an older batch reaches another item", async () => {
    vi.mocked(requestUrl).mockResolvedValue(response);
    const { add, store, data } = setup();
    await add("One"); await add("Two", "https://two.example.com"); await add("Three");
    await waitForIcons(data);
    let release!: (value: typeof response) => void;
    const started = deferred<void>();
    const older = { ...response, arrayBuffer: new Uint8Array([2]).buffer };
    const newer = { ...response, arrayBuffer: new Uint8Array([9]).buffer };
    vi.mocked(requestUrl).mockResolvedValueOnce(older)
      .mockImplementationOnce(() => deferredResponse(resolve => { release = resolve; started.resolve(); }))
      .mockResolvedValueOnce(newer);
    const refreshing = ownStoreJob(jobs, store.refreshAllIcons());
    await started.promise;
    expect(await store.refreshIcon(data.subscriptions[0].id)).toBe(true);
    expect(data.iconCache["google-s2:example.com"].dataUrl).toBe("data:image/png;base64,CQ==");
    release(response);
    expect(await refreshing).toEqual({ refreshed: 3, failed: 0, skipped: 0 });
    expect(data.iconCache["google-s2:example.com"].dataUrl).toBe("data:image/png;base64,CQ==");
    expect(data.subscriptions[2].icon.cacheKey).toBe("google-s2:example.com");
    expect(requestUrl).toHaveBeenCalledTimes(5);
  });
  it("allows a later shared-domain batch item to apply after an earlier icon save fails", async () => {
    vi.mocked(requestUrl).mockResolvedValue(response);
    const { add, store, data, save } = setup();
    await add("One"); await add("Two", "https://two.example.com"); await add("Three");
    await waitForIcons(data);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    save.mockRejectedValueOnce(new Error("disk full"));
    vi.mocked(requestUrl).mockResolvedValue({ ...response, arrayBuffer: new Uint8Array([2]).buffer });
    expect(await store.refreshAllIcons()).toEqual({ refreshed: 2, failed: 1, skipped: 0 });
    expect(data.iconCache["google-s2:example.com"].dataUrl).toBe("data:image/png;base64,Ag==");
    expect(requestUrl).toHaveBeenCalledTimes(4);
  });
  it("does not let a reused batch image supersede a newer pending domain fetch", async () => {
    vi.mocked(requestUrl).mockResolvedValue(response);
    const { add, store, data } = setup();
    await add("One"); await add("Two", "https://two.example.com"); await add("Three");
    await waitForIcons(data);
    let releaseBatch!: (value: typeof response) => void;
    const batchStarted = deferred<void>();
    let releaseNewer!: (value: typeof response) => void;
    const newerStarted = deferred<void>();
    vi.mocked(requestUrl).mockResolvedValueOnce({ ...response, arrayBuffer: new Uint8Array([2]).buffer })
      .mockImplementationOnce(() => deferredResponse(resolve => { releaseBatch = resolve; batchStarted.resolve(); }))
      .mockImplementationOnce(() => deferredResponse(resolve => { releaseNewer = resolve; newerStarted.resolve(); }));
    const batch = ownStoreJob(jobs, store.refreshAllIcons());
    await batchStarted.promise;
    const newer = ownStoreJob(jobs, store.refreshIcon(data.subscriptions[0].id));
    await newerStarted.promise;
    releaseBatch(response);
    expect(await batch).toEqual({ refreshed: 3, failed: 0, skipped: 0 });
    releaseNewer({ ...response, arrayBuffer: new Uint8Array([9]).buffer });
    expect(await newer).toBe(true);
    expect(data.iconCache["google-s2:example.com"].dataUrl).toBe("data:image/png;base64,CQ==");
  });
  it("prunes the last deleted icon but retains shared cache and restores it on failed deletion", async () => {
    vi.mocked(requestUrl).mockResolvedValue(response);
    const { add, store, data, save } = setup();
    await add("One"); await add("Two");
    await waitForIcons(data);
    await store.deleteSubscription(data.subscriptions[0].id);
    expect(Object.keys(data.iconCache)).toHaveLength(1);
    save.mockRejectedValueOnce(new Error("disk full"));
    await expect(store.deleteSubscription(data.subscriptions[0].id)).rejects.toThrow("disk full");
    expect(Object.keys(data.iconCache)).toHaveLength(1);
    await store.deleteSubscription(data.subscriptions[0].id);
    expect(data.iconCache).toEqual({});
  });
  it.each(["url", "currency icon", "delete", "restore", "provider", "dispose"] as const)("discards a deferred refresh after newer %s intent", async (change) => {
    vi.mocked(requestUrl).mockResolvedValue(response);
    const { add, store, data, save } = setup();
    await add();
    await waitForIcons(data);
    const id = data.subscriptions[0].id;
    const backup = JSON.stringify(createBackup(data));
    let release!: (value: typeof response) => void;
    const started = deferred<void>();
    vi.mocked(requestUrl).mockImplementationOnce(() => deferredResponse(resolve => { release = resolve; started.resolve(); }));
    const refreshing = ownStoreJob(jobs, store.refreshIcon(id));
    await started.promise;
    if (change === "url") {
      await store.updateSubscription(id, { serviceUrl: "https://new.example.com" });
      await waitForIcons(data);
    }
    if (change === "currency icon") await store.updateSubscription(id, { icon: { mode: "none" } });
    if (change === "delete") await store.deleteSubscription(id);
    if (change === "restore") await store.restoreBackupJson(backup, () => true);
    if (change === "provider") await store.updateSettings(settings => { settings.faviconProvider = "none"; });
    if (change === "dispose") store.dispose();
    const before = structuredClone(data);
    const saveCount = save.mock.calls.length;
    release(response);
    expect(await refreshing).toBe(false);
    expect(data).toEqual(before);
    expect(save).toHaveBeenCalledTimes(saveCount);
  });
  it("rolls an icon-only save back without reverting a successful financial edit", async () => {
    vi.mocked(requestUrl).mockResolvedValue(response);
    const { add, store, data, save } = setup();
    await add();
    await waitForIcons(data);
    const id = data.subscriptions[0].id;
    await store.updateSubscription(id, { name: "Saved name" });
    const before = structuredClone(data);
    save.mockRejectedValueOnce(new Error("icon save failed"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(store.refreshIcon(id)).rejects.toThrow("icon save failed");
    expect(data).toEqual(before);
    warning.mockRestore();
  });
  it.each(["text/html", "image/svg+xml", "application/octet-stream"])("ignores a fetched %s MIME", async (contentType) => {
    vi.mocked(requestUrl).mockResolvedValue({ ...response, headers: { "content-type": contentType } });
    const { add, data, save } = setup();
    await add();
    expect(data.subscriptions).toHaveLength(1);
    expect(data.iconCache).toEqual({});
    expect(save).toHaveBeenCalledOnce();
  });
  it("retains valid legacy image cache and rejects malformed or oversized data", () => {
    const { data, icons } = setup();
    for (const mime of ["image/png", "image/gif", "image/jpeg", "image/x-icon"]) {
      const cached = { cacheKey: "key", sourceUrl: "https://example.com", serviceDomain: "example.com", dataUrl: `data:${mime};base64,AQID`, contentType: mime, fetchedOn: "2026-10-04" };
      data.iconCache.key = cached;
      expect(migratePluginData(data).iconCache.key).toEqual(expect.objectContaining(cached));
      expect(icons.getCachedIcon({ icon: { cacheKey: "key" } } as never)).not.toBeNull();
    }
    for (const dataUrl of ["data:image/png;base64,%%%", "data:text/html;base64,AQID", `data:image/png;base64,${"A".repeat(1024 * 1024)}`]) {
      data.iconCache.key.dataUrl = dataUrl;
      expect(migratePluginData(data).iconCache).toEqual({});
      expect(icons.getCachedIcon({ icon: { cacheKey: "key" } } as never)).toBeNull();
    }
  });
});
