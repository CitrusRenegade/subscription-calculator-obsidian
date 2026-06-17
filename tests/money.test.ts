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
      /^\$19[,.]99$/
    );
  });

  it("calculates yearly totals by currency", () => {
    const chatGpt = subscription("ChatGPT", 2000, "USD", "monthly");
    const yearlyVpn = subscription("VPN", 2400, "USD", "yearly");
    const euroTool = subscription("Euro Tool", 1000, "EUR", "quarterly");

    expect(getPerYearMinor(chatGpt)).toBe(24000);
    expect(calculateTotalsByCurrency([chatGpt, yearlyVpn, euroTool])).toEqual([
      { currencyCode: "EUR", perYearMinor: 4000, perMonthMinor: 333 },
      { currencyCode: "USD", perYearMinor: 26400, perMonthMinor: 2200 },
    ]);
  });

  it("supports custom periods with a 365-day approximation", () => {
    expect(getPerYearMinor(subscription("Custom", 1000, "USD", "custom", 10))).toBe(36500);
  });
});
