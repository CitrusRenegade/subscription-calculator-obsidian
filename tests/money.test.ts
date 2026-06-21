import { describe, expect, it } from "vitest";
import { BuiltinCurrencyRegistry } from "../src/money/CurrencyRegistry";
import { formatMoney } from "../src/money/formatMoney";
import { parseMoneyInput } from "../src/money/parseMoneyInput";
import { calculateTotalsByCurrency, getPerYearMinor, moneyFromMinor } from "../src/money/totals";
import type { SubscriptionItem } from "../src/types";

const registry = new BuiltinCurrencyRegistry();

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
  it("parses input to minor units by currency scale", () => {
    expect(parseMoneyInput("19.99", "USD", registry)).toEqual({
      amountMinor: 1999,
      currencyCode: "USD",
    });
    expect(parseMoneyInput("1200", "JPY", registry)).toEqual({
      amountMinor: 1200,
      currencyCode: "JPY",
    });
    expect(parseMoneyInput("1.23", "JPY", registry)).toBeNull();
  });

  it("formats minor-unit money for display", () => {
    expect(formatMoney(moneyFromMinor(1999, "USD"), registry)).toMatch(
      /^20 \$$/
    );
    expect(formatMoney(moneyFromMinor(3878000, "USD"), registry)).toMatch(
      /^38\u00A0780 \$$/
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
