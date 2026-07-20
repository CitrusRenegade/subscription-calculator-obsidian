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
import {
  getFloatingSummaryPresentation,
  getFloatingSummaryPosition,
  getBottomSheetStatusBarInset,
  getStaticSummaryPlacement,
  shouldShowFloatingSummary,
  type FloatingSummaryPosition,
} from "./floatingSummary";
import { getSortStateFromSettings, sortSubscriptions } from "./subscriptionSort";

export class SubscriptionsView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private summaryResizeObserver: ResizeObserver | null = null;
  private summaryScrollContainer: HTMLElement | null = null;
  private summaryAnimationFrame: number | null = null;
  private summaryWindow: Window | null = null;
  private summaryOverlayHostEl: HTMLElement | null = null;
  private floatingSummaryEl: HTMLElement | null = null;
  private staticSummarySentinelEl: HTMLElement | null = null;
  private viewBodyEl: HTMLElement | null = null;
  private floatingSummaryPosition: FloatingSummaryPosition = "top";
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
    const sortState = getSortStateFromSettings(this.getSettings());
    this.sortMode = sortState.sortMode;
    this.sortDirection = sortState.sortDirection;
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
    this.unsubscribe = this.store.subscribe(() => {
      this.syncSortStateFromSettings();
      this.render();
    });
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.cleanupSummaryOverlay();
    this.contentEl.removeClass("subscription-calculator-view");
    this.contentEl.style.removeProperty("--subscription-calculator-overlay-height");
    this.contentEl.style.removeProperty("--subscription-calculator-sheet-height");
  }

  render(): void {
    this.disconnectSummaryObservers();
    const container = this.contentEl;
    const settings = this.getSettings();
    const displayPrecision = settings.moneyDisplayPrecision;
    const totals = this.store.getTotalsByCurrency();
    const floatingSummaryPosition = getFloatingSummaryPosition(
      settings.floatingYearlyTotal
    );
    this.floatingSummaryPosition = floatingSummaryPosition;
    const { body, floatingSummary } = this.ensureViewShell(
      totals,
      displayPrecision,
      floatingSummaryPosition
    );
    const previousScrollTop = container.scrollTop;
    body.empty();
    updateFloatingSummary(
      floatingSummary,
      totals,
      this.registry,
      displayPrecision
    );
    const staticSummaryPlacement = getStaticSummaryPlacement(
      floatingSummaryPosition
    );
    const topSummary =
      staticSummaryPlacement === "before-content"
        ? renderSummaryHeader(body, totals, this.registry, displayPrecision)
        : null;
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
    const summary =
      topSummary ??
      renderSummaryHeader(body, totals, this.registry, displayPrecision);

    container.scrollTop = previousScrollTop;
    const viewWindow = container.ownerDocument.defaultView;
    if (viewWindow === null) {
      this.setFloatingSummaryVisible(floatingSummaryPosition, false);
      return;
    }
    const summarySentinel = summary.querySelector<HTMLElement>(
      ".subscription-calculator-summary-values"
    );
    if (summarySentinel === null) {
      this.setFloatingSummaryVisible(floatingSummaryPosition, false);
      return;
    }
    this.staticSummarySentinelEl = summarySentinel;
    const summaryResizeObserver = new viewWindow.ResizeObserver(() => {
      if (this.summaryResizeObserver !== summaryResizeObserver) return;
      this.scheduleFloatingSummaryUpdate();
    });
    this.summaryResizeObserver = summaryResizeObserver;
    this.summaryWindow = viewWindow;
    this.summaryScrollContainer = container;
    container.addEventListener("scroll", this.scheduleFloatingSummaryUpdate);
    summaryResizeObserver.observe(container);
    summaryResizeObserver.observe(floatingSummary);
    summaryResizeObserver.observe(summarySentinel);
    if (floatingSummaryPosition === "bottom") {
      const statusBar = container.ownerDocument.querySelector<HTMLElement>(".status-bar");
      if (statusBar !== null) summaryResizeObserver.observe(statusBar);
    }
    this.scheduleFloatingSummaryUpdate();
  }

  private cleanupSummaryOverlay(): void {
    this.disconnectSummaryObservers();
    this.floatingSummaryEl?.style.removeProperty(
      "--subscription-calculator-status-bar-inset"
    );
    this.summaryOverlayHostEl?.remove();
    this.summaryOverlayHostEl = null;
    this.viewBodyEl = null;
    this.floatingSummaryEl = null;
    this.staticSummarySentinelEl = null;
    this.contentEl.style.removeProperty("--subscription-calculator-sheet-height");
    this.contentEl.style.removeProperty("--subscription-calculator-overlay-height");
  }

  private disconnectSummaryObservers(): void {
    if (this.summaryAnimationFrame !== null && this.summaryWindow !== null) {
      this.summaryWindow.cancelAnimationFrame(this.summaryAnimationFrame);
    }
    this.summaryAnimationFrame = null;
    this.summaryWindow = null;
    this.summaryScrollContainer?.removeEventListener(
      "scroll",
      this.scheduleFloatingSummaryUpdate
    );
    this.summaryScrollContainer = null;
    this.summaryResizeObserver?.disconnect();
    this.summaryResizeObserver = null;
  }

  private ensureViewShell(
    totals: ReturnType<SubscriptionStore["getTotalsByCurrency"]>,
    displayPrecision: PluginSettings["moneyDisplayPrecision"],
    position: FloatingSummaryPosition
  ): { body: HTMLElement; floatingSummary: HTMLElement } {
    const container = this.contentEl;
    const overlayHost = this.summaryOverlayHostEl;
    const floatingSummary = this.floatingSummaryEl;
    const body = this.viewBodyEl;
    const overlayIsCurrent =
      overlayHost?.parentElement === container &&
      floatingSummary?.parentElement === overlayHost &&
      overlayHost.classList.contains(`is-${position}`);
    const shellIsCurrent = overlayIsCurrent && body?.parentElement === container;
    if (shellIsCurrent && body !== null && floatingSummary !== null) {
      return { body, floatingSummary };
    }

    container.empty();
    container.addClass("subscription-calculator-view");
    const nextOverlayHost = container.createDiv({
      cls: ["subscription-calculator-summary-overlay", `is-${position}`],
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

  private setFloatingSummaryVisible(
    position: FloatingSummaryPosition,
    visible: boolean
  ): void {
    const presentation = getFloatingSummaryPresentation(
      position,
      visible,
      this.floatingSummaryEl?.offsetHeight ?? 0
    );
    this.floatingSummaryEl?.classList.toggle("is-visible", presentation.visible);
    this.contentEl.style.setProperty(
      "--subscription-calculator-overlay-height",
      `${presentation.overlayHeight}px`
    );
    this.contentEl.style.setProperty(
      "--subscription-calculator-sheet-height",
      `${presentation.sheetHeight}px`
    );
  }

  private readonly scheduleFloatingSummaryUpdate = (): void => {
    if (this.summaryAnimationFrame !== null || this.summaryWindow === null) return;
    this.summaryAnimationFrame = this.summaryWindow.requestAnimationFrame(() => {
      this.summaryAnimationFrame = null;
      this.updateFloatingSummaryLayout();
    });
  };

  /** OBS-36.FLOATING_SUMMARY.1-5, OBS-36.LIFECYCLE.1 */
  private updateFloatingSummaryLayout(): void {
    const floatingSummary = this.floatingSummaryEl;
    const summarySentinel = this.staticSummarySentinelEl;
    if (floatingSummary === null || summarySentinel === null) return;

    const viewBounds = this.contentEl.getBoundingClientRect();
    if (this.floatingSummaryPosition === "bottom") {
      const sheetHeight = floatingSummary.offsetHeight;
      const statusBar = this.contentEl.ownerDocument.querySelector<HTMLElement>(
        ".status-bar"
      );
      const statusBarInset = getBottomSheetStatusBarInset({
        sheet: {
          left: viewBounds.left,
          right: viewBounds.right,
          top: viewBounds.bottom - sheetHeight,
          bottom: viewBounds.bottom,
        },
        statusBar: statusBar?.getBoundingClientRect() ?? null,
      });
      floatingSummary.style.setProperty(
        "--subscription-calculator-status-bar-inset",
        `${statusBarInset}px`
      );
    } else {
      floatingSummary.style.removeProperty(
        "--subscription-calculator-status-bar-inset"
      );
    }

    const sentinelBounds = summarySentinel.getBoundingClientRect();
    this.setFloatingSummaryVisible(
      this.floatingSummaryPosition,
      shouldShowFloatingSummary({
        position: this.floatingSummaryPosition,
        viewTop: viewBounds.top,
        viewBottom: viewBounds.bottom,
        sentinelTop: sentinelBounds.top,
        sentinelBottom: sentinelBounds.bottom,
        sentinelHeight: sentinelBounds.height,
      })
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

  private syncSortStateFromSettings(): void {
    const sortState = getSortStateFromSettings(this.getSettings());
    this.sortMode = sortState.sortMode;
    this.sortDirection = sortState.sortDirection;
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

    const fragment = createFragment();
    const content = fragment.createSpan();
    content.classList.add("subscription-calculator-sort-menu-title");
    content.append(label);
    const icon = content.createSpan();
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
