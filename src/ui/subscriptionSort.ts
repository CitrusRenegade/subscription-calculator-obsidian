import type { SubscriptionViewItem } from "../types";

export type SubscriptionSortMode = "alphabetical" | "status";
export type SubscriptionSortDirection = "ascending" | "descending";

export function sortSubscriptions(
  items: SubscriptionViewItem[],
  mode: SubscriptionSortMode,
  direction: SubscriptionSortDirection
): SubscriptionViewItem[] {
  const directionMultiplier = direction === "ascending" ? 1 : -1;

  return [...items].sort((a, b) => {
    if (mode === "status" && a.effectiveStatus !== b.effectiveStatus) {
      return (a.effectiveStatus === "enabled" ? -1 : 1) * directionMultiplier;
    }

    return (
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) *
      directionMultiplier
    );
  });
}
