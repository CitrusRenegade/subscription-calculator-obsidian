import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  type ButtonComponent,
  type SettingDefinitionItem,
} from "obsidian";
import type SubscriptionCalculatorPlugin from "../main";
import { CustomCurrencyModal, getCurrencyPreviewAmount } from "./CustomCurrencyModal";
import { openModalInDocument } from "../ui/components/openModalInDocument";
import {
  getCurrencyAmountMarker,
  getCurrencySelectLabel,
} from "../money/currencyDisplay";
import type { CurrencyMeta, FaviconProvider, OpenMode, PluginSettings } from "../types";

function createDetachedFileInput(containerEl: HTMLElement): HTMLInputElement {
  const input = containerEl.createEl("input");
  input.remove();
  return input;
}

function backupFilename(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `subscription-calculator-backup-${timestamp}.json`;
}

function downloadJson(document: Document, filename: string, contents: string): void {
  const view = document.defaultView;
  if (!view) throw new Error("Unable to download backup from this window.");

  const blob = new view.Blob([contents], { type: "application/json" });
  const url = view.URL.createObjectURL(blob);
  const link = document.body.createEl("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  link.click();
  link.remove();
  view.setTimeout(() => view.URL.revokeObjectURL(url), 0);
}

export class SubscriptionSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SubscriptionCalculatorPlugin) {
    super(app, plugin);
  }

  getControlValue(key: string): unknown {
    if (key === "moneyDisplayPrecision") {
      return this.plugin.data.settings.moneyDisplayPrecision === 1;
    }

    return this.plugin.data.settings[key as keyof PluginSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    try {
      await this.plugin.store.updateSettings((settings) => {
        switch (key) {
          case "openMode":
            settings.openMode = value as OpenMode;
            return;
          case "defaultCurrency":
            settings.defaultCurrency = value as string;
            return;
          case "moneyDisplayPrecision":
            settings.moneyDisplayPrecision = value === true ? 1 : 0;
            return;
          case "floatingYearlyTotal":
            settings.floatingYearlyTotal = value === true;
            return;
          case "faviconProvider":
            settings.faviconProvider = value as FaviconProvider;
            return;
          case "confirmBeforeDelete":
            settings.confirmBeforeDelete = value === true;
            return;
          default:
            throw new Error(`Unknown settings control: ${key}`);
        }
      });
      this.update();
    } catch (error) {
      console.error("Failed to save setting:", error);
      new Notice("Failed to save setting");
      this.update();
    }
  }

  getSettingDefinitions(): SettingDefinitionItem<keyof PluginSettings>[] {
    const currencyOptions = this.plugin.currencyRegistry
      .listSelectable()
      .reduce<Record<string, string>>((options, currency) => {
        options[currency.code] = getCurrencySelectLabel(currency);
        return options;
      }, {});

    return [
      {
        name: "Open subscriptions in",
        desc: "The same view is used in both placements.",
        control: {
          type: "dropdown",
          key: "openMode",
          options: {
            "right-sidebar": "Right sidebar",
            "main-tab": "Main tab",
          },
        },
      },
      {
        name: "Default currency",
        control: {
          type: "dropdown",
          key: "defaultCurrency",
          options: currencyOptions,
        },
      },
      {
        name: "More precise totals",
        desc: "Show totals to one decimal place instead of rounding to whole numbers (disabled by default).",
        control: {
          type: "toggle",
          key: "moneyDisplayPrecision",
        },
      },
      {
        name: "Total position",
        desc: "Off: top (default). On: bottom.",
        control: {
          type: "toggle",
          key: "floatingYearlyTotal",
        },
      },
      {
        name: "Favicon provider",
        desc: "Auto icons are cached in plugin data and are not fetched during normal render.",
        control: {
          type: "dropdown",
          key: "faviconProvider",
          options: {
            "google-s2": "Google S2",
            none: "Disabled",
          },
        },
      },
      {
        name: "Refresh all icons",
        desc: "Refetches and caches icons for subscriptions using auto favicon and a service URL.",
        render: (setting) => {
          this.addRefreshAllIconsButton(setting);
        },
      },
      {
        name: "Confirm before delete",
        control: {
          type: "toggle",
          key: "confirmBeforeDelete",
        },
      },
      {
        type: "group",
        heading: "Backup and restore",
        items: [
          {
            name: "Export backup",
            desc: "Downloads settings, subscriptions, and custom currencies. Favicons are excluded.",
            render: (setting) => {
              setting.addButton((button) =>
                button.setButtonText("Export JSON").onClick(async () => {
                  try {
                    downloadJson(
                      this.containerEl.ownerDocument,
                      backupFilename(),
                      await this.plugin.exportBackupJson()
                    );
                    new Notice("Backup downloaded");
                  } catch (error) {
                    console.error("Failed to export backup:", error);
                    new Notice("Failed to download backup");
                  }
                })
              );
            },
          },
          {
            name: "Restore backup",
            desc: "Replaces current settings, subscriptions, and custom currencies. It does not add or merge records.",
            render: (setting) => {
              setting.addButton((button) => {
                button.buttonEl.addClass("mod-warning");
                button.setButtonText("Restore JSON").onClick(() => {
                  const input = createDetachedFileInput(this.containerEl);
                  input.type = "file";
                  input.accept = "application/json,.json";
                  input.addEventListener("change", () => {
                    const file = input.files?.[0];
                    if (file) void this.restoreBackupFile(file, button);
                  });
                  input.click();
                });
              });
            },
          },
        ],
      },
      {
        type: "page",
        name: "Custom currencies",
        desc: "Create and manage currencies used by subscriptions.",
        items: [{
          type: "list",
          heading: "Saved currencies",
          emptyState: "No custom currencies yet. Add a currency to track points, credits, or tokens.",
          addItem: { name: "Add currency", action: () => this.openCurrencyEditor() },
          items: this.plugin.data.customCurrencies.map((currency) => ({
            name: getCurrencySelectLabel(currency),
            desc: `${getCurrencyPreviewAmount(currency.scale)} ${getCurrencyAmountMarker(currency)}${
              currency.isArchived ? " · Archived" : ""
            }${this.plugin.store.isCurrencyUsed(currency.code) ? " · Used by subscriptions" : ""}`,
            searchable: false,
            action: () => this.openCurrencyEditor(currency),
          })),
        }],
      },
    ];
  }

  private openCurrencyEditor(currency?: CurrencyMeta): void {
    openModalInDocument(() => new CustomCurrencyModal(this.app, this.plugin.store, () => this.update(), currency),
      this.containerEl.ownerDocument, "currency-form");
  }

  private addRefreshAllIconsButton(setting: Setting): ButtonComponent {
    let refreshAllButton: ButtonComponent | null = null;
    setting.addButton((button) => {
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
          } catch (error) {
            console.error("Failed to refresh all subscription icons:", error);
            new Notice("Failed to refresh all icons");
          } finally {
            button
              .setButtonText("Refresh all")
              .setDisabled(this.plugin.data.settings.faviconProvider === "none");
          }
        });
    });
    if (refreshAllButton === null) {
      throw new Error("Unable to create the refresh icons button.");
    }
    return refreshAllButton;
  }

  private async restoreBackupFile(file: File, button: ButtonComponent): Promise<void> {
    let contents: string;
    try {
      contents = await file.text();
    } catch (error) {
      console.error("Failed to read backup file:", error);
      new Notice(error instanceof Error ? error.message : "Failed to read backup file");
      return;
    }

    button.setDisabled(true).setButtonText("Restoring…");
    try {
      const report = await this.plugin.restoreBackupJson(
        contents,
        (preview) => {
          const window = this.containerEl.ownerDocument.defaultView;
          const message = [
            "Restore this backup?",
            "Replaces current settings, subscriptions, and custom currencies. It does not add or merge records.",
            `Subscriptions: ${preview.subscriptions.imported} imported, ${preview.subscriptions.skipped} skipped.`,
            `Custom currencies: ${preview.customCurrencies.imported} imported, ${preview.customCurrencies.skipped} skipped.`,
          ].join("\n\n");
          return window?.confirm(message) ?? false;
        }
      );
      if (!report) return;
      new Notice(
        `Backup restored: ${report.subscriptions.imported} subscriptions and ${report.customCurrencies.imported} custom currencies imported; ${report.subscriptions.skipped + report.customCurrencies.skipped} records skipped.`
      );
      this.update();
    } catch (error) {
      console.error("Failed to restore backup:", error);
      new Notice(error instanceof Error ? error.message : "Failed to restore backup");
    } finally {
      button.setButtonText("Restore JSON").setDisabled(false);
    }
  }
}
