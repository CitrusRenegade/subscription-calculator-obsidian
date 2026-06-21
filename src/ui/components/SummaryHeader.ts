import { setIcon } from "obsidian";
import type { CurrencyRegistry } from "../../money/CurrencyRegistry";
import type { MoneyTotal } from "../../types";
import { formatMoney } from "../../money/formatMoney";
import { moneyFromMinor } from "../../money/totals";

export function renderSummaryHeader(
  container: HTMLElement,
  totals: MoneyTotal[],
  registry: CurrencyRegistry
): HTMLElement {
  return renderSummary(container, totals, registry);
}

export function renderFloatingSummary(
  container: HTMLElement,
  totals: MoneyTotal[],
  registry: CurrencyRegistry
): HTMLElement {
  return renderSummary(container, totals, registry, true);
}

function renderSummary(
  container: HTMLElement,
  totals: MoneyTotal[],
  registry: CurrencyRegistry,
  floating = false
): HTMLElement {
  const header = container.createDiv({
    cls: floating
      ? "subscription-calculator-summary subscription-calculator-summary-floating"
      : "subscription-calculator-summary",
  });
  if (floating) {
    header.setAttribute("aria-hidden", "true");
  }
  const title = header.createDiv({ cls: "subscription-calculator-summary-title" });
  title.setText(totals.length === 0 ? "No enabled subscriptions" : "Per year");

  const yearly = header.createDiv({ cls: "subscription-calculator-summary-values" });
  if (totals.length === 0) {
    yearly.createSpan({ text: formatMoney(moneyFromMinor(0, registry.getDefault().code), registry) });
  } else {
    for (const [index, total] of totals.entries()) {
      if (index > 0) {
        const separator = yearly.createSpan({ cls: "subscription-calculator-summary-separator" });
        separator.setAttribute("aria-hidden", "true");
        setIcon(separator, "plus");
      }
      yearly.createSpan({
        text: formatMoney(moneyFromMinor(total.perYearMinor, total.currencyCode), registry),
      });
    }
  }

  if (floating) {
    return header;
  }

  const monthlyRow = header.createDiv({ cls: "subscription-calculator-summary-monthly-row" });
  const monthlyLabel = monthlyRow.createDiv({
    cls: "subscription-calculator-summary-subtitle",
    text: "Average per month",
  });
  monthlyLabel.classList.toggle("is-empty", totals.length === 0);

  const monthly = monthlyRow.createDiv({ cls: "subscription-calculator-summary-monthly" });
  if (totals.length === 0) {
    monthly.createSpan({ text: formatMoney(moneyFromMinor(0, registry.getDefault().code), registry) });
  } else {
    for (const [index, total] of totals.entries()) {
      if (index > 0) {
        const separator = monthly.createSpan({ cls: "subscription-calculator-summary-separator" });
        separator.setAttribute("aria-hidden", "true");
        setIcon(separator, "plus");
      }
      monthly.createSpan({
        text: formatMoney(moneyFromMinor(total.perMonthMinor, total.currencyCode), registry),
      });
    }
  }

  return header;
}
