import { setIcon } from "obsidian";
import type { SubscriptionItem } from "../../types";
import type { IconService } from "../../icons/IconService";
import { getCurrencyIconName } from "../../icons/currencyIcon";
import type { CurrencyRegistry } from "../../money/CurrencyRegistry";
import { getCurrencyFallbackIconText } from "../../money/currencyDisplay";

export function renderSubscriptionIcon(
  container: HTMLElement,
  item: SubscriptionItem,
  iconService: Pick<IconService, "getCachedIcon">,
  registry: CurrencyRegistry
): void {
  const icon = container.createSpan({ cls: "subscription-calculator-icon" });
  if (item.icon.mode === "emoji" && item.icon.emoji) {
    icon.setText(item.icon.emoji);
    return;
  }
  const cached = iconService.getCachedIcon(item);
  if (item.icon.mode === "auto" && cached) {
    icon.createEl("img", { attr: { src: cached.dataUrl, alt: "" } });
    return;
  }
  const currency = registry.get(item.price.currencyCode);
  if (currency?.source === "custom") {
    icon.setText(getCurrencyFallbackIconText(currency) || "?");
    return;
  }
  setIcon(icon, getCurrencyIconName(currency?.code ?? item.price.currencyCode));
}
