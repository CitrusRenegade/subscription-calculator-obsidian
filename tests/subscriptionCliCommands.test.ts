import type { CliData, CliFlags, Plugin } from "obsidian";
import { Notice } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { registerSubscriptionCli } from "../src/cli/subscriptions";
import { StoreCommandError } from "../src/data/subscriptionCommands";
import { manualGate, saveGate, storeTest } from "./helpers/storeFixture";
import { useRecordedTimers } from "./helpers/timers";

const { pendingReleases, jobs, fixture } = storeTest();
interface TestResponse {
  ok: boolean;
  error: { code: string; matches: { id: string; name: string }[] };
  data: {
    id: string;
    price: { decimal: string; amountMinor: number; currencyCode: string; scale: number };
    changed: boolean;
    subscription: { id: string; days: number | null; url: string | null; price: { decimal: string; amountMinor: number; currencyCode: string; scale: number } };
    currencies: { code: string; archived: boolean; selectable: boolean }[];
    totals: { perYear: { amountMinor: number } }[];
  };
}
function setup(save?: () => Promise<void>) {
  const saveMock = vi.fn(save ?? (async () => undefined));
  const fixtureResult = fixture(undefined, saveMock);
  fixtureResult.data.settings.faviconProvider = "none";
  const callbacks = new Map<string, (params: CliData) => string | Promise<string>>();
  const flags = new Map<string, CliFlags | null>();
  const plugin = { registerCliHandler(command: string, _description: string, descriptors: CliFlags | null,
    callback: (params: CliData) => string | Promise<string>) {
    callbacks.set(command, callback); flags.set(command, descriptors);
  } } as Plugin;
  registerSubscriptionCli(plugin, fixtureResult.store, fixtureResult.registry);
  const call = async (action: string, params: CliData = {}) => {
    const callback = callbacks.get(`subscription-calculator:${action}`);
    expect(callback, `registered ${action}`).toBeDefined();
    return await callback!(params);
  };
  const json = async (action: string, params: CliData = {}) => JSON.parse(await call(action, { ...params, format: "json" })) as TestResponse;
  return { ...fixtureResult, save: saveMock, callbacks, flags, call, json };
}

/** Assert a queued command is still waiting behind the gate, not settled eagerly. */
async function expectStillPending(promise: Promise<unknown>): Promise<void> {
  let settled = false;
  void promise.then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
}

describe("registered human subscription commands", () => {

  it("registers seven handlers and validates required inputs inside JSON handlers", async () => {
    const { callbacks, flags, json } = setup();
    expect(callbacks.size).toBe(7);
    for (const descriptors of flags.values()) for (const descriptor of Object.values(descriptors ?? {})) {
      expect(descriptor.required).not.toBe(true);
    }
    expect(flags.get("subscription-calculator:new")?.["dry-run"].value).toBeUndefined();
    for (const action of ["get", "new", "set"]) expect(await json(action)).toMatchObject({ apiVersion: 1, ok: false, error: { code: "INVALID_ARGUMENT" }, warnings: [] });
  });

  it("replaces the base command with explicit get for text, JSON and errors", async () => {
    const { callbacks, json, call } = setup();
    await json("new", { name: "Netflix", price: "5" });
    expect(callbacks.has("subscription-calculator")).toBe(false);
    expect(await call("get", { name: "Netflix" })).toContain("Netflix\nID:");
    expect(await json("get", { name: "Netflix" })).toMatchObject({ ok: true, command: "get", data: { name: "Netflix" } });
    expect(await json("get")).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });

  it.each([
    { params: {}, field: "name" },
    { params: { price: "1" }, field: "name" },
    { params: { name: "Service" }, field: "price" },
  ] as { params: CliData; field: string }[])("identifies missing $field without saving or logging an input error", async ({ params, field }) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { json, save } = setup();
    expect(await json("new", params)).toMatchObject({
      ok: false, error: { code: "INVALID_ARGUMENT", field },
    });
    expect(save).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it.each([false, true])("logs an unexpected failure with its original cause, wrapped=%s", async (wrapped) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { json, store } = setup();
    const cause = new Error("private host detail");
    const failure = wrapped ? new StoreCommandError("INTERNAL_ERROR", "The command failed.", undefined, cause) : cause;
    vi.spyOn(store, "readSnapshot").mockRejectedValueOnce(failure);
    const response = await json("list");
    expect(response).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(JSON.stringify(response)).not.toContain("private host detail");
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.any(String), failure);
  });

  it("creates from human fields and edits an exact opaque id, preserving omitted fields", async () => {
    const { json, call, data, save } = setup();
    const created = await json("new", { name: "Netflix", price: "12,3400", url: "example.com", "start-date": "2026-01-01" });
    // Bare host:port normalizes like the GUI instead of misreading "host:" as a scheme.
    const ported = await json("new", { name: "Ported", price: "1", url: "example.com:8080" });
    expect(ported.data.subscription.url).toBe("https://example.com:8080/");
    expect(created).toMatchObject({ apiVersion: 1, ok: true, data: { changed: true, dryRun: false, subscription: { name: "Netflix", period: "monthly", status: "enabled", price: { decimal: "12.34", amountMinor: 1234, currencyCode: "USD", scale: 2 } } } });
    const id = " opaque/短 id "; data.subscriptions[0].id = id;
    expect((await json("set", { id: id.trim(), name: "wrong" })).error.code).toBe("NOT_FOUND");
    const edited = await json("set", { id, name: "Family", "clear-url": "true" });
    expect(edited.data.subscription).toMatchObject({ id, name: "Family", url: null, startDate: "2026-01-01", price: { amountMinor: 1234 } });
    const count = save.mock.calls.length;
    expect((await json("set", { id, price: "12.3400", currency: "usd" })).data.changed).toBe(false);
    expect(save).toHaveBeenCalledTimes(count);
    expect((await json("get", { id })).data.id).toBe(id);
    expect(await call("new", { name: "TextPin", price: "1" })).toContain("Created: TextPin");
  });

  it.each([
    { "dry-run": "false" }, { "dry-run": "1" }, { days: "1e2", period: "custom" },
    { days: "1.5", period: "custom" }, { price: "1e2" }, { price: "-1" }, { price: "0.001" },
    { "start-date": "2026-02-30" }, { url: "javascript:alert(1)" }, { unknown: "x" }, { name: " " },
  ] as CliData[])("rejects malformed create inputs without changing state: %j", async (input) => {
    const { json, data, save } = setup();
    const before = JSON.stringify(data);
    expect((await json("new", { name: "Service", price: "1", ...input })).ok).toBe(false);
    expect(JSON.stringify(data)).toBe(before); expect(save).not.toHaveBeenCalled();
  });

  it("previews without id allocation or saves and enforces period/clear dependencies", async () => {
    const { json, call, data, save, store } = setup();
    const ids = vi.spyOn(crypto, "randomUUID");
    const before = JSON.stringify(data);
    const preview = await json("new", { name: "Preview", price: "0", "dry-run": "true" });
    expect(preview.data).toMatchObject({ dryRun: true, changed: true, subscription: { id: null } });
    expect(await call("new", { name: "Preview", price: "0", "dry-run": "true" })).toContain("Dry run: Would create: Preview");
    expect(ids).not.toHaveBeenCalled(); ids.mockRestore();
    expect(JSON.stringify(data)).toBe(before); expect(save).not.toHaveBeenCalled();
    const created = await json("new", { name: "Custom", price: "1", period: "custom", days: "10" });
    const id = created.data.subscription.id;
    expect((await json("set", { id, period: "custom" })).data.changed).toBe(false);
    expect((await json("set", { id, period: "weekly" })).data.subscription.days).toBeNull();
    expect((await json("set", { id, period: "custom" })).ok).toBe(false);
    expect((await json("set", { id, url: "example.com", "clear-url": "true" })).ok).toBe(false);
    store.dispose();
    expect((await json("new", { name: "Late", price: "1" })).error.code).toBe("UNAVAILABLE");
  });

  it("discovers archived codes and keeps duplicate labels separate with exact scales", async () => {
    const { json, data } = setup();
    data.customCurrencies.push({ code: "ALT", label: "USD", amountMarker: "credits", scale: 8, source: "custom" }, { code: "OLD", label: "USD", scale: 0, source: "custom", isArchived: true });
    const discovery = await json("currencies");
    expect(discovery.data.currencies.find((c: { code: string }) => c.code === "OLD")).toMatchObject({ archived: true, selectable: false });
    const created = await json("new", { name: "Coin", price: "90071992.54740991", currency: "alt", period: "yearly" });
    expect(created.data.subscription.price).toEqual({ decimal: "90071992.54740991", amountMinor: Number.MAX_SAFE_INTEGER, currencyCode: "ALT", scale: 8 });
    expect((await json("new", { name: "Archived", price: "1", currency: "OLD" })).ok).toBe(false);
    data.subscriptions[0].price = { amountMinor: 1, currencyCode: "OLD" };
    expect((await json("set", { id: data.subscriptions[0].id, currency: "old", price: "2" })).ok).toBe(true);
  });

  it("summarizes effective enabled costs using per-record yearly then group monthly rounding", async () => {
    useRecordedTimers();
    const { json, store, data } = setup();
    await json("new", { name: "A", price: "0.05", period: "yearly" });
    await json("new", { name: "B", price: "0.05", period: "yearly" });
    await json("new", { name: "Disabled", price: "99", status: "disabled" });
    expect((await json("summary")).data.totals).toEqual([{ currencyCode: "USD", scale: 2, perYear: { decimal: "0.10", amountMinor: 10 }, perMonth: { decimal: "0.01", amountMinor: 1 } }]);
    await store.setSubscriptionEnabled(data.subscriptions[0].id, false);
    expect((await json("summary")).data.totals[0].perYear.amountMinor).toBe(5);
    data.subscriptions[1].price.amountMinor = Number.MAX_SAFE_INTEGER;
    data.subscriptions[1].billingPeriod = "monthly";
    expect((await json("summary")).error.code).toBe("VALIDATION_FAILED");
  });

  it("returns save errors without notices or causes and preserves raw ambiguity only in JSON", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const notices = Notice as unknown as { messages: string[]; reset(): void }; notices.reset();
    const cause = new Error("private path");
    const save = vi.fn(async (): Promise<void> => { throw cause; });
    const { json, call, data } = setup(save);
    const error = await json("new", { name: "Fail", price: "1" });
    expect(error.error).toMatchObject({ code: "SAVE_FAILED" });
    expect(JSON.stringify(error)).not.toContain("private path"); expect(notices.messages).toEqual([]);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.objectContaining({ code: "SAVE_FAILED", cause }));
    save.mockImplementation(async () => undefined);
    await json("new", { name: "Same", price: "1" }); await json("new", { name: "same", price: "1" });
    data.subscriptions[0].id = "raw\nID";
    expect((await json("get", { name: "same" })).error.matches).toContainEqual({ id: "raw\nID", name: "Same" });
    expect(await call("get", { name: "same" })).toContain("raw ID");
  });

  it.each([false, true])("queries capture settled default and currency metadata after rollback=%s", async (fails) => {
    const gate = manualGate(pendingReleases);
    const { json, data, store } = setup(gate.save);
    data.customCurrencies.push({ code: "ALT", label: "Coin", scale: 8, source: "custom" });
    await json("new", { name: "Coin", price: "0.00000001", currency: "ALT" });
    const id = data.subscriptions[0].id;
    gate.arm();
    const mutation = store.updateSettings((settings) => { settings.defaultCurrency = "ALT"; });
    const outcome = mutation.catch(() => undefined); jobs.push(outcome);
    await gate.started;
    const discovery = json("currencies"); const reading = json("get", { id });
    const preview = json("new", { name: "Preview", price: "1", "dry-run": "true" });
    jobs.push(discovery, reading, preview);
    await expectStillPending(discovery);
    if (fails) gate.fail(new Error("disk full")); else gate.open();
    await outcome;
    expect(await discovery).toMatchObject({ data: { defaultCurrency: fails ? "USD" : "ALT" } });
    expect((await reading).data.price).toEqual({ decimal: "0.00000001", amountMinor: 1, currencyCode: "ALT", scale: 8 });
    expect((await preview).data.subscription.price.currencyCode).toBe(fails ? "USD" : "ALT");
  });

  it("keeps pending-disable dry-run observational while immediate set consumes it atomically", async () => {
    useRecordedTimers();
    const { json, store, data, save } = setup();
    await json("new", { name: "Grace", price: "1" }); const id = data.subscriptions[0].id;
    await store.setSubscriptionEnabled(id, false);
    const before = JSON.stringify(data); const timers = vi.getTimerCount(); const count = save.mock.calls.length;
    expect(await json("get", { id })).toMatchObject({ data: { status: "enabled", effectiveStatus: "disabled", inDisableGracePeriod: true } });
    expect(await json("set", { id, status: "enabled", "dry-run": "true" })).toMatchObject({ data: { changed: true, dryRun: true, subscription: { status: "enabled", effectiveStatus: "enabled", inDisableGracePeriod: false } } });
    expect(JSON.stringify(data)).toBe(before); expect(vi.getTimerCount()).toBe(timers); expect(save).toHaveBeenCalledTimes(count);
    expect(await json("set", { id, status: "disabled", name: "Disabled" })).toMatchObject({ data: { changed: true, subscription: { status: "disabled", effectiveStatus: "disabled", inDisableGracePeriod: false } } });
    expect(save).toHaveBeenCalledTimes(count + 1); expect(vi.getTimerCount()).toBe(0);
  });

  it("runs a set issued during an unresolved delete against the settled record after rollback", async () => {
    const saves = saveGate(pendingReleases, 2);
    const { json, data, store } = setup(saves.save);
    await json("new", { name: "Temp", price: "1" });
    const id = data.subscriptions[0].id;
    const deleting = store.deleteSubscription(id);
    jobs.push(deleting);
    await saves.started;

    // The record is provisionally absent behind the in-flight delete. Unlike the
    // GUI, the CLI does not park: the command queues and runs against whichever
    // dataset settles, so a rolled-back delete cannot lose or fail it eagerly.
    const setting = json("set", { id, name: "Later" });
    jobs.push(setting);
    await expectStillPending(setting);

    saves.fail(new Error("disk full"));
    await expect(deleting).rejects.toThrow("disk full");
    expect(await setting).toMatchObject({ ok: true, data: { changed: true, subscription: { name: "Later" } } });
    expect(data.subscriptions).toHaveLength(1);
  });

  it("rejects cumulative overflow and separates archived and builtin currencies with identical labels", async () => {
    const { json, data } = setup();
    await json("new", { name: "One", price: "90071992547409.91", period: "yearly" });
    await json("new", { name: "Two", price: "0.01", period: "yearly" });
    expect((await json("summary")).error.code).toBe("VALIDATION_FAILED");
    data.subscriptions[0].price.amountMinor = 1;
    data.customCurrencies.push({ code: "ALT", label: "USD", scale: 2, source: "custom", isArchived: true });
    data.subscriptions[1].price.currencyCode = "ALT";
    expect(await json("summary")).toMatchObject({ ok: true, data: { totals: [ { currencyCode: "ALT", perYear: { amountMinor: 1 } }, { currencyCode: "USD", perYear: { amountMinor: 1 } } ] } });
    expect(await json("get", { id: data.subscriptions[0].id })).toMatchObject({ data: { id: data.subscriptions[0].id, price: { decimal: "0.01" }, days: null, startDate: null, url: null, disabledOn: null } });
    expect(Object.keys((await json("get", { id: data.subscriptions[0].id })).data).sort()).toEqual(["id", "name", "status", "effectiveStatus", "inDisableGracePeriod", "price", "period", "days", "startDate", "url", "createdOn", "updatedOn", "disabledOn"].sort());
  });
});
