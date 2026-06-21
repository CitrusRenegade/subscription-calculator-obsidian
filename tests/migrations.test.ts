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
});
