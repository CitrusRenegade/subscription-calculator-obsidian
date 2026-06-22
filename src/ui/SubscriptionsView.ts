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
import {
  renderFloatingSummary,
  renderSummaryHeader,
  updateFloatingSummary,
} from "./components/SummaryHeader";
import { shouldShowFloatingSummary } from "./floatingSummary";
import { sortSubscriptions } from "./subscriptionSort";

export class SubscriptionsView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private summaryObserver: IntersectionObserver | null = null;
  private summaryResizeObserver: ResizeObserver | null = null;
  private summaryOverlayHostEl: HTMLElement | null = null;
  private floatingSummaryEl: HTMLElement | null = null;
  private viewBodyEl: HTMLElement | null = null;
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
    this.contentEl.removeClass("subscription-calculator-view");
    this.contentEl.style.removeProperty("--subscription-calculator-overlay-height");
  }

  render(): void {
    this.disconnectSummaryObservers();
    const container = this.contentEl;
    const settings = this.getSettings();
    const displayPrecision = settings.moneyDisplayPrecision;
    const totals = this.store.getTotalsByCurrency();
    const { body, floatingSummary } = this.ensureViewShell(totals, displayPrecision);
    const previousScrollTop = container.scrollTop;
    body.empty();
    updateFloatingSummary(
      floatingSummary,
      totals,
      this.registry,
      displayPrecision
    );
    const summary = renderSummaryHeader(
      body,
      totals,
      this.registry,
      displayPrecision
    );

    const toolbar = body.createDiv({ cls: "subscription-calculator-toolbar" });
    const showDisabledButton = toolbar.createEl("button", {
      cls: "subscription-calculator-secondary-button",
      text: settings.showDisabled ? "Hide disabled" : "Show disabled",
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

    const cards = body.createDiv({ cls: "subscription-calculator-cards" });
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
      body,
      this.store.getEnabledSubscriptions(),
      this.registry,
      this.iconService,
      displayPrecision
    );

    container.scrollTop = previousScrollTop;
    const viewWindow = container.ownerDocument.defaultView;
    if (viewWindow === null) {
      this.setFloatingSummaryVisible(false);
      return;
    }
    const summaryValues = summary.querySelector<HTMLElement>(
      ".subscription-calculator-summary-values"
    );
    if (summaryValues === null) {
      this.setFloatingSummaryVisible(false);
      return;
    }

    const rootBounds = container.getBoundingClientRect();
    const summaryBounds = summaryValues.getBoundingClientRect();
    this.setFloatingSummaryVisible(
      shouldShowFloatingSummary({
        rootTop: rootBounds.top,
        rootHeight: rootBounds.height,
        summaryBottom: summaryBounds.bottom,
        summaryHeight: summaryBounds.height,
      })
    );

    const summaryObserver = new viewWindow.IntersectionObserver(
      ([entry]) => {
        if (this.summaryObserver !== summaryObserver || entry === undefined) return;
        this.setFloatingSummaryVisible(
          shouldShowFloatingSummary({
            rootTop: entry.rootBounds?.top,
            rootHeight: entry.rootBounds?.height ?? 0,
            summaryBottom: entry.boundingClientRect.bottom,
            summaryHeight: entry.boundingClientRect.height,
          })
        );
      },
      { root: container, threshold: 0 }
    );
    this.summaryObserver = summaryObserver;
    summaryObserver.observe(summaryValues);

    const summaryResizeObserver = new viewWindow.ResizeObserver(() => {
      if (this.summaryResizeObserver !== summaryResizeObserver) return;
      this.updateFloatingSummaryOffset();
    });
    this.summaryResizeObserver = summaryResizeObserver;
    summaryResizeObserver.observe(floatingSummary);
  }

  private cleanupSummaryOverlay(): void {
    this.disconnectSummaryObservers();
    this.summaryOverlayHostEl?.remove();
    this.summaryOverlayHostEl = null;
    this.viewBodyEl = null;
    this.floatingSummaryEl = null;
  }

  private disconnectSummaryObservers(): void {
    this.summaryObserver?.disconnect();
    this.summaryObserver = null;
    this.summaryResizeObserver?.disconnect();
    this.summaryResizeObserver = null;
  }

  private ensureViewShell(
    totals: ReturnType<SubscriptionStore["getTotalsByCurrency"]>,
    displayPrecision: PluginSettings["moneyDisplayPrecision"]
  ): { body: HTMLElement; floatingSummary: HTMLElement } {
    const container = this.contentEl;
    const overlayHost = this.summaryOverlayHostEl;
    const floatingSummary = this.floatingSummaryEl;
    const body = this.viewBodyEl;
    const shellIsCurrent =
      overlayHost?.parentElement === container &&
      floatingSummary?.parentElement === overlayHost &&
      body?.parentElement === container;
    if (shellIsCurrent && floatingSummary !== null && body !== null) {
      return { body, floatingSummary };
    }

    container.empty();
    container.addClass("subscription-calculator-view");
    const nextOverlayHost = container.createDiv({
      cls: "subscription-calculator-summary-overlay",
    });
    const nextFloatingSummary = renderFloatingSummary(
      nextOverlayHost,
      totals,
      this.registry,
      displayPrecision
    );
    const nextBody = container.createDiv({ cls: "subscription-calculator-view-body" });
    this.summaryOverlayHostEl = nextOverlayHost;
    this.floatingSummaryEl = nextFloatingSummary;
    this.viewBodyEl = nextBody;
    return { body: nextBody, floatingSummary: nextFloatingSummary };
  }

  private setFloatingSummaryVisible(visible: boolean): void {
    this.floatingSummaryEl?.classList.toggle("is-visible", visible);
    this.updateFloatingSummaryOffset();
  }

  private updateFloatingSummaryOffset(): void {
    const floatingSummary = this.floatingSummaryEl;
    const height =
      floatingSummary?.classList.contains("is-visible") === true
        ? floatingSummary.getBoundingClientRect().height
        : 0;
    this.contentEl.style.setProperty(
      "--subscription-calculator-overlay-height",
      `${height}px`
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
