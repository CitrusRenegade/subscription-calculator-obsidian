import { App, Notice, PluginSettingTab, Setting, type ButtonComponent } from "obsidian";
import type SubscriptionCalculatorPlugin from "../main";
import type { FaviconProvider, OpenMode } from "../types";

export class SubscriptionSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SubscriptionCalculatorPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    let refreshAllButton: ButtonComponent | null = null;

    new Setting(containerEl)
      .setName("Open subscriptions in")
      .setDesc("The same view is used in both placements.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("right-sidebar", "Right sidebar")
          .addOption("main-tab", "Main tab")
          .setValue(this.plugin.data.settings.openMode)
          .onChange(async (value) => {
            this.plugin.data.settings.openMode = value as OpenMode;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl).setName("Default currency").addDropdown((dropdown) => {
      for (const currency of this.plugin.currencyRegistry.list()) {
        dropdown.addOption(currency.code, `${currency.code} ${currency.symbol}`);
      }
      dropdown.setValue(this.plugin.data.settings.defaultCurrency);
      dropdown.onChange(async (value) => {
        this.plugin.data.settings.defaultCurrency = value;
        await this.plugin.savePluginData();
      });
    });

    new Setting(containerEl)
      .setName("Favicon provider")
      .setDesc("Auto icons are cached in plugin data and are not fetched during normal render.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("google-s2", "Google S2")
          .addOption("none", "Disabled")
          .setValue(this.plugin.data.settings.faviconProvider)
          .onChange(async (value) => {
            this.plugin.data.settings.faviconProvider = value as FaviconProvider;
            await this.plugin.savePluginData();
            refreshAllButton?.setDisabled(value === "none");
          })
      );

    new Setting(containerEl)
      .setName("Refresh all icons")
      .setDesc("Refetches and caches icons for subscriptions using auto favicon and a service URL.")
      .addButton((button) => {
        refreshAllButton = button;
        button
          .setButtonText("Refresh all")
          .setDisabled(this.plugin.data.settings.faviconProvider === "none")
          .onClick(async () => {
            button.setDisabled(true).setButtonText("Refreshing…");
            try {
              const result = await this.plugin.store.refreshAllIcons();
              new Notice(
                `Icons: ${result.refreshed} refreshed, ${result.failed} failed, ${result.skipped} skipped`
              );
            } catch (e) {
              console.error("Failed to refresh all subscription icons:", e);
              new Notice("Failed to refresh all icons");
            } finally {
              button
                .setButtonText("Refresh all")
                .setDisabled(this.plugin.data.settings.faviconProvider === "none");
            }
          });
      });

    new Setting(containerEl)
      .setName("Confirm before delete")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.settings.confirmBeforeDelete)
          .onChange(async (value) => {
            this.plugin.data.settings.confirmBeforeDelete = value;
            await this.plugin.savePluginData();
          })
      );
  }
}
