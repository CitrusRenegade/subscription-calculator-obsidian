import type { BillingPeriod, Money, MoneyTotal, SubscriptionItem } from "../types";

export function getPaymentsPerYear(
  period: BillingPeriod,
  customDays?: number
): number {
  switch (period) {
    case "weekly":
      return 52;
    case "monthly":
      return 12;
    case "quarterly":
      return 4;
    case "yearly":
      return 1;
    case "custom":
      return customDays && customDays > 0 ? 365 / customDays : 0;
  }
}

export function getPerYearMinor(item: SubscriptionItem): number {
  return Math.round(
    item.price.amountMinor *
      getPaymentsPerYear(item.billingPeriod, item.customBillingPeriodDays)
  );
}

export function getPerMonthMinor(item: SubscriptionItem): number {
  return Math.round(getPerYearMinor(item) / 12);
}

export function calculateTotalsByCurrency(
  subscriptions: SubscriptionItem[]
): MoneyTotal[] {
  const totals = new Map<string, { perYearMinor: number; subscriptionCount: number }>();
  for (const item of subscriptions) {
    const current = totals.get(item.price.currencyCode);
    totals.set(item.price.currencyCode, {
      perYearMinor: (current?.perYearMinor ?? 0) + getPerYearMinor(item),
      subscriptionCount: (current?.subscriptionCount ?? 0) + 1,
    });
  }
  return Array.from(totals.entries())
    .sort(
      ([currencyCodeA, totalA], [currencyCodeB, totalB]) =>
        totalB.subscriptionCount - totalA.subscriptionCount ||
        currencyCodeA.localeCompare(currencyCodeB)
    )
    .map(([currencyCode, { perYearMinor }]) => ({
      currencyCode,
      perYearMinor,
      perMonthMinor: Math.round(perYearMinor / 12),
    }));
}

export function moneyFromMinor(amountMinor: number, currencyCode: string): Money {
  return { amountMinor, currencyCode };
}
