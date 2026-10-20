import { describe, expect, it, vi } from "vitest";
import { createBackup } from "../src/data/backup";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import { DISABLE_GRACE_PERIOD_MS } from "../src/constants";
import { createDefaultData } from "../src/data/defaultData";
import { formatLocalDate } from "../src/date/dateOnly";
import { gatedSaves, ownStoreJob, primaryGate, storeTest } from "./helpers/storeFixture";
import { deferred } from "./helpers/deferred";
import { useRecordedTimers } from "./helpers/timers";
import { buildData } from "./helpers/subscriptionFactory";

const { pendingReleases, jobs, fixture } = storeTest();

const today = () => formatLocalDate(new Date());

describe("subscription command status races", () => {
  it.each([{ priceText: "invalid" }, { startDate: "invalid" }])("does not cancel an earlier CLI status when a form patch is invalid: %j", async (invalid) => {
    const gate = primaryGate(pendingReleases);
    const { store, data } = fixture(buildData(), gate.save);
    const blocker = ownStoreJob(jobs, store.updateSubscription("ab1", { name: "Blocking" }));
    await gate.started;
    const cli = ownStoreJob(jobs, store.setSubscription("ab1", { status: "disabled" }));
    const form = ownStoreJob(jobs, store.updateSubscription("ab1", { ...invalid, status: "enabled" }));
    gate.open(); await blocker;
    expect(await cli).toMatchObject({ persistedStatus: "disabled", changed: true });
    await expect(form).rejects.toThrow();
    expect(data.subscriptions[0].status).toBe("disabled");
  });
  it("applies a CLI status issued after a queued form save", async () => {
    const gate = primaryGate(pendingReleases);
    const { store, data } = fixture(buildData(), gate.save);
    const blocker = ownStoreJob(jobs, store.updateSubscription("ab1", { name: "Blocking" }));
    await gate.started;
    const form = ownStoreJob(jobs, store.updateSubscription("ab1", { name: "Saved", status: "disabled" }));
    const cli = ownStoreJob(jobs, store.setSubscription("ab1", { status: "enabled" }));
    gate.open(); await blocker; await form; await cli;
    expect(data.subscriptions[0]).toMatchObject({ name: "Saved", status: "enabled" });
  });

  it("keeps the pending disable and its original deadline across a successful fields-only set", async () => {
    const { delays, fire } = useRecordedTimers();
    const saves = vi.fn(async () => undefined);
    const { data, store } = fixture(buildData(), saves);
    await store.setSubscriptionEnabled("ab1", false);
    vi.advanceTimersByTime(500);

    const result = await store.setSubscription("ab1", { name: "Fields only" });

    expect(result).toMatchObject({
      changed: true,
      persistedStatus: "enabled",
      effectiveStatus: "disabled",
      statusPending: true,
    });
    expect(saves).toHaveBeenCalledTimes(1);
    expect(data.subscriptions[0]).toMatchObject({
      name: "Fields only",
      status: "enabled",
      updatedOn: today(),
    });
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS]);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS - 500);

    expect(data.subscriptions[0]?.status).toBe("disabled");
    expect(data.subscriptions[0]?.disabledOn).toBe(today());
    expect(saves).toHaveBeenCalledTimes(2);
    expect(fire).toHaveLength(1);
  });

  it("keeps the pending disable and its original deadline across a failed fields-only set", async () => {
    const { delays, fire } = useRecordedTimers();
    let saveCount = 0;
    const { data, store } = fixture(buildData(), async () => {
      saveCount += 1;
      if (saveCount === 1) throw new Error("disk full");
    });
    await store.setSubscriptionEnabled("ab1", false);
    vi.advanceTimersByTime(500);

    await expect(store.setSubscription("ab1", { name: "Fields only" }))
      .rejects.toMatchObject({ code: "SAVE_FAILED" });

    expect(data.subscriptions[0]).toMatchObject({
      name: "Old name",
      status: "enabled",
      updatedOn: "2026-01-01",
    });
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS]);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS - 500);

    expect(data.subscriptions[0]?.status).toBe("disabled");
    expect(saveCount).toBe(2);
    expect(fire).toHaveLength(1);
  });

  it("reschedules a flush-failed disable for its remaining deadline, not a fresh interval", async () => {
    const { delays } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save);
    await store.setSubscriptionEnabled("ab1", false);
    vi.advanceTimersByTime(1000);

    const flushing = ownStoreJob(jobs, store.flushDisableGracePeriods());
    await gate.started;
    gate.fail();

    await expect(flushing).rejects.toThrow("disk full");
    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS, DISABLE_GRACE_PERIOD_MS - 1000]);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS - 1000);

    expect(data.subscriptions[0]?.status).toBe("disabled");
    expect(gate.calls).toBe(2);
  });

  it("lets a gui disable issued during an unresolved cli enable win when the enable succeeds", async () => {
    const { delays } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData({ status: "disabled", disabledOn: "2026-01-01" }), gate.save);

    const enabling = ownStoreJob(jobs, store.setSubscription("ab1", { status: "enabled" }));
    await gate.started;
    await store.setSubscriptionEnabled("ab1", false);
    expect(store.getEnabledSubscriptions()).toHaveLength(0);

    gate.open();
    const result = await enabling;

    expect(result).toMatchObject({
      changed: true,
      persistedStatus: "enabled",
      effectiveStatus: "disabled",
      statusPending: true,
    });
    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(gate.calls).toBe(1);
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS]);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]).toMatchObject({ status: "disabled", disabledOn: today() });
    expect(gate.calls).toBe(2);
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
  });

  it("keeps the gui disable deadline intact when the cli enable it raced against fails", async () => {
    const { delays, fire } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData({ status: "disabled", disabledOn: "2026-01-01" }), gate.save);

    const enabling = ownStoreJob(jobs, store.setSubscription("ab1", { status: "enabled" }));
    await gate.started;
    await store.setSubscriptionEnabled("ab1", false);
    gate.fail();

    await expect(enabling).rejects.toMatchObject({ code: "SAVE_FAILED" });

    expect(data.subscriptions[0]).toMatchObject({
      name: "Old name",
      status: "disabled",
      disabledOn: "2026-01-01",
      updatedOn: "2026-01-01",
    });
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
    expect(gate.calls).toBe(1);
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS]);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]?.status).toBe("disabled");
    expect(gate.calls).toBe(1);
    expect(fire).toHaveLength(1);
  });

  it("reconciles a gui enable issued while a cli enable save is unresolved and then fails", async () => {
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData({ status: "disabled", disabledOn: "2026-01-01" }), gate.save);

    const cliEnabling = ownStoreJob(jobs, store.setSubscription("ab1", { status: "enabled" }));
    await gate.started;
    const guiEnabling = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", true));
    gate.fail();

    await expect(cliEnabling).rejects.toMatchObject({ code: "SAVE_FAILED" });
    await guiEnabling;

    expect(data.subscriptions[0]).toMatchObject({
      name: "Old name",
      status: "enabled",
      disabledOn: undefined,
      updatedOn: today(),
    });
    expect(gate.calls).toBe(2);
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
    expect(store.getDisabledSubscriptions()).toHaveLength(0);
  });

  it("supersedes a queued cli disable with a gui enable issued before it executes", async () => {
    const { delays } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save);

    const busyUpdate = ownStoreJob(jobs, store.updateSubscription("ab1", { name: "Busy rename" }));
    await gate.started;

    const disabling = ownStoreJob(jobs, store.setSubscription("ab1", { status: "disabled" }));
    const enabling = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", true));
    gate.open();

    await busyUpdate;
    const result = await disabling;
    await enabling;

    expect(result).toMatchObject({
      changed: false,
      persistedStatus: "enabled",
      effectiveStatus: "enabled",
      statusPending: false,
    });
    expect(data.subscriptions[0]).toMatchObject({ name: "Busy rename", status: "enabled" });
    expect(gate.calls).toBe(1);
    expect(delays).toEqual([]);
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
  });

  it("does not let an earlier cli status command supersede a later cli command", async () => {
    const saves = vi.fn(async () => undefined);
    const { data, store } = fixture(buildData(), saves);

    const disabling = ownStoreJob(jobs, store.setSubscription("ab1", { status: "disabled" }));
    const enabling = ownStoreJob(jobs, store.setSubscription("ab1", { status: "enabled" }));

    const disableResult = await disabling;
    const enableResult = await enabling;

    expect(disableResult).toMatchObject({ changed: true, persistedStatus: "disabled" });
    expect(enableResult).toMatchObject({
      changed: true,
      persistedStatus: "enabled",
      effectiveStatus: "enabled",
      statusPending: false,
    });
    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(data.subscriptions[0]?.disabledOn).toBeUndefined();
    expect(saves).toHaveBeenCalledTimes(2);
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
  });

  it("applies the fields of a status command superseded by a later gui action", async () => {
    const { delays } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save);

    const busyUpdate = ownStoreJob(jobs, store.updateSubscription("ab1", { name: "Busy rename" }));
    await gate.started;

    const setting = ownStoreJob(jobs, store.setSubscription("ab1", {
      name: "CLI rename",
      status: "disabled",
    }));
    const enabling = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", true));
    gate.open();

    await busyUpdate;
    const result = await setting;
    await enabling;

    expect(result).toMatchObject({
      changed: true,
      persistedStatus: "enabled",
      effectiveStatus: "enabled",
      statusPending: false,
    });
    expect(data.subscriptions[0]).toMatchObject({ name: "CLI rename", status: "enabled" });
    expect(gate.calls).toBe(2);
    expect(delays).toEqual([]);
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
  });

  it("applies a queued cli status command issued while a restore was in flight", async () => {
    const gate = primaryGate(pendingReleases);
    const data = buildData();
    const backup = JSON.stringify(createBackup(data));
    const { store } = fixture(data, gate.save);

    const restoring = ownStoreJob(jobs, store.restoreBackupJson(backup, () => true));
    const setting = ownStoreJob(jobs, store.setSubscription("ab1", { status: "disabled" }));
    gate.open();

    await restoring;
    const result = await setting;

    expect(result).toMatchObject({ changed: true, persistedStatus: "disabled", statusPending: false });
    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "disabled" });
    expect(gate.calls).toBe(2);
  });

  it("applies a queued cli status command after a restore fails", async () => {
    const { delays } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const data = buildData();
    const backup = JSON.stringify(createBackup(data));
    const { store } = fixture(data, gate.save);
    await store.setSubscriptionEnabled("ab1", false);

    const restoring = ownStoreJob(jobs, store.restoreBackupJson(backup, () => true));
    await gate.started;
    const setting = ownStoreJob(jobs, store.setSubscription("ab1", { status: "enabled" }));
    gate.fail();

    await expect(restoring).rejects.toThrow("disk full");
    const result = await setting;

    expect(result).toMatchObject({ changed: true, persistedStatus: "enabled" });
    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "enabled" });
    expect(data.subscriptions[0]?.disabledOn).toBeUndefined();
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS, DISABLE_GRACE_PERIOD_MS]);
  });

  it("does not leak a gui disable issued while a restore flush is unresolved", async () => {
    const { fire } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const data = buildData();
    const backup = JSON.stringify(createBackup(data));
    const { store } = fixture(data, gate.save);
    await store.setSubscriptionEnabled("ab1", false);

    const restoring = ownStoreJob(jobs, store.restoreBackupJson(backup, () => true));
    await gate.started;
    await store.setSubscriptionEnabled("ab1", false);
    gate.open();

    await restoring;

    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "enabled" });
    // The replacement dataset must not inherit a stale pending intent.
    expect(store.getDisabledSubscriptions()).toHaveLength(0);

    fire[0]?.();
    fire[1]?.();
    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(store.getDisabledSubscriptions()).toHaveLength(0);
  });

  it("preserves a gui enable issued while the record was provisionally deleted", async () => {
    const { delays, fire } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save);
    await store.setSubscriptionEnabled("ab1", false);

    const deleting = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await gate.started;
    const enabling = store.setSubscriptionEnabled("ab1", true);
    gate.fail();

    await expect(deleting).rejects.toThrow("disk full");
    await enabling;

    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "enabled" });
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
    expect(store.getDisabledSubscriptions()).toHaveLength(0);

    fire[0]?.();
    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS]);
  });

  it("keeps a gui disable issued while the record was provisionally deleted at its deadline", async () => {
    const { fire } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save);
    await store.setSubscriptionEnabled("ab1", false);
    vi.advanceTimersByTime(500);

    const deleting = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await gate.started;
    const disabling = store.setSubscriptionEnabled("ab1", false);
    gate.fail();

    await expect(deleting).rejects.toThrow("disk full");
    await disabling;

    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "enabled" });
    expect(store.getEnabledSubscriptions()).toHaveLength(0);

    fire[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(data.subscriptions[0]?.status).toBe("enabled");

    // The parked disable armed at its own invocation deadline (t=500 + grace).
    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]).toMatchObject({ status: "disabled", disabledOn: today() });
    expect(fire).toHaveLength(2);
  });

  it("re-arms an expiry whose save failed with a fresh interval and no tight retry loop", async () => {
    const { delays, fire } = useRecordedTimers();
    let saveCount = 0;
    const { data, store } = fixture(buildData(), async () => {
      saveCount += 1;
      if (saveCount === 1) throw new Error("disk full");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await store.setSubscriptionEnabled("ab1", false);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS, DISABLE_GRACE_PERIOD_MS]);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]).toMatchObject({ status: "disabled", disabledOn: today() });
    expect(saveCount).toBe(2);
    expect(fire).toHaveLength(2);
  });

  it("reconciles an expiry retry inside the queue so a queued cli enable still wins", async () => {
    const { delays } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save);
    await store.setSubscriptionEnabled("ab1", false);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);
    const setting = ownStoreJob(jobs, store.setSubscription("ab1", { status: "enabled" }));
    gate.fail();

    const result = await setting;

    // The queued command consumed the reinstated intent inside its own transaction.
    expect(result).toMatchObject({
      changed: true,
      persistedStatus: "enabled",
      effectiveStatus: "enabled",
      statusPending: false,
    });
    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(gate.calls).toBe(1);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    // No retry may overwrite the newer command.
    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(gate.calls).toBe(1);
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS, DISABLE_GRACE_PERIOD_MS]);
  });

  it("re-arms a failed expiry with bounded saves while preserving the original deadline", async () => {
    const { delays, fire } = useRecordedTimers();
    let saveCount = 0;
    const { data, store } = fixture(buildData(), async () => {
      saveCount += 1;
      if (saveCount <= 2) throw new Error("disk full");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await store.setSubscriptionEnabled("ab1", false);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);
    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(store.getEnabledSubscriptions()).toHaveLength(0);

    // A consuming command that also persists fields fails: its rollback reinstates
    // the intent whose original deadline is already due, so the retry persists
    // immediately instead of silently restarting a fresh grace window.
    await expect(store.setSubscription("ab1", { name: "Race rename", status: "enabled" }))
      .rejects.toMatchObject({ code: "SAVE_FAILED" });
    await vi.advanceTimersByTimeAsync(0);

    expect(data.subscriptions[0]).toMatchObject({ status: "disabled", disabledOn: today() });
    expect(data.subscriptions[0]?.name).toBe("Old name");
    expect(delays).toEqual([
      DISABLE_GRACE_PERIOD_MS,
      DISABLE_GRACE_PERIOD_MS,
      0,
    ]);
    expect(saveCount).toBe(3);
    expect(fire).toHaveLength(3);
  });

  it("keeps a sustained expiry failure bounded without tight retry loops", async () => {
    const { delays } = useRecordedTimers();
    let saveCount = 0;
    const { data, store } = fixture(buildData(), async () => {
      saveCount += 1;
      throw new Error("disk full");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await store.setSubscriptionEnabled("ab1", false);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);
    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);
    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(saveCount).toBe(3);
    expect(delays).toEqual([
      DISABLE_GRACE_PERIOD_MS,
      DISABLE_GRACE_PERIOD_MS,
      DISABLE_GRACE_PERIOD_MS,
      DISABLE_GRACE_PERIOD_MS,
    ]);
    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
  });

  it("keeps a newer gui action winning over a failed expiry retry", async () => {
    const { delays } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save);
    await store.setSubscriptionEnabled("ab1", false);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);
    const enabling = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", true));
    gate.fail();
    await enabling;

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
    expect(store.getDisabledSubscriptions()).toHaveLength(0);
    expect(gate.calls).toBe(1);
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS]);
  });

  it("reconciles a gui enable parked during a failed delete of a disabled record", async () => {
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(
      buildData({ status: "disabled", disabledOn: "2026-01-01" }),
      gate.save
    );

    const deleting = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await gate.started;
    const enabling = store.setSubscriptionEnabled("ab1", true);
    gate.fail();

    await expect(deleting).rejects.toThrow("disk full");
    await enabling;

    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "enabled", disabledOn: undefined });
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
    expect(gate.calls).toBe(2);
  });

  it("keeps a gui disable parked during a failed delete pending at its own deadline", async () => {
    const { delays } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save);

    const deleting = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await gate.started;
    const disabling = store.setSubscriptionEnabled("ab1", false);
    gate.fail();

    await expect(deleting).rejects.toThrow("disk full");
    await disabling;

    // The parked disable is effective immediately and persists at the user deadline.
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
    expect(store.getDisabledSubscriptions()).toHaveLength(1);
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS]);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]).toMatchObject({ status: "disabled", disabledOn: today() });
  });

  it("lets a parked gui enable supersede a queued cli disable across a failed delete", async () => {
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save);

    const deleting = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await gate.started;
    const setting = ownStoreJob(jobs, store.setSubscription("ab1", { status: "disabled" }));
    const enabling = store.setSubscriptionEnabled("ab1", true);
    gate.fail();

    await expect(deleting).rejects.toThrow("disk full");
    const result = await setting;
    await enabling;

    expect(result).toMatchObject({
      changed: false,
      persistedStatus: "enabled",
      effectiveStatus: "enabled",
      statusPending: false,
    });
    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(gate.calls).toBe(1);
  });

  it("drops parked intents on successful delete and isolates a future same-id record", async () => {
    const { delays, fire } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const data = buildData();
    const backup = JSON.stringify(createBackup(data));
    const { store } = fixture(data, gate.save);
    await store.setSubscriptionEnabled("ab1", false);

    const deleting = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await gate.started;
    const disabling = store.setSubscriptionEnabled("ab1", false);
    gate.open();

    await deleting;
    await disabling;

    expect(data.subscriptions).toHaveLength(0);
    expect(store.getDisabledSubscriptions()).toHaveLength(0);

    await store.restoreBackupJson(backup, () => true);
    fire[0]?.();
    fire[1]?.();
    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "enabled" });
    expect(store.getDisabledSubscriptions()).toHaveLength(0);
    // The parked intent was dropped with the record; only the initial timer exists.
    expect(delays).toHaveLength(1);
  });

  it.each([
    ["enabled", 2],
    ["disabled", 3],
  ])("initially %s: a parked gui enable then a later cli disable end disabled", async (
    initialStatus,
    expectedSaves
  ) => {
    const { delays } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(
      buildData(initialStatus === "disabled" ? { status: "disabled", disabledOn: "2026-01-01" } : {}),
      gate.save
    );

    const deleting = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await gate.started;
    const enabling = store.setSubscriptionEnabled("ab1", true);
    const disabling = ownStoreJob(jobs, store.setSubscription("ab1", { status: "disabled" }));
    gate.fail();

    await expect(deleting).rejects.toThrow("disk full");
    await enabling;
    const result = await disabling;

    expect(result).toMatchObject({ changed: true, persistedStatus: "disabled" });
    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "disabled" });
    expect(gate.calls).toBe(expectedSaves);
    // Neither the parked enable nor the cli disable arms a timer.
    expect(delays).toHaveLength(0);
  });

  it.each([
    ["enabled", 1],
    ["disabled", 2],
  ])("initially %s: a parked gui disable then a later cli enable end enabled without pending", async (
    initialStatus,
    expectedSaves
  ) => {
    const { delays } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(
      buildData(initialStatus === "disabled" ? { status: "disabled", disabledOn: "2026-01-01" } : {}),
      gate.save
    );

    const deleting = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await gate.started;
    const disabling = store.setSubscriptionEnabled("ab1", false);
    const enabling = ownStoreJob(jobs, store.setSubscription("ab1", { status: "enabled" }));
    gate.fail();

    await expect(deleting).rejects.toThrow("disk full");
    await disabling;
    const result = await enabling;

    expect(result).toMatchObject({
      changed: true,
      persistedStatus: "enabled",
      statusPending: false,
    });
    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "enabled" });
    expect(gate.calls).toBe(expectedSaves);
    expect(store.getDisabledSubscriptions()).toHaveLength(0);
    // Only the parked disable arms a timer; the cli enable consumes it.
    expect(delays).toHaveLength(1);
  });

  it("keeps a later gui action winning when it is parked after an earlier cli command", async () => {
    const { delays } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save);

    const deleting = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await gate.started;
    const disabling = ownStoreJob(jobs, store.setSubscription("ab1", { status: "disabled" }));
    const disablingAction = store.setSubscriptionEnabled("ab1", false);
    const enablingAction = store.setSubscriptionEnabled("ab1", true);
    gate.fail();

    await expect(deleting).rejects.toThrow("disk full");
    const result = await disabling;
    await disablingAction;
    await enablingAction;

    expect(result).toMatchObject({ changed: false, persistedStatus: "enabled" });
    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "enabled" });
    expect(gate.calls).toBe(1);
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
    expect(delays).toHaveLength(0);
  });

  it("keeps the latest cli command winning over earlier parked gui actions", async () => {
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save);

    const deleting = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await gate.started;
    const disablingAction = store.setSubscriptionEnabled("ab1", false);
    const enablingAction = store.setSubscriptionEnabled("ab1", true);
    const disabling = ownStoreJob(jobs, store.setSubscription("ab1", { status: "disabled" }));
    gate.fail();

    await expect(deleting).rejects.toThrow("disk full");
    await disablingAction;
    await enablingAction;
    const result = await disabling;

    expect(result).toMatchObject({ changed: true, persistedStatus: "disabled" });
    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "disabled" });
    expect(gate.calls).toBe(2);
  });

  it("keeps a newer restore superseding a parked enable that reconciled before it", async () => {
    const gate = primaryGate(pendingReleases);
    const backup = JSON.stringify(
      createBackup(buildData({ status: "disabled", disabledOn: "2026-01-01" }))
    );
    const { data, store } = fixture(
      buildData({ status: "disabled", disabledOn: "2026-01-01" }),
      gate.save
    );

    const deleting = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await gate.started;
    const enabling = store.setSubscriptionEnabled("ab1", true);
    const restoring = ownStoreJob(jobs, store.restoreBackupJson(backup, () => true));
    gate.fail();

    await expect(deleting).rejects.toThrow("disk full");
    await enabling;
    await restoring;

    // The parked enable reconciled against its own (restored-by-rollback) dataset;
    // the newer replacement then supersedes that data.
    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "disabled" });
    expect(gate.calls).toBe(3);
  });

  it("drops a parked gui reconcile whose dataset was replaced before its slot", async () => {
    const gate = primaryGate(pendingReleases);
    const backup = JSON.stringify(
      createBackup(buildData({ status: "disabled", disabledOn: "2026-01-01" }))
    );
    const { data, store } = fixture(
      buildData({ status: "disabled", disabledOn: "2026-01-01" }),
      gate.save
    );

    const deleting = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await gate.started;
    const restoring = ownStoreJob(jobs, store.restoreBackupJson(backup, () => true));
    const enabling = store.setSubscriptionEnabled("ab1", true);
    gate.fail();

    await expect(deleting).rejects.toThrow("disk full");
    await restoring;
    await enabling;

    // The reconcile belongs to the invocation dataset, which the restore replaced.
    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "disabled" });
    expect(gate.calls).toBe(2);
  });

  it("keeps a parked gui reconcile from saving after disposal", async () => {
    const gate = primaryGate(pendingReleases);
    const backup = JSON.stringify(createBackup(buildData()));
    const { data, store } = fixture(
      buildData({ status: "disabled", disabledOn: "2026-01-01" }),
      gate.save
    );

    const deleting = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await gate.started;
    const enabling = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", true));
    const restoring = ownStoreJob(jobs, store.restoreBackupJson(backup, () => true));
    store.dispose();
    gate.fail();

    await expect(deleting).rejects.toThrow("disk full");
    await expect(restoring).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(enabling).rejects.toMatchObject({ code: "UNAVAILABLE" });

    expect(gate.calls).toBe(1);
    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "disabled" });
  });

  it("keeps a second delete's provisional marker when the first delete's cleanup runs late", async () => {
    const multi = gatedSaves(pendingReleases, 2);
    const { data, store } = fixture(
      buildData({ status: "disabled", disabledOn: "2026-01-01" }),
      multi.save
    );

    const first = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await multi.started[0];
    const second = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    multi.fail(0);
    await expect(first).rejects.toThrow("disk full");
    await multi.started[1];

    // The record is provisionally absent under the second delete: the enable
    // must park and reconcile, not silently vanish.
    const enabling = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", true));
    multi.fail(1);

    await expect(second).rejects.toThrow("disk full");
    await enabling;

    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "enabled", disabledOn: undefined });
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
    expect(multi.calls).toBe(3);
  });

  it("arms a gui disable parked during a second delete at its own deadline", async () => {
    const { delays } = useRecordedTimers();
    const multi = gatedSaves(pendingReleases, 2);
    const { data, store } = fixture(buildData(), multi.save);

    const first = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await multi.started[0];
    const second = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    multi.fail(0);
    await expect(first).rejects.toThrow("disk full");
    await multi.started[1];
    const disabling = store.setSubscriptionEnabled("ab1", false);
    multi.fail(1);

    await expect(second).rejects.toThrow("disk full");
    await disabling;

    expect(store.getEnabledSubscriptions()).toHaveLength(0);
    expect(store.getDisabledSubscriptions()).toHaveLength(1);
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS]);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]).toMatchObject({ status: "disabled", disabledOn: today() });
  });

  it("keeps a prior pending disable from resurrecting when the second delete succeeds", async () => {
    const { delays, fire } = useRecordedTimers();
    const multi = gatedSaves(pendingReleases, 2);
    const data = buildData();
    const backup = JSON.stringify(createBackup(data));
    const { store } = fixture(data, multi.save);
    await store.setSubscriptionEnabled("ab1", false);

    const first = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await multi.started[0];
    const second = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    multi.fail(0);
    await expect(first).rejects.toThrow("disk full");
    await multi.started[1];
    const enabling = store.setSubscriptionEnabled("ab1", true);
    multi.open(1);

    await second;
    await enabling;

    expect(data.subscriptions).toHaveLength(0);

    await store.restoreBackupJson(backup, () => true);
    fire[0]?.();
    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "enabled" });
    expect(store.getDisabledSubscriptions()).toHaveLength(0);
    // Initial intent plus its legitimate reinstatement at the first delete's rollback.
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS, DISABLE_GRACE_PERIOD_MS]);
  });

  it("lets a gui enable parked during a second delete supersede a prior pending disable", async () => {
    const { delays, fire } = useRecordedTimers();
    const multi = gatedSaves(pendingReleases, 2);
    const { data, store } = fixture(buildData(), multi.save);
    await store.setSubscriptionEnabled("ab1", false);

    const first = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    await multi.started[0];
    const second = ownStoreJob(jobs, store.deleteSubscription("ab1"));
    multi.fail(0);
    await expect(first).rejects.toThrow("disk full");
    await multi.started[1];
    const enabling = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", true));
    multi.fail(1);

    await expect(second).rejects.toThrow("disk full");
    await enabling;

    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "enabled" });
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
    expect(store.getDisabledSubscriptions()).toHaveLength(0);
    // The reconcile is a runtime no-op here: no redundant financial save.
    expect(multi.calls).toBe(2);

    fire[0]?.();
    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]?.status).toBe("enabled");
    // Initial intent plus its reinstatement at the first delete's rollback; both
    // were later cancelled by the second delete and never fire again.
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS, DISABLE_GRACE_PERIOD_MS]);
  });

  it("isolates restored same-id records from timers of the replaced dataset", async () => {
    const { delays, fire } = useRecordedTimers();
    const saves = vi.fn(async () => undefined);
    const data = buildData();
    const backup = JSON.stringify(createBackup(data));
    const { store } = fixture(data, saves);
    await store.setSubscriptionEnabled("ab1", false);
    expect(delays).toHaveLength(1);

    await store.restoreBackupJson(backup, () => true);

    expect(data.subscriptions[0]).toMatchObject({ id: "ab1", status: "enabled" });
    const savesAfterRestore = saves.mock.calls.length;

    fire[0]?.();
    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]?.status).toBe("enabled");
    expect(saves.mock.calls.length).toBe(savesAfterRestore);
    expect(delays).toHaveLength(1);
  });

  it.each([
    ["reinstates the original pending disable deadline when a status set fails to save",
      (store: SubscriptionStore): Promise<unknown> => store.setSubscription("ab1", { name: "Race rename", status: "enabled" }),
      (error: unknown) => expect(error).toMatchObject({ code: "SAVE_FAILED" })],
    ["reinstates a delete-rollback disable under the original identity and deadline",
      (store: SubscriptionStore): Promise<unknown> => store.deleteSubscription("ab1"),
      (error: unknown) => expect((error as Error).message).toContain("disk full")],
  ])("%s", async (_title, run, expectRejection) => {
    const { delays, fire } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save);
    await store.setSubscriptionEnabled("ab1", false);
    vi.advanceTimersByTime(500);

    const failing = ownStoreJob(jobs, run(store));
    await gate.started;
    gate.fail();

    expectRejection(await failing.then(() => undefined, (error: unknown) => error));

    expect(data.subscriptions[0]).toMatchObject({ name: "Old name", status: "enabled" });
    expect(data.subscriptions[0]?.id).toBe("ab1");
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS, DISABLE_GRACE_PERIOD_MS - 500]);

    fire[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(data.subscriptions[0]?.status).toBe("enabled");

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS - 500);

    expect(data.subscriptions[0]).toMatchObject({ status: "disabled", disabledOn: today() });
    expect(gate.calls).toBe(2);
    expect(fire).toHaveLength(2);
  });

  it("keeps a pending disable completable when a status set fails validation", async () => {
    const { delays, fire } = useRecordedTimers();
    const saves = vi.fn(async () => undefined);
    const { data, store } = fixture(buildData(), saves);
    await store.setSubscriptionEnabled("ab1", false);

    await expect(store.setSubscription("ab1", { status: "enabled", priceText: "abc" }))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    expect(data.subscriptions[0]).toMatchObject({ name: "Old name", status: "enabled" });
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS]);
    expect(fire).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]?.status).toBe("disabled");
    expect(saves).toHaveBeenCalledTimes(1);
  });

  it("keeps a restore-rejected pending disable completable at its original deadline", async () => {
    const { delays, fire } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const data = buildData();
    const backup = JSON.stringify(createBackup(data));
    const { store } = fixture(data, gate.save);
    await store.setSubscriptionEnabled("ab1", false);
    vi.advanceTimersByTime(500);

    const restoring = ownStoreJob(jobs, store.restoreBackupJson(backup, () => true));
    await gate.started;
    gate.fail();

    await expect(restoring).rejects.toThrow("disk full");

    expect(data.subscriptions).toHaveLength(1);
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS, DISABLE_GRACE_PERIOD_MS - 500]);
    expect(fire).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS - 500);

    expect(data.subscriptions[0]).toMatchObject({ status: "disabled", disabledOn: today() });
    expect(gate.calls).toBe(2);
  });

  it("does not let a cancelled restore era cancel a later disable", async () => {
    const { fire } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save);
    // The disable arms inside the restore window and is cancelled on success.
    const restoring = ownStoreJob(jobs, store.restoreBackupJson(JSON.stringify(createBackup(buildData())), () => true));
    await gate.started;
    await store.setSubscriptionEnabled("ab1", false);
    gate.open();
    await restoring;

    // The cancelled intent's era must not cancel the next disable.
    await store.setSubscription("ab1", { status: "enabled" });
    await store.setSubscriptionEnabled("ab1", false);
    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]).toMatchObject({ status: "disabled", disabledOn: today() });
    expect(fire).toHaveLength(2);
  });

  it.each([true, false])("preserves gui enabled=%s when a failed restore replacement excludes the original id", async (enabled) => {
    const { delays } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData({ status: enabled ? "disabled" : "enabled" }), gate.save);
    const emptyBackup = JSON.stringify(createBackup(createDefaultData()));
    const restoring = ownStoreJob(jobs, store.restoreBackupJson(emptyBackup, () => true));
    await gate.started;
    expect(data.subscriptions).toHaveLength(0);

    const changing = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", enabled));
    vi.advanceTimersByTime(500);
    gate.fail();
    await expect(restoring).rejects.toThrow("disk full");
    await changing;

    expect(data.subscriptions).toHaveLength(1);
    expect(store.getEnabledSubscriptions()).toHaveLength(enabled ? 1 : 0);
    if (enabled) {
      expect(data.subscriptions[0].status).toBe("enabled");
      expect(delays).toEqual([]);
      expect(gate.calls).toBe(2);
    } else {
      expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS - 500]);
      await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS - 500);
      expect(data.subscriptions[0].status).toBe("disabled");
      expect(gate.calls).toBe(2);
    }
  });

  it.each([true, false])("drops gui enabled=%s when a successful restore replacement excludes the original id", async (enabled) => {
    const { delays } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const original = buildData({ status: enabled ? "disabled" : "enabled" });
    const originalBackup = JSON.stringify(createBackup(original));
    const { data, store } = fixture(original, gate.save);
    const restoring = ownStoreJob(jobs, store.restoreBackupJson(JSON.stringify(createBackup(createDefaultData())), () => true));
    await gate.started;
    const changing = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", enabled));
    gate.open();
    await restoring;
    await changing;

    expect(data.subscriptions).toHaveLength(0);
    expect(delays).toEqual([]);
    expect(gate.calls).toBe(1);
    await store.restoreBackupJson(originalBackup, () => true);
    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);
    expect(data.subscriptions[0].status).toBe(enabled ? "disabled" : "enabled");
    expect(delays).toEqual([]);
  });

  it.each([true, false])("keeps only the last gui enabled=%s after a failed restore replacement excludes the original id", async (enabled) => {
    useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { store } = fixture(buildData(), gate.save);
    const restoring = ownStoreJob(jobs, store.restoreBackupJson(JSON.stringify(createBackup(createDefaultData())), () => true));
    await gate.started;
    const first = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", !enabled));
    const last = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", enabled));
    gate.fail();
    await expect(restoring).rejects.toThrow("disk full");
    await Promise.all([first, last]);
    expect(store.getEnabledSubscriptions()).toHaveLength(enabled ? 1 : 0);
  });

  it("persists an overdue gui disable after a failed restore replacement excludes the original id", async () => {
    const { delays } = useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const { data, store } = fixture(buildData(), gate.save);
    const restoring = ownStoreJob(jobs, store.restoreBackupJson(JSON.stringify(createBackup(createDefaultData())), () => true));
    await gate.started;
    const disabling = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", false));
    vi.advanceTimersByTime(DISABLE_GRACE_PERIOD_MS + 500);
    gate.fail();
    await expect(restoring).rejects.toThrow("disk full");
    await disabling;
    expect(delays).toEqual([0]);
    await vi.advanceTimersByTimeAsync(0);
    expect(data.subscriptions[0].status).toBe("disabled");
  });

  it("resolves a gui disable issued during a failed restore replacement against the rolled-back record", async () => {
    const { delays, fire } = useRecordedTimers();
    const savingStarted = deferred<void>();
    const savingGate = deferred<void>();
    pendingReleases.push(() => savingGate.resolve());
    let saveCount = 0;
    const data = buildData();
    const backup = JSON.stringify(createBackup(data));
    const { store } = fixture(data, async () => {
      saveCount += 1;
      if (saveCount !== 1) return;
      savingStarted.resolve();
      await savingGate.promise;
    });

    const restoring = ownStoreJob(jobs, store.restoreBackupJson(backup, () => true));
    await savingStarted.promise;
    await store.setSubscriptionEnabled("ab1", false);
    savingGate.reject(new Error("disk full"));

    await expect(restoring).rejects.toThrow("disk full");

    expect(data.subscriptions).toHaveLength(1);
    expect(store.getEnabledSubscriptions()).toHaveLength(0);
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS]);
    expect(fire).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);

    expect(data.subscriptions[0]).toMatchObject({ status: "disabled", disabledOn: today() });
    expect(saveCount).toBe(2);
  });

  it("cancels a gui disable issued during a successful restore replacement", async () => {
    const { delays, fire } = useRecordedTimers();
    const savingStarted = deferred<void>();
    const savingGate = deferred<void>();
    pendingReleases.push(() => savingGate.resolve());
    let saveCount = 0;
    const data = buildData();
    const backup = JSON.stringify(createBackup(data));
    const { store } = fixture(data, async () => {
      saveCount += 1;
      if (saveCount !== 1) return;
      savingStarted.resolve();
      await savingGate.promise;
    });

    const restoring = ownStoreJob(jobs, store.restoreBackupJson(backup, () => true));
    await savingStarted.promise;
    await store.setSubscriptionEnabled("ab1", false);
    savingGate.resolve();

    await restoring;

    // The click belonged to the replaced dataset: a successful restore comes in
    // clean, with no pending disable left in the visible state.
    expect(data.subscriptions).toHaveLength(1);
    expect(data.subscriptions[0].status).toBe("enabled");
    expect(store.getEnabledSubscriptions()).toHaveLength(1);
    expect(delays).toEqual([DISABLE_GRACE_PERIOD_MS]);
    expect(fire).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS + 500);
    expect(data.subscriptions[0]).toMatchObject({ status: "enabled", disabledOn: undefined });
    expect(saveCount).toBe(1);
  });

  it.each(["unload", "declined restore"] as const)("does not revive a restore-cancelled disable through %s", async (action) => {
    useRecordedTimers();
    const gate = primaryGate(pendingReleases);
    const data = buildData();
    const backup = JSON.stringify(createBackup(data));
    const { store } = fixture(data, gate.save);
    const restoring = ownStoreJob(jobs, store.restoreBackupJson(backup, () => true));
    await gate.started;
    await store.setSubscriptionEnabled("ab1", false);
    gate.open();
    await restoring;

    if (action === "unload") {
      store.dispose();
      await store.readSnapshot();
    } else {
      await store.restoreBackupJson(backup, () => false);
      await vi.advanceTimersByTimeAsync(DISABLE_GRACE_PERIOD_MS);
    }

    expect(data.subscriptions[0].status).toBe("enabled");
    expect(gate.calls).toBe(1);
  });

  it("does not carry a gui enable issued during a successful restore onto the restored record", async () => {
    const gate = primaryGate(pendingReleases);
    const data = buildData();
    const backupData = buildData();
    backupData.subscriptions[0].status = "disabled";
    const backup = JSON.stringify(createBackup(backupData));
    const { store } = fixture(data, gate.save);

    const restoring = ownStoreJob(jobs, store.restoreBackupJson(backup, () => true));
    await gate.started;
    const enabling = ownStoreJob(jobs, store.setSubscriptionEnabled("ab1", true));
    gate.open();

    await restoring;
    await enabling;

    expect(data.subscriptions).toHaveLength(1);
    expect(data.subscriptions[0]).toMatchObject({ status: "disabled", disabledOn: undefined });
    expect(gate.calls).toBe(1);
  });
});
