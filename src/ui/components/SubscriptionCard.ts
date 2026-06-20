import { Notice, setIcon } from "obsidian";
import type { SubscriptionStore } from "../../data/SubscriptionStore";
import { getCurrencyIconName } from "../../icons/currencyIcon";
import type { IconService } from "../../icons/IconService";
import type { CurrencyRegistry } from "../../money/CurrencyRegistry";
import type { SubscriptionItem, SubscriptionViewItem } from "../../types";
import {
  createCurrencySelect,
  createMoneyInput,
  createPeriodSelect,
  createToggleSwitch,
} from "./FormControls";

export function renderSubscriptionIcon(
  container: HTMLElement,
  item: SubscriptionItem,
  iconService: IconService
): void {
  const icon = container.createSpan({ cls: "subscription-calculator-icon" });
  if (item.icon.mode === "emoji" && item.icon.emoji) {
    icon.setText(item.icon.emoji);
    return;
  }
  if (item.icon.mode === "manual-url" && item.icon.manualUrl) {
    icon.createEl("img", { attr: { src: item.icon.manualUrl, alt: "" } });
    return;
  }
  const cached = iconService.getCachedIcon(item);
  if (item.icon.mode === "auto" && cached) {
    icon.createEl("img", { attr: { src: cached.dataUrl, alt: "" } });
    return;
  }
  setIcon(icon, getCurrencyIconName(item.price.currencyCode));
}

function stretchPeriodSelectWhenWrapped(
  controls: HTMLElement,
  periodSelect: HTMLSelectElement
): void {
  let resizeObserver: ResizeObserver | null = null;
  const sync = () => {
    window.requestAnimationFrame(() => {
      if (!controls.isConnected) {
        resizeObserver?.disconnect();
        resizeObserver = null;
        return;
      }

      const firstControl = controls.firstElementChild as HTMLElement | null;
      const controlsBeforePeriod = Array.from(controls.children)
        .slice(0, Array.from(controls.children).indexOf(periodSelect))
        .filter((element): element is HTMLElement => element.instanceOf(HTMLElement));
      periodSelect.classList.remove("is-row-fill");
      periodSelect.style.removeProperty("--subscription-period-row-width");

      const shouldFillRow = Boolean(firstControl && periodSelect.offsetTop > firstControl.offsetTop);
      if (!shouldFillRow) return;

      const rows = new Map<number, { left: number; right: number }>();
      for (const control of controlsBeforePeriod) {
        const rect = control.getBoundingClientRect();
        const row = rows.get(control.offsetTop);
        rows.set(control.offsetTop, {
          left: row ? Math.min(row.left, rect.left) : rect.left,
          right: row ? Math.max(row.right, rect.right) : rect.right,
        });
      }

      const rowWidth = Math.max(
        ...Array.from(rows.values()).map((row) => row.right - row.left),
        periodSelect.getBoundingClientRect().width
      );

      periodSelect.style.setProperty("--subscription-period-row-width", `${Math.ceil(rowWidth)}px`);
      periodSelect.classList.add("is-row-fill");
    });
  };

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(controls);
  }
  sync();
}

export function renderSubscriptionCard(
  container: HTMLElement,
  item: SubscriptionViewItem,
  store: SubscriptionStore,
  registry: CurrencyRegistry,
  iconService: IconService,
  onEdit: () => void,
  onDelete: () => void
): void {
  const card = container.createDiv({ cls: "subscription-calculator-card" });
  card.classList.toggle("is-disabled", item.effectiveStatus === "disabled");
  card.classList.toggle("is-disable-grace-period", item.inDisableGracePeriod);

  const top = card.createDiv({ cls: "subscription-calculator-card-top" });
  const title = top.createDiv({ cls: "subscription-calculator-card-title" });
  renderSubscriptionIcon(title, item, iconService);
  title.createSpan({ cls: "subscription-calculator-card-name", text: item.name });

  const actions = card.createDiv({ cls: "subscription-calculator-card-actions" });
  const edit = actions.createEl("button", {
    cls: "clickable-icon subscription-calculator-icon-button",
    attr: { "aria-label": "Edit subscription", title: "Edit subscription" },
  });
  setIcon(edit, "pencil");
  edit.addEventListener("click", onEdit);

  const remove = actions.createEl("button", {
    cls: "clickable-icon subscription-calculator-icon-button",
    attr: { "aria-label": "Delete subscription", title: "Delete subscription" },
  });
  setIcon(remove, "trash-2");
  remove.addEventListener("click", onDelete);

  createToggleSwitch(
    actions,
    item.effectiveStatus === "enabled",
    (enabled) => void store.setSubscriptionEnabled(item.id, enabled)
  );

  const controls = card.createDiv({ cls: "subscription-calculator-card-controls" });
  createMoneyInput(controls, item.price, registry, (priceText) => {
    void store
      .updateSubscription(item.id, { priceText, currencyCode: item.price.currencyCode })
      .catch((e) => new Notice(e instanceof Error ? e.message : "Failed to update price"));
  });
  createCurrencySelect(controls, registry, item.price.currencyCode, (currencyCode) => {
    const priceInput = controls.querySelector<HTMLInputElement>(
      ".subscription-calculator-money-input"
    );
    void store
      .updateSubscription(item.id, {
        priceText: priceInput?.value ?? "0",
        currencyCode,
      })
      .catch((e) => new Notice(e instanceof Error ? e.message : "Failed to update currency"));
  });
  const periodSelect = createPeriodSelect(controls, item.billingPeriod, (billingPeriod) => {
    void store
      .updateSubscription(item.id, { billingPeriod })
      .catch((e) => new Notice(e instanceof Error ? e.message : "Failed to update period"));
  });
  stretchPeriodSelectWhenWrapped(controls, periodSelect);

  if (item.billingPeriod === "custom") {
    const customInput = controls.createEl("input", {
      cls: "subscription-calculator-custom-days",
      attr: {
        type: "number",
        min: "1",
        step: "1",
        value: String(item.customBillingPeriodDays ?? 30),
        title: "Days",
      },
    });
    customInput.addEventListener("change", () => {
      void store
        .updateSubscription(item.id, {
          customBillingPeriodDays: Number(customInput.value),
        })
        .catch((e) => new Notice(e instanceof Error ? e.message : "Failed to update custom period"));
    });
  }

  if (item.effectiveStatus === "disabled") {
    card.createDiv({
      cls: "subscription-calculator-disabled-note",
      text: item.inDisableGracePeriod
        ? "disable grace period"
        : `disabled on ${item.disabledOn ?? item.updatedOn}`,
    });
  }
}
