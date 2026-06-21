import { describe, expect, it } from "vitest";
import type { SubscriptionViewItem } from "../src/types";
import { sortSubscriptions } from "../src/ui/subscriptionSort";

function item(
  name: string,
  effectiveStatus: "enabled" | "disabled",
  startDate: string | null = "2026-06-20"
): SubscriptionViewItem {
  return {
    id: name,
    name,
    status: effectiveStatus,
    effectiveStatus,
    inDisableGracePeriod: false,
    price: { amountMinor: 100, currencyCode: "USD" },
    startDate: startDate ?? undefined,
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

  it("sorts enabled cards by next payment and keeps disabled cards last", () => {
    const result = sortSubscriptions(
      [
        item("Later", "enabled", "2026-06-25"),
        item("Disabled", "disabled", "2026-06-21"),
        item("Sooner", "enabled", "2026-06-21"),
      ],
      "next-payment",
      "ascending",
      "2026-06-20"
    );

    expect(result.map(({ name }) => name)).toEqual(["Sooner", "Later", "Disabled"]);
  });

  it("reverses next-payment dates without moving disabled cards above enabled ones", () => {
    const result = sortSubscriptions(
      [
        item("Sooner", "enabled", "2026-06-21"),
        item("Disabled", "disabled", "2026-07-01"),
        item("Later", "enabled", "2026-06-25"),
      ],
      "next-payment",
      "descending",
      "2026-06-20"
    );

    expect(result.map(({ name }) => name)).toEqual(["Later", "Sooner", "Disabled"]);
  });

  it("keeps subscriptions without a payment date after dated subscriptions", () => {
    const result = sortSubscriptions(
      [
        item("Unknown", "enabled", null),
        item("Dated", "enabled", "2026-06-21"),
      ],
      "next-payment",
      "descending",
      "2026-06-20"
    );

    expect(result.map(({ name }) => name)).toEqual(["Dated", "Unknown"]);
  });
});
