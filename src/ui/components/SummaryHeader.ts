import type { CurrencyRegistry } from "../../money/CurrencyRegistry";
import type { MoneyTotal } from "../../types";
import { formatMoney } from "../../money/formatMoney";
import { moneyFromMinor } from "../../money/totals";

export function renderSummaryHeader(
  container: HTMLElement,
  totals: MoneyTotal[],
  registry: CurrencyRegistry
): void {
  const header = container.createDiv({ cls: "subscription-calculator-summary" });
  const title = header.createDiv({ cls: "subscription-calculator-summary-title" });
  title.setText(totals.length === 0 ? "No enabled subscriptions" : "Per year");

  const yearly = header.createDiv({ cls: "subscription-calculator-summary-values" });
  if (totals.length === 0) {
    yearly.createDiv({ text: formatMoney(moneyFromMinor(0, registry.getDefault().code), registry) });
  } else {
    for (const total of totals) {
      yearly.createDiv({
        text: formatMoney(moneyFromMinor(total.perYearMinor, total.currencyCode), registry),
      });
    }
  }

  const monthlyRow = header.createDiv({ cls: "subscription-calculator-summary-monthly-row" });
  const monthlyLabel = monthlyRow.createDiv({
    cls: "subscription-calculator-summary-subtitle",
    text: "Average per month",
  });
  monthlyLabel.classList.toggle("is-empty", totals.length === 0);

  const monthly = monthlyRow.createDiv({ cls: "subscription-calculator-summary-monthly" });
  if (totals.length === 0) {
    monthly.createDiv({ text: formatMoney(moneyFromMinor(0, registry.getDefault().code), registry) });
  } else {
    for (const total of totals) {
      monthly.createDiv({
        text: formatMoney(moneyFromMinor(total.perMonthMinor, total.currencyCode), registry),
      });
    }
  }
}
