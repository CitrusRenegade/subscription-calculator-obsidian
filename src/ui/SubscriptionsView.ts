import { ItemView, Menu, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_SUBSCRIPTIONS } from "../constants";
import type { SubscriptionStore } from "../data/SubscriptionStore";
import { todayLocalDate } from "../date/dateOnly";
import type { IconService } from "../icons/IconService";
import type { CurrencyRegistry } from "../money/CurrencyRegistry";
import type {
  PluginSettings,
  SubscriptionSortDirection,
  SubscriptionSortMode,
  SubscriptionViewItem,
} from "../types";
import { AddSubscriptionModal } from "./AddSubscriptionModal";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { EditSubscriptionModal } from "./EditSubscriptionModal";
import { renderAddSubscriptionCard } from "./components/AddSubscriptionCard";
import { renderSubscriptionCard } from "./components/SubscriptionCard";
import { renderSubscriptionSummaryTable } from "./components/SubscriptionSummaryTable";
import { renderFloatingSummary, renderSummaryHeader } from "./components/SummaryHeader";
import { sortSubscriptions } from "./subscriptionSort";

export class SubscriptionsView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private summaryObserver: IntersectionObserver | null = null;
  private floatingSummaryEl: HTMLElement | null = null;
  private sortMode: SubscriptionSortMode;
  private sortDirection: SubscriptionSortDirection;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly store: SubscriptionStore,
    private readonly registry: CurrencyRegistry,
    private readonly iconService: IconService,
    private readonly getSettings: () => PluginSettings
  ) {
    super(leaf);
    const settings = this.getSettings();
    this.sortMode = settings.sortMode;
    this.sortDirection = settings.sortDirection;
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
    this.cleanupSummaryOverlay();
    this.containerEl.removeClass("subscription-calculator-view-container");
  }

  render(): void {
    this.cleanupSummaryOverlay();
    const container = this.contentEl;
    container.empty();
    container.addClass("subscription-calculator-view");
    this.containerEl.addClass("subscription-calculator-view-container");

    const totals = this.store.getTotalsByCurrency();
    const summary = renderSummaryHeader(container, totals, this.registry);

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
      menu.addItem((item) => {
        item
          .setTitle(this.getSortMenuTitle("next-payment", "Next payment"))
          .onClick(() => this.selectSortMode("next-payment"));
      });
      menu.showAtMouseEvent(event);
    });

    const cards = container.createDiv({ cls: "subscription-calculator-cards" });
    for (const item of sortSubscriptions(
      this.store.getVisibleSubscriptions(),
      this.sortMode,
      this.sortDirection,
      todayLocalDate()
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

    this.floatingSummaryEl = renderFloatingSummary(this.containerEl, totals, this.registry);
    const viewWindow = container.ownerDocument.defaultView;
    if (viewWindow === null) return;

    this.summaryObserver = new viewWindow.IntersectionObserver(
      ([entry]) => {
        const rootTop = entry.rootBounds?.top;
        const summaryIsAboveView = rootTop !== undefined && entry.boundingClientRect.bottom <= rootTop;
        this.floatingSummaryEl?.classList.toggle("is-visible", summaryIsAboveView);
      },
      { root: container, threshold: 0 }
    );
    this.summaryObserver.observe(summary);
  }

  private cleanupSummaryOverlay(): void {
    this.summaryObserver?.disconnect();
    this.summaryObserver = null;
    this.floatingSummaryEl?.remove();
    this.floatingSummaryEl = null;
  }

  private selectSortMode(mode: SubscriptionSortMode): void {
    if (this.sortMode === mode) {
      this.sortDirection =
        this.sortDirection === "ascending" ? "descending" : "ascending";
    } else {
      this.sortMode = mode;
      this.sortDirection = "ascending";
    }
    const settings = this.getSettings();
    settings.sortMode = this.sortMode;
    settings.sortDirection = this.sortDirection;
    void this.store
      .saveSettings()
      .catch(() => new Notice("Failed to save sorting preference"));
  }

  private getSortDirectionIcon(): "arrow-up" | "arrow-down" {
    return this.sortDirection === "ascending" ? "arrow-up" : "arrow-down";
  }

  private getSortLabel(mode: SubscriptionSortMode): string {
    if (mode === "alphabetical") return "Alphabetical";
    if (mode === "status") return "Enabled / disabled";
    return "Next payment";
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
