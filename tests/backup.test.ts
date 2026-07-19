import { describe, expect, it } from "vitest";
import {
  createBackup,
  parseBackup,
  replacePluginData,
  restoreBackupData,
} from "../src/data/backup";
import type { PluginData } from "../src/types";

function createData(): PluginData {
  return {
    schemaVersion: 7,
    settings: {
      openMode: "right-sidebar",
      defaultCurrency: "USD",
      showDisabled: false,
      faviconProvider: "google-s2",
      confirmBeforeDelete: true,
      moneyDisplayPrecision: 0,
      floatingYearlyTotal: false,
      sortMode: "alphabetical",
      sortDirection: "ascending",
    },
    subscriptions: [
      {
        id: "netflix",
        name: "Netflix",
        status: "enabled",
        price: { amountMinor: 1599, currencyCode: "USD" },
        billingPeriod: "monthly",
        icon: { mode: "auto", cacheKey: "google-s2:netflix.com" },
        createdOn: "2026-07-19",
        updatedOn: "2026-07-19",
      },
    ],
    iconCache: {
      "google-s2:netflix.com": {
        cacheKey: "google-s2:netflix.com",
        sourceUrl: "https://example.com/favicon.png",
        serviceDomain: "netflix.com",
        dataUrl: "data:image/png;base64,abc",
        contentType: "image/png",
        fetchedOn: "2026-07-19",
      },
    },
    customCurrencies: [
      { code: "TOK", label: "Tokens", scale: 0, source: "custom" },
    ],
  };
}

describe("subscription backup", () => {
  it("exports a portable envelope without favicon cache data", () => {
    const backup = createBackup(createData(), "2026-07-19T10:00:00.000Z");

    expect(backup).toMatchObject({
      format: "subscription-calculator-backup",
      version: 1,
      exportedAt: "2026-07-19T10:00:00.000Z",
      payload: {
        settings: { defaultCurrency: "USD" },
        customCurrencies: [{ code: "TOK" }],
      },
    });
    expect(backup.payload).not.toHaveProperty("iconCache");
    expect(backup.payload.subscriptions[0].icon).not.toHaveProperty("cacheKey");
  });

  it("migrates valid data in memory and reports skipped invalid records", () => {
    const backup = createBackup(createData(), "2026-07-19T10:00:00.000Z");
    backup.payload.subscriptions.push({ id: "invalid" } as never);
    backup.payload.customCurrencies.push({ code: "BAD" } as never);

    const result = parseBackup(JSON.stringify(backup));

    expect(result.data.subscriptions.map((item) => item.id)).toEqual(["netflix"]);
    expect(result.data.iconCache).toEqual({});
    expect(result.report).toEqual({
      subscriptions: { imported: 1, skipped: 1 },
      customCurrencies: { imported: 1, skipped: 1 },
    });
  });

  it("skips duplicate ids, negative prices, and unknown currencies", () => {
    const backup = createBackup(createData(), "2026-07-19T10:00:00.000Z");
    const original = backup.payload.subscriptions[0];
    backup.payload.subscriptions.push(
      { ...original, price: { ...original.price, amountMinor: 2000 } },
      {
        ...original,
        id: "negative",
        price: { ...original.price, amountMinor: -1 },
      },
      {
        ...original,
        id: "unknown-currency",
        price: { ...original.price, currencyCode: "GHOST" },
      }
    );

    const result = parseBackup(JSON.stringify(backup));

    expect(result.data.subscriptions.map((item) => item.id)).toEqual(["netflix"]);
    expect(result.report.subscriptions).toEqual({ imported: 1, skipped: 3 });
  });

  it("keeps a subscription that uses a custom currency from the same backup", () => {
    const backup = createBackup(createData(), "2026-07-19T10:00:00.000Z");
    backup.payload.subscriptions[0].price.currencyCode = "TOK";

    const result = parseBackup(JSON.stringify(backup));

    expect(result.data.subscriptions[0]?.price.currencyCode).toBe("TOK");
    expect(result.report.subscriptions).toEqual({ imported: 1, skipped: 0 });
  });

  it("rejects a future backup version before producing imported data", () => {
    const backup = createBackup(createData(), "2026-07-19T10:00:00.000Z");
    backup.version = 2;

    expect(() => parseBackup(JSON.stringify(backup))).toThrow(
      "Backup version 2 is newer than this plugin supports."
    );
  });

  it("rejects malformed JSON and an unrelated format", () => {
    expect(() => parseBackup("{")).toThrow("Backup file is not valid JSON.");
    expect(() =>
      parseBackup(
        JSON.stringify({
          format: "other-plugin-backup",
          version: 1,
          exportedAt: "2026-07-19T10:00:00.000Z",
          payload: { settings: {}, subscriptions: [], customCurrencies: [] },
        })
      )
    ).toThrow("This file is not a Subscription Calculator backup.");
  });

  it("replaces data in place and clears the derived favicon cache", () => {
    const current = createData();
    const rootReference = current;
    const replacement = parseBackup(JSON.stringify(createBackup(createData()))).data;
    replacement.settings.defaultCurrency = "EUR";

    replacePluginData(current, replacement);

    expect(current).toBe(rootReference);
    expect(current.settings.defaultCurrency).toBe("EUR");
    expect(current.subscriptions).toEqual(replacement.subscriptions);
    expect(current.iconCache).toEqual({});
  });

  it("replaces current data without invoking a download callback", async () => {
    const current = createData();
    const replacement = createData();
    replacement.settings.defaultCurrency = "EUR";
    const order: string[] = [];

    const actions = {
      confirm: (preview) => {
        order.push("confirm");
        expect(preview.subscriptions.imported).toBe(1);
        return true;
      },
      flush: async () => {
        order.push("flush");
      },
      downloadSafetyBackup: () => {
        order.push("download");
      },
      save: async () => {
        order.push("save");
        expect(current.settings.defaultCurrency).toBe("EUR");
      },
      notify: () => {
        order.push("notify");
      },
    } as Parameters<typeof restoreBackupData>[2] & {
      downloadSafetyBackup: () => void;
    };

    const report = await restoreBackupData(
      current,
      JSON.stringify(createBackup(replacement)),
      actions
    );

    expect(report?.subscriptions.imported).toBe(1);
    expect(current.settings.defaultCurrency).toBe("EUR");
    expect(order).toEqual(["confirm", "flush", "save", "notify"]);
  });

  it("does not mutate current data when parsing fails or confirmation is declined", async () => {
    const current = createData();
    const before = JSON.stringify(current);
    const actions = {
      confirm: () => false,
      flush: async () => {
        throw new Error("flush should not run");
      },
      save: async () => {
        throw new Error("save should not run");
      },
      notify: () => {
        throw new Error("notify should not run");
      },
    };

    await expect(restoreBackupData(current, "{", actions)).rejects.toThrow(
      "Backup file is not valid JSON."
    );
    expect(JSON.stringify(current)).toBe(before);

    await expect(
      restoreBackupData(
        current,
        JSON.stringify({
          format: "other-plugin-backup",
          version: 1,
          exportedAt: "2026-07-19T10:00:00.000Z",
          payload: { settings: {}, subscriptions: [], customCurrencies: [] },
        }),
        actions
      )
    ).rejects.toThrow("This file is not a Subscription Calculator backup.");
    expect(JSON.stringify(current)).toBe(before);

    await expect(
      restoreBackupData(current, JSON.stringify(createBackup(createData())), actions)
    ).resolves.toBeNull();
    expect(JSON.stringify(current)).toBe(before);
  });

  it("restores pre-flush data and notifies when flushing delayed changes fails", async () => {
    const current = createData();
    const before = JSON.stringify(current);
    const order: string[] = [];

    await expect(
      restoreBackupData(current, JSON.stringify(createBackup(createData())), {
        confirm: () => true,
        flush: async () => {
          order.push("flush");
          current.subscriptions[0].status = "disabled";
          throw new Error("flush save failed");
        },
        save: async () => {
          order.push("save");
        },
        notify: () => {
          order.push("notify");
        },
      })
    ).rejects.toThrow("flush save failed");

    expect(JSON.stringify(current)).toBe(before);
    expect(order).toEqual(["flush", "notify"]);
  });

  it("rolls current data back in place and notifies when the restore save fails", async () => {
    const current = createData();
    const rootReference = current;
    const before = JSON.stringify(current);
    const replacement = createData();
    replacement.settings.defaultCurrency = "EUR";
    const order: string[] = [];

    await expect(
      restoreBackupData(current, JSON.stringify(createBackup(replacement)), {
        confirm: () => true,
        flush: async () => {
          order.push("flush");
        },
        save: async () => {
          order.push("save");
          expect(current.settings.defaultCurrency).toBe("EUR");
          throw new Error("disk full");
        },
        notify: () => {
          order.push("notify");
        },
      })
    ).rejects.toThrow("disk full");

    expect(current).toBe(rootReference);
    expect(JSON.stringify(current)).toBe(before);
    expect(order).toEqual(["flush", "save", "notify"]);
  });
});
