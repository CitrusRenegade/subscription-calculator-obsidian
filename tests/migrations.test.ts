import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUSTOM_BILLING_PERIOD_DAYS,
  MAX_CUSTOM_BILLING_PERIOD_DAYS,
} from "../src/constants";
import { migratePluginData } from "../src/data/migrations";
import { DEFAULT_SETTINGS } from "../src/data/defaultData";
import { sub } from "./helpers/subscriptionFactory";
import { withProtoKey } from "./helpers/protoKey";

describe("plugin data migrations", () => {
  it("OBS-36 defaults the floating yearly total to off and preserves explicit choices", () => {
    expect(migratePluginData({}).settings.floatingYearlyTotal).toBe(false);
    expect(
      migratePluginData({ settings: { floatingYearlyTotal: true } }).settings
        .floatingYearlyTotal
    ).toBe(true);
    expect(
      migratePluginData({ settings: { floatingYearlyTotal: "yes" } }).settings
        .floatingYearlyTotal
    ).toBe(false);
  });

  it("defaults display precision to whole numbers and preserves tenths", () => {
    expect(migratePluginData({}).settings.moneyDisplayPrecision).toBe(0);
    expect(
      migratePluginData({ settings: { moneyDisplayPrecision: 1 } }).settings
        .moneyDisplayPrecision
    ).toBe(1);
    expect(
      migratePluginData({ settings: { moneyDisplayPrecision: 2 } }).settings
        .moneyDisplayPrecision
    ).toBe(0);
  });

  it("repairs defaults that do not name a selectable currency", () => {
    expect(
      migratePluginData({ settings: { defaultCurrency: "GHOST" } }).settings.defaultCurrency
    ).toBe(DEFAULT_SETTINGS.defaultCurrency);
    expect(
      migratePluginData({
        settings: { defaultCurrency: "TOK" },
        customCurrencies: [
          { code: "TOK", label: "Tokens", scale: 0, source: "custom", isArchived: true },
        ],
      }).settings.defaultCurrency
    ).toBe(DEFAULT_SETTINGS.defaultCurrency);
    expect(
      migratePluginData({
        settings: { defaultCurrency: "TOK" },
        customCurrencies: [{ code: "TOK", label: "Tokens", scale: 0, source: "custom" }],
      }).settings.defaultCurrency
    ).toBe("TOK");
  });

  it.each([
    ["without a day count", undefined],
    ["with a fractional day count", 1.5],
    ["beyond the supported date range", MAX_CUSTOM_BILLING_PERIOD_DAYS + 1],
  ] as const)("repairs a custom billing period %s", (_label, days) => {
    const data = migratePluginData({
      subscriptions: [
        sub({
          id: "period",
          billingPeriod: "custom",
          customBillingPeriodDays: days,
          icon: { mode: "auto" },
        }),
      ],
    });

    expect(data.subscriptions[0]?.customBillingPeriodDays).toBe(
      DEFAULT_CUSTOM_BILLING_PERIOD_DAYS
    );
  });

  it("drops unknown persisted fields while repairing a custom billing period", () => {
    const data = migratePluginData({
      subscriptions: [
        sub({
          id: "spotify",
          billingPeriod: "custom",
          startDate: "2026-06-01",
          icon: { mode: "auto" },
          cancelUrl: "https://spotify.com/cancel",
        }),
      ],
    });

    expect(data.subscriptions[0]?.customBillingPeriodDays).toBe(
      DEFAULT_CUSTOM_BILLING_PERIOD_DAYS
    );
    expect(data.subscriptions[0]).not.toHaveProperty("cancelUrl");
  });

  it("preserves special icon-cache keys as own entries", () => {
    const iconCache: Record<string, unknown> = withProtoKey({}, {
      sourceUrl: "https://example.com/favicon.png",
      serviceDomain: "example.com",
      dataUrl: "data:image/png;base64,icon",
      contentType: "image/png",
      fetchedOn: "2026-06-01",
    });

    const data = migratePluginData({ iconCache });

    expect(Object.keys(data.iconCache)).toContain("__proto__");
    expect(data.iconCache["__proto__"]?.cacheKey).toBe("__proto__");
  });

  it("does not synthesize disabled dates during migration", () => {
    const data = migratePluginData({
      subscriptions: [
        sub({ id: "paused", status: "disabled", updatedOn: "2026-06-10" }),
        sub({ id: "explicitly-disabled", status: "disabled", updatedOn: "2026-06-10", disabledOn: "2026-06-07" }),
      ],
    });

    expect(data.subscriptions[0]?.disabledOn).toBeUndefined();
    expect(data.subscriptions[1]?.disabledOn).toBe("2026-06-07");
  });

  it("initializes and sanitizes custom currencies", () => {
    expect(migratePluginData({}).customCurrencies).toEqual([]);

    const data = migratePluginData({
      customCurrencies: [
        {
          code: "custom_ab12cd",
          label: "tok",
          amountMarker: "🪙",
          scale: 2,
          source: "custom",
        },
        {
          code: "CUSTOM_BAD",
          label: "",
          amountMarker: "",
          scale: 9,
          source: "custom",
        },
        {
          code: "CUSTOM_OLD1",
          shortName: "pts",
          symbol: "pts",
          scale: 0,
          source: "custom",
        },
        {
          code: "CUSTOM_HIGH",
          label: "hi",
          amountMarker: "hi",
          scale: 8,
          source: "custom",
        },
        {
          code: "tok",
          label: "legacy",
          amountMarker: "tok",
          scale: 2,
          source: "custom",
        },
        {
          code: "USD",
          label: "usd custom",
          amountMarker: "$",
          scale: 2,
          source: "custom",
        },
      ],
    });

    expect(data.customCurrencies).toEqual([
      {
        code: "CUSTOM_AB12CD",
        label: "TOK",
        amountMarker: "🪙",
        scale: 2,
        source: "custom",
        isArchived: false,
      },
      {
        code: "CUSTOM_OLD1",
        label: "PTS",
        amountMarker: "pts",
        scale: 0,
        source: "custom",
        isArchived: false,
      },
      {
        code: "CUSTOM_HIGH",
        label: "HI",
        amountMarker: "hi",
        scale: 8,
        source: "custom",
        isArchived: false,
      },
      {
        code: "TOK",
        label: "LEGACY",
        amountMarker: "tok",
        scale: 2,
        source: "custom",
        isArchived: false,
      },
    ]);
  });

  it("drops subscriptions that violate persisted-data invariants", () => {
    const data = migratePluginData({
      subscriptions: [
        sub({ id: "duplicate", name: "First" }),
        sub({ id: "duplicate", name: "Second" }),
        sub({ id: "negative", price: { amountMinor: -1, currencyCode: "USD" } }),
        sub({ id: "unknown-currency", price: { amountMinor: 100, currencyCode: "GHOST" } }),
      ],
    });

    expect(data.subscriptions.map((item) => item.id)).toEqual(["duplicate"]);
  });
});
