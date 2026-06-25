import { describe, expect, it } from "vitest";
import {
  BuiltinCurrencyRegistry,
  DataBackedCurrencyRegistry,
} from "../src/money/CurrencyRegistry";
import {
  getCurrencyAmountMarker,
  getCurrencySelectLabel,
  getCurrencyFallbackIconText,
} from "../src/money/currencyDisplay";
import {
  getGraphemes,
  normalizeCurrencyAmountMarker,
} from "../src/money/currencyValidation";
import { formatMoney } from "../src/money/formatMoney";
import { parseMoneyInput } from "../src/money/parseMoneyInput";
import { calculateTotalsByCurrency, getPerYearMinor, moneyFromMinor } from "../src/money/totals";
import type { CurrencyMeta, SubscriptionItem } from "../src/types";

const registry = new BuiltinCurrencyRegistry();
const customCurrency: CurrencyMeta = {
  code: "CUSTOM_AB12CD",
  label: "TOK",
  amountMarker: "🪙",
  scale: 2,
  source: "custom",
};
const customRegistry = new DataBackedCurrencyRegistry(
  () => "USD",
  () => [customCurrency]
);
const highPrecisionCustomCurrency: CurrencyMeta = {
  code: "CUSTOM_HIGH",
  label: "TOK8",
  amountMarker: "TOK8",
  scale: 8,
  source: "custom",
};
const highPrecisionCustomRegistry = new DataBackedCurrencyRegistry(
  () => "USD",
  () => [highPrecisionCustomCurrency]
);

function subscription(
  name: string,
  amountMinor: number,
  currencyCode: string,
  billingPeriod: SubscriptionItem["billingPeriod"],
  customBillingPeriodDays?: number
): SubscriptionItem {
  return {
    id: name,
    name,
    status: "enabled",
    price: { amountMinor, currencyCode },
    startDate: "2026-06-16",
    billingPeriod,
    customBillingPeriodDays,
    icon: { mode: "none" },
    createdOn: "2026-06-16",
    updatedOn: "2026-06-16",
  };
}

describe("money helpers", () => {
  it("keeps built-in currencies available", () => {
    expect(registry.get("USD")?.label).toBe("USD");
    expect(registry.get("JPY")?.scale).toBe(0);
  });

  it("finds custom currencies and hides internal codes from display labels", () => {
    expect(customRegistry.get("CUSTOM_AB12CD")).toEqual(customCurrency);
    expect(getCurrencySelectLabel(customCurrency)).toBe("TOK 🪙");
    expect(getCurrencySelectLabel(customCurrency)).not.toContain("CUSTOM_");
  });

  it("uses label as amount marker fallback and deduplicates matching markers", () => {
    expect(
      getCurrencySelectLabel({
        code: "CHF",
        label: "CHF",
        scale: 2,
        source: "builtin",
      })
    ).toBe("CHF");
    expect(
      getCurrencyAmountMarker({
        code: "CHF",
        label: "CHF",
        scale: 2,
        source: "builtin",
      })
    ).toBe("CHF");
    expect(getCurrencySelectLabel({ ...customCurrency, amountMarker: "TOK" })).toBe("TOK");
  });

  it("parses input to minor units by currency scale", () => {
    expect(parseMoneyInput("19.99", "USD", registry)).toEqual({
      amountMinor: 1999,
      currencyCode: "USD",
    });
    expect(parseMoneyInput("1200", "JPY", registry)).toEqual({
      amountMinor: 1200,
      currencyCode: "JPY",
    });
    expect(parseMoneyInput("1200.00", "JPY", registry)).toEqual({
      amountMinor: 1200,
      currencyCode: "JPY",
    });
    expect(parseMoneyInput("1.23", "JPY", registry)).toBeNull();
  });

  it("parses custom currency input by custom scale", () => {
    expect(parseMoneyInput("19.99", "CUSTOM_AB12CD", customRegistry)).toEqual({
      amountMinor: 1999,
      currencyCode: "CUSTOM_AB12CD",
    });
    expect(parseMoneyInput("19.999", "CUSTOM_AB12CD", customRegistry)).toBeNull();
  });

  it("keeps legacy high-precision custom currencies parseable", () => {
    expect(parseMoneyInput("0.00000042", "CUSTOM_HIGH", highPrecisionCustomRegistry)).toEqual({
      amountMinor: 42,
      currencyCode: "CUSTOM_HIGH",
    });
    expect(parseMoneyInput("0.000000421", "CUSTOM_HIGH", highPrecisionCustomRegistry)).toBeNull();
  });

  it("formats minor-unit money for display", () => {
    expect(formatMoney(moneyFromMinor(1999, "USD"), registry)).toMatch(
      /^20 \$$/
    );
    expect(formatMoney(moneyFromMinor(3878000, "USD"), registry)).toMatch(
      /^38\u00A0780 \$$/
    );
    expect(formatMoney(moneyFromMinor(1994, "USD"), registry, 1)).toMatch(
      /^19[.,]9 \$$/
    );
    expect(formatMoney(moneyFromMinor(2000, "USD"), registry, 1)).toMatch(
      /^20[.,]0 \$$/
    );
  });

  it("formats custom currencies with their amount marker", () => {
    expect(formatMoney(moneyFromMinor(1999, "CUSTOM_AB12CD"), customRegistry)).toMatch(
      /^20 🪙$/
    );
  });

  it("handles grapheme-based amount marker and fallback icon text rules", () => {
    for (const value of ["🪙", "❤️", "🇺🇦", "1️⃣"]) {
      expect(getGraphemes(value)).toHaveLength(1);
      expect(normalizeCurrencyAmountMarker(value)).toBe(value);
    }

    const textMarkerCurrency: CurrencyMeta = {
      ...customCurrency,
      label: "USDT",
      amountMarker: "USDT",
    };
    expect(normalizeCurrencyAmountMarker("USDT")).toBe("USDT");
    expect(getCurrencyFallbackIconText(textMarkerCurrency)).toBe("US");
    expect(getCurrencyFallbackIconText({ ...customCurrency, amountMarker: "⭐" })).toBe("TO");
  });

  it("keeps archived custom currencies resolvable for old subscriptions", () => {
    const archivedRegistry = new DataBackedCurrencyRegistry(
      () => "USD",
      () => [{ ...customCurrency, isArchived: true }]
    );

    expect(archivedRegistry.listSelectable().map((currency) => currency.code)).not.toContain(
      "CUSTOM_AB12CD"
    );
    expect(formatMoney(moneyFromMinor(1999, "CUSTOM_AB12CD"), archivedRegistry)).toMatch(
      /^20 🪙$/
    );
  });

  it("marks unknown currency formatting as a visible data problem", () => {
    expect(formatMoney(moneyFromMinor(1999, "CUSTOM_MISSING"), customRegistry)).toBe(
      "1 999 ?"
    );
  });

  it("calculates yearly totals and orders currencies by subscription count", () => {
    const chatGpt = subscription("ChatGPT", 2000, "USD", "monthly");
    const yearlyVpn = subscription("VPN", 2400, "USD", "yearly");
    const euroTool = subscription("Euro Tool", 1000, "EUR", "quarterly");

    expect(getPerYearMinor(chatGpt)).toBe(24000);
    expect(calculateTotalsByCurrency([chatGpt, yearlyVpn, euroTool])).toEqual([
      { currencyCode: "USD", perYearMinor: 26400, perMonthMinor: 2200 },
      { currencyCode: "EUR", perYearMinor: 4000, perMonthMinor: 333 },
    ]);
  });

  it("orders currencies alphabetically when subscription counts match", () => {
    const dollarTool = subscription("Dollar Tool", 1000, "USD", "monthly");
    const euroTool = subscription("Euro Tool", 1000, "EUR", "monthly");

    expect(calculateTotalsByCurrency([dollarTool, euroTool]).map((total) => total.currencyCode)).toEqual([
      "EUR",
      "USD",
    ]);
  });

  it("supports custom periods with a 365-day approximation", () => {
    expect(getPerYearMinor(subscription("Custom", 1000, "USD", "custom", 10))).toBe(36500);
  });
});
