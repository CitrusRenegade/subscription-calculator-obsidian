import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_SUBSCRIPTIONS } from "../constants";
import type { SubscriptionStore } from "../data/SubscriptionStore";
import type { IconService } from "../icons/IconService";
import type { CurrencyRegistry } from "../money/CurrencyRegistry";
import type { PluginSettings, SubscriptionViewItem } from "../types";
import { AddSubscriptionModal } from "./AddSubscriptionModal";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { EditSubscriptionModal } from "./EditSubscriptionModal";
import { renderAddSubscriptionCard } from "./components/AddSubscriptionCard";
import { renderSubscriptionCard } from "./components/SubscriptionCard";
import { renderSubscriptionSummaryTable } from "./components/SubscriptionSummaryTable";
import { renderSummaryHeader } from "./components/SummaryHeader";

export class SubscriptionsView extends ItemView {
  private unsubscribe: (() => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly store: SubscriptionStore,
    private readonly registry: CurrencyRegistry,
    private readonly iconService: IconService,
    private readonly getSettings: () => PluginSettings
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_SUBSCRIPTIONS;
  }

  getDisplayText(): string {
    return "Subscriptions";
  }

  getIcon(): string {
    return "receipt-text";
  }

  async onOpen(): Promise<void> {
    this.unsubscribe = this.store.subscribe(() => this.render());
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("subscription-calculator-view");

    renderSummaryHeader(container, this.store.getTotalsByCurrency(), this.registry);

    const toolbar = container.createDiv({ cls: "subscription-calculator-toolbar" });
    const showDisabledButton = toolbar.createEl("button", {
      cls: "subscription-calculator-secondary-button",
      text: this.getSettings().showDisabled ? "Hide disabled" : "Show disabled",
    });
    showDisabledButton.addEventListener("click", () => {
      const settings = this.getSettings();
      settings.showDisabled = !settings.showDisabled;
      void this.store.saveSettings();
    });

    const cards = container.createDiv({ cls: "subscription-calculator-cards" });
    for (const item of this.store.getVisibleSubscriptions()) {
      renderSubscriptionCard(
        cards,
        item,
        this.store,
        this.registry,
        this.iconService,
        () => this.openEditModal(item),
        () => this.confirmDelete(item)
      );
    }

    renderAddSubscriptionCard(cards, () =>
      new AddSubscriptionModal(
        this.app,
        this.store,
        this.registry,
        this.getSettings().defaultCurrency
      ).open()
    );

    renderSubscriptionSummaryTable(
      container,
      this.store.getEnabledSubscriptions(),
      this.registry,
      this.iconService
    );
  }

  private openEditModal(item: SubscriptionViewItem): void {
    new EditSubscriptionModal(this.app, this.store, this.registry, item).open();
  }

  private confirmDelete(item: SubscriptionViewItem): void {
    const remove = () => {
      void this.store
        .deleteSubscription(item.id)
        .catch(() => new Notice("Failed to delete subscription"));
    };

    if (this.getSettings().confirmBeforeDelete) {
      new ConfirmDeleteModal(this.app, item.name, remove).open();
    } else {
      remove();
    }
  }
}
