import { describe, expect, it } from "vitest";
import { getCurrencyIconName } from "../src/icons/currencyIcon";

describe("currency icon fallback", () => {
  it.each([
    ["USD", "receipt"],
    ["EUR", "receipt-euro"],
    ["RUB", "receipt-russian-ruble"],
    ["GBP", "receipt-pound-sterling"],
    ["JPY", "receipt-japanese-yen"],
    ["CHF", "receipt-swiss-franc"],
  ])("uses the matching receipt icon for %s", (currencyCode, iconName) => {
    expect(getCurrencyIconName(currencyCode)).toBe(iconName);
  });

  it("reserves receipt-text for unsupported currencies", () => {
    expect(getCurrencyIconName("CAD")).toBe("receipt-text");
  });
});
