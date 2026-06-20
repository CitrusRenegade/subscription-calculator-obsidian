import { describe, expect, it } from "vitest";
import type { SubscriptionViewItem } from "../src/types";
import { sortSubscriptions } from "../src/ui/subscriptionSort";

function item(
  name: string,
  effectiveStatus: "enabled" | "disabled"
): SubscriptionViewItem {
  return {
    id: name,
    name,
    status: effectiveStatus,
    effectiveStatus,
    inDisableGracePeriod: false,
    price: { amountMinor: 100, currencyCode: "USD" },
    billingPeriod: "monthly",
    icon: { mode: "none" },
    createdOn: "2026-06-20",
    updatedOn: "2026-06-20",
  };
}

describe("sortSubscriptions", () => {
  it("sorts cards alphabetically", () => {
    const result = sortSubscriptions(
      [item("Zoom", "enabled"), item("Adobe", "disabled")],
      "alphabetical",
      "ascending"
    );

    expect(result.map(({ name }) => name)).toEqual(["Adobe", "Zoom"]);
  });

  it("groups enabled cards before disabled cards and sorts each group by name", () => {
    const result = sortSubscriptions(
      [
        item("Adobe", "disabled"),
        item("Zoom", "enabled"),
        item("Figma", "enabled"),
        item("Canva", "disabled"),
      ],
      "status",
      "ascending"
    );

    expect(result.map(({ name }) => name)).toEqual([
      "Figma",
      "Zoom",
      "Adobe",
      "Canva",
    ]);
  });

  it("reverses alphabetical sorting", () => {
    const result = sortSubscriptions(
      [item("Adobe", "disabled"), item("Zoom", "enabled")],
      "alphabetical",
      "descending"
    );

    expect(result.map(({ name }) => name)).toEqual(["Zoom", "Adobe"]);
  });

  it("reverses status groups and names within each group", () => {
    const result = sortSubscriptions(
      [
        item("Adobe", "disabled"),
        item("Zoom", "enabled"),
        item("Figma", "enabled"),
        item("Canva", "disabled"),
      ],
      "status",
      "descending"
    );

    expect(result.map(({ name }) => name)).toEqual([
      "Canva",
      "Adobe",
      "Zoom",
      "Figma",
    ]);
  });
});
