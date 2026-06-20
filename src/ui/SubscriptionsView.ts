import { ItemView, Menu, Notice, setIcon, WorkspaceLeaf } from "obsidian";
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
import {
  sortSubscriptions,
  type SubscriptionSortDirection,
  type SubscriptionSortMode,
} from "./subscriptionSort";

export class SubscriptionsView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private sortMode: SubscriptionSortMode = "alphabetical";
  private sortDirection: SubscriptionSortDirection = "ascending";

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

    const sortButton = toolbar.createEl("button", {
      cls: [
        "subscription-calculator-secondary-button",
        "subscription-calculator-sort-button",
      ],
      attr: { "aria-label": "Sort subscription cards" },
    });
    sortButton.createSpan({ text: this.getSortLabel(this.sortMode) });
    const sortButtonIcon = sortButton.createSpan({
      cls: "subscription-calculator-sort-icon",
    });
    setIcon(sortButtonIcon, this.getSortDirectionIcon());
    sortButton.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((item) => {
        item
          .setTitle(this.getSortMenuTitle("alphabetical", "Alphabetical"))
          .onClick(() => this.selectSortMode("alphabetical"));
      });
      menu.addItem((item) => {
        item
          .setTitle(
            this.getSortMenuTitle("status", "Enabled / disabled")
          )
          .onClick(() => this.selectSortMode("status"));
      });
      menu.showAtMouseEvent(event);
    });

    const cards = container.createDiv({ cls: "subscription-calculator-cards" });
    for (const item of sortSubscriptions(
      this.store.getVisibleSubscriptions(),
      this.sortMode,
      this.sortDirection
    )) {
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

  private selectSortMode(mode: SubscriptionSortMode): void {
    if (this.sortMode === mode) {
      this.sortDirection =
        this.sortDirection === "ascending" ? "descending" : "ascending";
    } else {
      this.sortMode = mode;
      this.sortDirection = "ascending";
    }
    this.render();
  }

  private getSortDirectionIcon(): "arrow-up" | "arrow-down" {
    return this.sortDirection === "ascending" ? "arrow-up" : "arrow-down";
  }

  private getSortLabel(mode: SubscriptionSortMode): string {
    return mode === "alphabetical" ? "Alphabetical" : "Enabled / disabled";
  }

  private getSortMenuTitle(
    mode: SubscriptionSortMode,
    label: string
  ): string | DocumentFragment {
    if (this.sortMode !== mode) return label;

    const fragment = activeDocument.createDocumentFragment();
    const content = activeDocument.createElement("span");
    content.classList.add("subscription-calculator-sort-menu-title");
    content.append(label);
    const icon = activeDocument.createElement("span");
    icon.classList.add("subscription-calculator-sort-icon");
    setIcon(icon, this.getSortDirectionIcon());
    content.append(icon);
    fragment.append(content);
    return fragment;
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
