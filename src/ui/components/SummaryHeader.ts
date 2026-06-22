import { setIcon } from "obsidian";
import type { CurrencyRegistry } from "../../money/CurrencyRegistry";
import type { MoneyDisplayPrecision, MoneyTotal } from "../../types";
import { formatMoney } from "../../money/formatMoney";
import { moneyFromMinor } from "../../money/totals";

export function renderSummaryHeader(
  container: HTMLElement,
  totals: MoneyTotal[],
  registry: CurrencyRegistry,
  displayPrecision: MoneyDisplayPrecision
): HTMLElement {
  return renderSummary(container, totals, registry, displayPrecision);
}

export function renderFloatingSummary(
  container: HTMLElement,
  totals: MoneyTotal[],
  registry: CurrencyRegistry,
  displayPrecision: MoneyDisplayPrecision
): HTMLElement {
  return renderSummary(container, totals, registry, displayPrecision, true);
}

export function updateFloatingSummary(
  header: HTMLElement,
  totals: MoneyTotal[],
  registry: CurrencyRegistry,
  displayPrecision: MoneyDisplayPrecision
): void {
  header.empty();
  renderSummaryContents(header, totals, registry, displayPrecision, true);
}

function renderSummary(
  container: HTMLElement,
  totals: MoneyTotal[],
  registry: CurrencyRegistry,
  displayPrecision: MoneyDisplayPrecision,
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
  renderSummaryContents(header, totals, registry, displayPrecision, floating);
  return header;
}

function renderSummaryContents(
  header: HTMLElement,
  totals: MoneyTotal[],
  registry: CurrencyRegistry,
  displayPrecision: MoneyDisplayPrecision,
  floating: boolean
): void {
  const title = header.createDiv({ cls: "subscription-calculator-summary-title" });
  title.setText(totals.length === 0 ? "No enabled subscriptions" : "Per year");

  const yearly = header.createDiv({ cls: "subscription-calculator-summary-values" });
  if (totals.length === 0) {
    const term = yearly.createSpan({ cls: "subscription-calculator-summary-term" });
    term.createSpan({
      cls: "subscription-calculator-summary-amount",
      text: formatMoney(
        moneyFromMinor(0, registry.getDefault().code),
        registry,
        displayPrecision
      ),
    });
  } else {
    for (const [index, total] of totals.entries()) {
      const term = yearly.createSpan({ cls: "subscription-calculator-summary-term" });
      if (index > 0) {
        const separator = term.createSpan({ cls: "subscription-calculator-summary-separator" });
        separator.setAttribute("aria-hidden", "true");
        setIcon(separator, "plus");
      }
      term.createSpan({
        cls: "subscription-calculator-summary-amount",
        text: formatMoney(
          moneyFromMinor(total.perYearMinor, total.currencyCode),
          registry,
          displayPrecision
        ),
      });
    }
  }

  if (floating) {
    return;
  }

  const monthlyRow = header.createDiv({ cls: "subscription-calculator-summary-monthly-row" });
  const monthlyLabel = monthlyRow.createDiv({
    cls: "subscription-calculator-summary-subtitle",
    text: "Average per month",
  });
  monthlyLabel.classList.toggle("is-empty", totals.length === 0);

  const monthly = monthlyRow.createDiv({ cls: "subscription-calculator-summary-monthly" });
  if (totals.length === 0) {
    const term = monthly.createSpan({ cls: "subscription-calculator-summary-term" });
    term.createSpan({
      cls: "subscription-calculator-summary-amount",
      text: formatMoney(
        moneyFromMinor(0, registry.getDefault().code),
        registry,
        displayPrecision
      ),
    });
  } else {
    for (const [index, total] of totals.entries()) {
      const term = monthly.createSpan({ cls: "subscription-calculator-summary-term" });
      if (index > 0) {
        const separator = term.createSpan({ cls: "subscription-calculator-summary-separator" });
        separator.setAttribute("aria-hidden", "true");
        setIcon(separator, "plus");
      }
      term.createSpan({
        cls: "subscription-calculator-summary-amount",
        text: formatMoney(
          moneyFromMinor(total.perMonthMinor, total.currencyCode),
          registry,
          displayPrecision
        ),
      });
    }
  }
}
