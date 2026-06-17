import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_SUBSCRIPTIONS } from "./constants";
import { SubscriptionStore } from "./data/SubscriptionStore";
import { migratePluginData } from "./data/migrations";
import { IconService } from "./icons/IconService";
import { BuiltinCurrencyRegistry } from "./money/CurrencyRegistry";
import { SubscriptionSettingTab } from "./settings/SubscriptionSettingTab";
import type { PluginData } from "./types";
import { AddSubscriptionModal } from "./ui/AddSubscriptionModal";
import { SubscriptionsView } from "./ui/SubscriptionsView";

export default class SubscriptionCalculatorPlugin extends Plugin {
  data!: PluginData;
  currencyRegistry!: BuiltinCurrencyRegistry;
  iconService!: IconService;
  store!: SubscriptionStore;

  async onload(): Promise<void> {
    this.data = migratePluginData(await this.loadData());
    this.currencyRegistry = new BuiltinCurrencyRegistry(
      this.data.settings.defaultCurrency
    );
    this.iconService = new IconService(
      this.data,
      () => this.data.settings.faviconProvider
    );
    this.store = new SubscriptionStore(
      this.data,
      this.currencyRegistry,
      this.iconService,
      () => this.savePluginData()
    );

    this.registerView(
      VIEW_TYPE_SUBSCRIPTIONS,
      (leaf) =>
        new SubscriptionsView(
          leaf,
          this.store,
          this.currencyRegistry,
          this.iconService,
          () => this.data.settings
        )
    );

    this.addSettingTab(new SubscriptionSettingTab(this.app, this));

    this.addRibbonIcon("receipt-text", "Open subscriptions", () => {
      void this.openSubscriptions();
    });

    this.addCommand({
      id: "open-subscriptions",
      name: "Open subscriptions",
      callback: () => {
        void this.openSubscriptions();
      },
    });

    this.addCommand({
      id: "add-subscription",
      name: "Add subscription",
      callback: () => {
        void this.openAddSubscriptionModal();
      },
    });

    this.registerDomEvent(window, "beforeunload", () => {
      void this.store
        .flushDisableGracePeriods()
        .catch((e) => console.error("Failed to save delayed subscription changes:", e));
    });

    this.register(() => this.store.dispose());
  }

  onunload(): void {
    void this.store
      .flushDisableGracePeriods()
      .catch((e) => console.error("Failed to save delayed subscription changes:", e));
  }

  async savePluginData(): Promise<void> {
    await this.saveData(this.data);
  }

  async openAddSubscriptionModal(): Promise<void> {
    await this.openSubscriptions();
    new AddSubscriptionModal(
      this.app,
      this.store,
      this.currencyRegistry,
      this.data.settings.defaultCurrency
    ).open();
  }

  async openSubscriptions(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SUBSCRIPTIONS)[0];
    if (existingLeaf) {
      this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
      return;
    }

    const leaf = this.getTargetLeaf();
    if (!leaf) {
      new Notice("Unable to open subscriptions view");
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_SUBSCRIPTIONS, active: true });
    if (this.data.settings.openMode === "right-sidebar") {
      this.app.workspace.rightSplit.expand();
    }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  private getTargetLeaf(): WorkspaceLeaf | null {
    if (this.data.settings.openMode === "right-sidebar") {
      return this.app.workspace.getRightLeaf(false);
    }
    return this.app.workspace.getLeaf(true);
  }
}
