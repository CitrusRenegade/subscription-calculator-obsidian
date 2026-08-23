import { Notice, setIcon } from "obsidian";
import { DEFAULT_CUSTOM_BILLING_PERIOD_DAYS } from "../../constants";
import type { SubscriptionStore } from "../../data/SubscriptionStore";
import { todayLocalDate } from "../../date/dateOnly";
import {
  formatPaymentCountdown,
  getDaysUntil,
  getNextPaymentDate,
} from "../../date/paymentSchedule";
import { getCurrencyIconName } from "../../icons/currencyIcon";
import type { IconService } from "../../icons/IconService";
import type { CurrencyRegistry } from "../../money/CurrencyRegistry";
import { getCurrencyFallbackIconText } from "../../money/currencyDisplay";
import type { SubscriptionItem, SubscriptionViewItem } from "../../types";
import { getNextPaymentLayout } from "../subscriptionCardLayout";
import {
  createCurrencySelect,
  createCustomBillingPeriodDaysInput,
  createMoneyInput,
  createPeriodSelect,
  createToggleSwitch,
} from "./FormControls";

export function toggleSubscriptionEnabled(
  store: SubscriptionStore,
  id: string,
  enabled: boolean
): void {
  void store
    .setSubscriptionEnabled(id, enabled)
    .catch((e) => new Notice(e instanceof Error ? e.message : "Failed to save subscription status"));
}

export function setSubscriptionCardDeletionPending(
  card: HTMLElement,
  pending: boolean
): void {
  card.classList.toggle("is-deleting", pending);
  if (pending) card.setAttribute("aria-busy", "true");
  else card.removeAttribute("aria-busy");

  for (const control of Array.from(
    card.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(
      "button, input, select"
    )
  )) {
    control.disabled = pending;
  }
}

export function renderSubscriptionIcon(
  container: HTMLElement,
  item: SubscriptionItem,
  iconService: IconService,
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

export function watchNextPaymentCollision(
  card: HTMLElement,
  name: HTMLElement,
  actions: HTMLElement,
  nextPayment: HTMLElement
): () => void {
  const cardWindow = card.ownerDocument.defaultView;
  if (cardWindow === null) return () => undefined;

  let resizeObserver: ResizeObserver | null = null;
  let animationFrame: number | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (animationFrame !== null) {
      cardWindow.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  };
  const sync = () => {
    if (disposed || animationFrame !== null) return;
    animationFrame = cardWindow.requestAnimationFrame(() => {
      animationFrame = null;
      if (disposed || !card.isConnected) {
        dispose();
        return;
      }

      const cardRect = card.getBoundingClientRect();
      const nameRect = name.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const layout = getNextPaymentLayout({
        cardLeft: cardRect.left,
        cardTop: cardRect.top,
        nameRight: nameRect.right,
        actionsLeft: actionsRect.left,
        actionsTop: actionsRect.top,
        actionsBottom: actionsRect.bottom,
        countdownWidth: nextPayment.scrollWidth,
      });

      card.classList.toggle("is-next-payment-wrapped", layout.wrapped);
      if (layout.wrapped) {
        nextPayment.style.removeProperty("left");
        nextPayment.style.removeProperty("top");
        return;
      }

      nextPayment.style.left = `${layout.left}px`;
      nextPayment.style.top = `${layout.top}px`;
    });
  };

  resizeObserver = new cardWindow.ResizeObserver(sync);
  resizeObserver.observe(card);
  sync();
  return dispose;
}

export function renderSubscriptionCard(
  container: HTMLElement,
  item: SubscriptionViewItem,
  store: SubscriptionStore,
  registry: CurrencyRegistry,
  iconService: IconService,
  onEdit: () => void,
  onDelete: (card: HTMLElement) => void
): () => void {
  const card = container.createDiv({ cls: "subscription-calculator-card" });
  card.classList.toggle("is-disabled", item.effectiveStatus === "disabled");
  card.classList.toggle("is-disable-grace-period", item.inDisableGracePeriod);

  const top = card.createDiv({ cls: "subscription-calculator-card-top" });
  const title = top.createDiv({ cls: "subscription-calculator-card-title" });
  renderSubscriptionIcon(title, item, iconService, registry);
  const name = title.createSpan({
    cls: "subscription-calculator-card-name",
    text: item.name,
  });
  let nextPaymentLabel: HTMLElement | null = null;
  if (item.effectiveStatus === "enabled") {
    const today = todayLocalDate();
    const nextPayment = getNextPaymentDate(
      item.startDate,
      item.billingPeriod,
      today,
      item.customBillingPeriodDays
    );
    if (nextPayment) {
      nextPaymentLabel = card.createSpan({
        cls: "subscription-calculator-next-payment",
        text: formatPaymentCountdown(getDaysUntil(nextPayment, today)),
        attr: { title: `Next payment: ${nextPayment}` },
      });
    }
  }

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
  remove.addEventListener("click", () => onDelete(card));

  createToggleSwitch(
    actions,
    item.effectiveStatus === "enabled",
    (enabled) => toggleSubscriptionEnabled(store, item.id, enabled),
    `Enable or disable ${item.name}`
  );

  const disposeCollisionWatcher = nextPaymentLabel
    ? watchNextPaymentCollision(card, name, actions, nextPaymentLabel)
    : () => undefined;

  const controls = card.createDiv({ cls: "subscription-calculator-card-controls" });
  createMoneyInput(
    controls,
    item.price,
    registry,
    (priceText) => {
      void store
        .updateSubscription(item.id, { priceText, currencyCode: item.price.currencyCode })
        .catch((e) => new Notice(e instanceof Error ? e.message : "Failed to update price"));
    },
    `Price for ${item.name}`
  );
  createCurrencySelect(
    controls,
    registry,
    item.price.currencyCode,
    (currencyCode) => {
      const priceInput = controls.querySelector<HTMLInputElement>(
        ".subscription-calculator-money-input"
      );
      void store
        .updateSubscription(item.id, {
          priceText: priceInput?.value ?? "0",
          currencyCode,
        })
        .catch((e) => new Notice(e instanceof Error ? e.message : "Failed to update currency"));
    },
    `Currency for ${item.name}`
  );
  createPeriodSelect(
    controls,
    item.billingPeriod,
    (billingPeriod) => {
      void store
        .updateSubscription(item.id, { billingPeriod })
        .catch((e) => new Notice(e instanceof Error ? e.message : "Failed to update period"));
    },
    `Billing period for ${item.name}`
  );

  if (item.billingPeriod === "custom") {
    createCustomBillingPeriodDaysInput(
      controls,
      item.customBillingPeriodDays ?? DEFAULT_CUSTOM_BILLING_PERIOD_DAYS,
      (customBillingPeriodDays) => {
        void store
          .updateSubscription(item.id, {
            customBillingPeriodDays,
          })
          .catch((e) => new Notice(e instanceof Error ? e.message : "Failed to update custom period"));
      },
      `Custom billing period days for ${item.name}`
    );
  }

  if (item.effectiveStatus === "disabled") {
    card.createDiv({
      cls: "subscription-calculator-disabled-note",
      text: item.disabledOn
        ? `disabled on ${item.disabledOn}`
        : "disabled",
    });
  }

  return disposeCollisionWatcher;
}
