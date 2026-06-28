import { describe, expect, it } from "vitest";
import { DEFAULT_CUSTOM_BILLING_PERIOD_DAYS } from "../src/constants";
import { migratePluginData } from "../src/data/migrations";

describe("plugin data migrations", () => {
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

  it("repairs a custom billing period without a day count", () => {
    const data = migratePluginData({
      subscriptions: [
        {
          id: "spotify",
          name: "Spotify",
          status: "enabled",
          price: { amountMinor: 999, currencyCode: "USD" },
          startDate: "2026-06-01",
          billingPeriod: "custom",
          cancelUrl: "https://spotify.com/cancel",
          icon: { mode: "auto" },
          createdOn: "2026-06-01",
          updatedOn: "2026-06-01",
        },
      ],
    });

    expect(data.subscriptions[0]?.customBillingPeriodDays).toBe(
      DEFAULT_CUSTOM_BILLING_PERIOD_DAYS
    );
    expect(data.subscriptions[0]).not.toHaveProperty("cancelUrl");
  });

  it("does not synthesize disabled dates during migration", () => {
    const data = migratePluginData({
      subscriptions: [
        {
          id: "paused",
          name: "Paused",
          status: "disabled",
          price: { amountMinor: 999, currencyCode: "USD" },
          billingPeriod: "monthly",
          icon: { mode: "none" },
          createdOn: "2026-06-01",
          updatedOn: "2026-06-10",
        },
        {
          id: "explicitly-disabled",
          name: "Explicitly disabled",
          status: "disabled",
          price: { amountMinor: 999, currencyCode: "USD" },
          billingPeriod: "monthly",
          icon: { mode: "none" },
          createdOn: "2026-06-01",
          updatedOn: "2026-06-10",
          disabledOn: "2026-06-07",
        },
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
});
