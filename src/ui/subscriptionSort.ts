import { todayLocalDate } from "../date/dateOnly";
import { getNextPaymentDate } from "../date/paymentSchedule";
import type {
  PluginSettings,
  SubscriptionSortDirection,
  SubscriptionSortMode,
  SubscriptionViewItem,
} from "../types";

export function getSortStateFromSettings(
  settings: Pick<PluginSettings, "sortMode" | "sortDirection">
): { sortMode: SubscriptionSortMode; sortDirection: SubscriptionSortDirection } {
  return {
    sortMode: settings.sortMode,
    sortDirection: settings.sortDirection,
  };
}

export function sortSubscriptions(
  items: SubscriptionViewItem[],
  mode: SubscriptionSortMode,
  direction: SubscriptionSortDirection,
  today = todayLocalDate()
): SubscriptionViewItem[] {
  const directionMultiplier = direction === "ascending" ? 1 : -1;

  return [...items].sort((a, b) => {
    if (mode === "status" && a.effectiveStatus !== b.effectiveStatus) {
      return (a.effectiveStatus === "enabled" ? -1 : 1) * directionMultiplier;
    }

    if (mode === "next-payment") {
      if (a.effectiveStatus !== b.effectiveStatus) {
        return a.effectiveStatus === "enabled" ? -1 : 1;
      }

      const aNextPayment = getNextPaymentDate(
        a.startDate,
        a.billingPeriod,
        today,
        a.customBillingPeriodDays
      );
      const bNextPayment = getNextPaymentDate(
        b.startDate,
        b.billingPeriod,
        today,
        b.customBillingPeriodDays
      );
      if (aNextPayment !== bNextPayment) {
        if (!aNextPayment) return 1;
        if (!bNextPayment) return -1;
        return aNextPayment.localeCompare(bNextPayment) * directionMultiplier;
      }
    }

    return (
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) *
      directionMultiplier
    );
  });
}
