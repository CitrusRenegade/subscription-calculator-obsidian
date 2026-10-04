import { afterEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { createDefaultData } from "../src/data/defaultData";
import { SubscriptionStore } from "../src/data/SubscriptionStore";
import { IconService } from "../src/icons/IconService";
import { DataBackedCurrencyRegistry } from "../src/money/CurrencyRegistry";
import { migratePluginData } from "../src/data/migrations";
import { createBackup } from "../src/data/backup";

vi.mock("obsidian", async () => ({ ...(await import("./obsidianMock")), requestUrl: vi.fn() }));
const response = { status: 200, json: null, text: "", headers: { "content-type": "image/png" }, arrayBuffer: new Uint8Array([1, 2, 3]).buffer };
function deferredResponse(setRelease: (release: (value: typeof response) => void) => void): ReturnType<typeof requestUrl> {
  const pending = new Promise<typeof response>(resolve => setRelease(resolve));
  return Object.assign(pending, { arrayBuffer: pending.then(value => value.arrayBuffer), json: pending.then(value => value.json), text: pending.then(value => value.text) });
}
function setup(save = vi.fn(async () => undefined)) {
  const data = createDefaultData();
  const icons = new IconService(data, () => data.settings.faviconProvider);
  const registry = new DataBackedCurrencyRegistry(() => data.settings.defaultCurrency, () => data.customCurrencies);
  const store = new SubscriptionStore(data, registry, icons, save);
  const add = (name = "Service", url = "https://example.com") => store.addSubscription({ name, serviceUrl: url, priceText: "12", currencyCode: "USD", billingPeriod: "monthly" });
  return { data, icons, store, add, save };
}
describe("icon reliability", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.mocked(requestUrl).mockReset(); });
  it("saves financial edits and reads backups while an add icon request is unresolved", async () => {
    let release!: (value: typeof response) => void;
    vi.mocked(requestUrl).mockImplementation(() => deferredResponse(resolve => { release = resolve; }));
    const { store, add, data, save } = setup();
    const adding = add();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    try {
      expect(save).toHaveBeenCalledOnce();
      const editing = store.updateSubscription(data.subscriptions[0].id, { name: "Updated" });
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      await editing;
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
    expect(requestUrl).toHaveBeenCalledOnce();
    expect(data.subscriptions[0].icon.cacheKey).toBe(data.subscriptions[1].icon.cacheKey);
    expect(await store.refreshAllIcons()).toEqual({ refreshed: 2, failed: 0, skipped: 0 });
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });
  it("coalesces concurrent same-domain adds and releases failed requests for retry", async () => {
    let release!: (value: typeof response) => void;
    vi.mocked(requestUrl).mockImplementationOnce(() => deferredResponse(resolve => { release = resolve; }));
    const { add, data, store } = setup();
    const first = add("One"); const second = add("Two");
    await vi.waitFor(() => expect(data.subscriptions).toHaveLength(2));
    await store.readSnapshot();
    expect(requestUrl).toHaveBeenCalledOnce();
    release(response); await Promise.all([first, second]);
    expect(data.subscriptions.every(item => item.icon.cacheKey === "google-s2:example.com")).toBe(true);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(requestUrl).mockRejectedValueOnce(new Error("offline"));
    expect(await store.refreshIcon(data.subscriptions[0].id)).toBe(false);
    vi.mocked(requestUrl).mockResolvedValueOnce(response);
    expect(await store.refreshIcon(data.subscriptions[0].id)).toBe(true);
    expect(requestUrl).toHaveBeenCalledTimes(3);
  });
  it("does not revive a later batch item cleared while another domain refresh waits", async () => {
    vi.mocked(requestUrl).mockResolvedValue(response);
    const { add, store, data } = setup();
    await add("One"); await add("Two", "https://two.example.com");
    let release!: (value: typeof response) => void;
    vi.mocked(requestUrl).mockImplementationOnce(() => deferredResponse(resolve => { release = resolve; }));
    const refreshing = store.refreshAllIcons();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await store.clearIcon(data.subscriptions[1].id);
    release(response);
    expect(await refreshing).toEqual({ refreshed: 1, failed: 0, skipped: 1 });
    expect(data.subscriptions[1].icon.cacheKey).toBeUndefined();
    expect(requestUrl).toHaveBeenCalledTimes(3);
  });
  it("keeps a newer shared-domain refresh when an older batch reaches another item", async () => {
    vi.mocked(requestUrl).mockResolvedValue(response);
    const { add, store, data } = setup();
    await add("One"); await add("Two", "https://two.example.com"); await add("Three");
    let release!: (value: typeof response) => void;
    const older = { ...response, arrayBuffer: new Uint8Array([2]).buffer };
    const newer = { ...response, arrayBuffer: new Uint8Array([9]).buffer };
    vi.mocked(requestUrl).mockResolvedValueOnce(older)
      .mockImplementationOnce(() => deferredResponse(resolve => { release = resolve; }))
      .mockResolvedValueOnce(newer);
    const refreshing = store.refreshAllIcons();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
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
    let releaseBatch!: (value: typeof response) => void;
    let releaseNewer!: (value: typeof response) => void;
    vi.mocked(requestUrl).mockResolvedValueOnce({ ...response, arrayBuffer: new Uint8Array([2]).buffer })
      .mockImplementationOnce(() => deferredResponse(resolve => { releaseBatch = resolve; }))
      .mockImplementationOnce(() => deferredResponse(resolve => { releaseNewer = resolve; }));
    const batch = store.refreshAllIcons();
    await vi.waitFor(() => expect(releaseBatch).toBeTypeOf("function"));
    const newer = store.refreshIcon(data.subscriptions[0].id);
    await vi.waitFor(() => expect(releaseNewer).toBeTypeOf("function"));
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
    await store.deleteSubscription(data.subscriptions[0].id);
    expect(Object.keys(data.iconCache)).toHaveLength(1);
    save.mockRejectedValueOnce(new Error("disk full"));
    await expect(store.deleteSubscription(data.subscriptions[0].id)).rejects.toThrow("disk full");
    expect(Object.keys(data.iconCache)).toHaveLength(1);
    await store.deleteSubscription(data.subscriptions[0].id);
    expect(data.iconCache).toEqual({});
  });
  it.each(["url", "clear", "delete", "restore", "provider", "dispose"] as const)("discards a deferred refresh after newer %s intent", async (change) => {
    vi.mocked(requestUrl).mockResolvedValue(response);
    const { add, store, data, save } = setup();
    await add();
    const id = data.subscriptions[0].id;
    const backup = JSON.stringify(createBackup(data));
    let release!: (value: typeof response) => void;
    vi.mocked(requestUrl).mockImplementationOnce(() => deferredResponse(resolve => { release = resolve; }));
    const refreshing = store.refreshIcon(id);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    if (change === "url") await store.updateSubscription(id, { serviceUrl: "https://new.example.com" });
    if (change === "clear") await store.clearIcon(id);
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
