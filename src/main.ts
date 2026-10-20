import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_SUBSCRIPTIONS } from "./constants";
import { SubscriptionStore } from "./data/SubscriptionStore";
import type { BackupImportReport } from "./data/backup";
import { exportBackup, registerSubscriptionCli } from "./cli/subscriptions";
import { migratePluginData } from "./data/migrations";
import { IconService } from "./icons/IconService";
import { DataBackedCurrencyRegistry } from "./money/CurrencyRegistry";
import { SubscriptionSettingTab } from "./settings/SubscriptionSettingTab";
import type { PluginData } from "./types";
import { AddSubscriptionModal } from "./ui/AddSubscriptionModal";
import { SubscriptionsView } from "./ui/SubscriptionsView";
import { openModalInDocument } from "./ui/components/openModalInDocument";

export default class SubscriptionCalculatorPlugin extends Plugin {
  data!: PluginData;
  currencyRegistry!: DataBackedCurrencyRegistry;
  iconService!: IconService;
  store!: SubscriptionStore;

  async onload(): Promise<void> {
    this.data = migratePluginData(await this.loadData());
    this.currencyRegistry = new DataBackedCurrencyRegistry(
      () => this.data.settings.defaultCurrency,
      () => this.data.customCurrencies
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
    try {
      await this.store.cleanupUnusedArchivedCustomCurrencies();
    } catch (error) {
      console.error("Failed to clean up saved subscription data:", error);
      new Notice("Saved-data cleanup failed");
    }

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
    registerSubscriptionCli(this, this.store, this.currencyRegistry);

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

  exportBackupJson(): Promise<string> {
    return exportBackup(this.store);
  }

  async restoreBackupJson(
    text: string,
    confirmRestore: (report: BackupImportReport) => boolean
  ): Promise<BackupImportReport | null> {
    return this.store.restoreBackupJson(text, confirmRestore);
  }

  async openAddSubscriptionModal(): Promise<void> {
    const leaf = await this.openSubscriptions();
    if (!leaf) return;
    openModalInDocument(() => new AddSubscriptionModal(
      this.app,
      this.store,
      this.currencyRegistry,
      this.data.settings.defaultCurrency,
      { iconService: this.iconService, getProvider: () => this.data.settings.faviconProvider }
    ), leaf.view.containerEl.ownerDocument, "subscription-add");
  }

  async openSubscriptions(): Promise<WorkspaceLeaf | null> {
    const existingLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SUBSCRIPTIONS)[0];
    if (existingLeaf) {
      this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
      return existingLeaf;
    }

    const leaf = this.getTargetLeaf();
    if (!leaf) {
      new Notice("Unable to open subscriptions view");
      return null;
    }
    await leaf.setViewState({ type: VIEW_TYPE_SUBSCRIPTIONS, active: true });
    if (this.data.settings.openMode === "right-sidebar") {
      this.app.workspace.rightSplit.expand();
    }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    return leaf;
  }

  private getTargetLeaf(): WorkspaceLeaf | null {
    if (this.data.settings.openMode === "right-sidebar") {
      return this.app.workspace.getRightLeaf(false);
    }
    return this.app.workspace.getLeaf(true);
  }
}
