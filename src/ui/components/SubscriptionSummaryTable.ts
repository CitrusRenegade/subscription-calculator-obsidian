import type { CurrencyRegistry } from "../../money/CurrencyRegistry";
import type { IconService } from "../../icons/IconService";
import type { MoneyDisplayPrecision, SubscriptionItem } from "../../types";
import { formatMoney } from "../../money/formatMoney";
import { getPerYearMinor, moneyFromMinor } from "../../money/totals";
import { renderSubscriptionIcon } from "./SubscriptionCard";

export function renderSubscriptionSummaryTable(
  container: HTMLElement,
  items: SubscriptionItem[],
  registry: CurrencyRegistry,
  iconService: IconService,
  displayPrecision: MoneyDisplayPrecision
): void {
  const section = container.createDiv({ cls: "subscription-calculator-table" });
  const header = section.createDiv({ cls: "subscription-calculator-table-row is-header" });
  header.createDiv({ text: "What you pay for" });
  header.createDiv({ text: "Per year" });

  if (items.length === 0) {
    const empty = section.createDiv({
      cls: "subscription-calculator-table-empty",
      text: "Enabled subscriptions will appear here.",
    });
    empty.setAttr("aria-live", "polite");
    return;
  }

  for (const item of items) {
    const row = section.createDiv({ cls: "subscription-calculator-table-row" });
    const name = row.createDiv({ cls: "subscription-calculator-table-name" });
    renderSubscriptionIcon(name, item, iconService, registry);
    name.createSpan({ text: item.name });
    row.createDiv({
      cls: "subscription-calculator-table-money",
      text: formatMoney(
        moneyFromMinor(getPerYearMinor(item), item.price.currencyCode),
        registry,
        displayPrecision
      ),
    });
  }
}
