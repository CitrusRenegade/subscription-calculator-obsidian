import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  type ButtonComponent,
  type SettingDefinitionItem,
} from "obsidian";
import type SubscriptionCalculatorPlugin from "../main";
import {
  getCurrencyAmountMarker,
  getCurrencySelectLabel,
} from "../money/currencyDisplay";
import type { CurrencyMeta, FaviconProvider, OpenMode } from "../types";

type DynamicSettingTab = {
  update?: () => void;
};

function createTextFragment(text: string): DocumentFragment {
  const fragment = createFragment();
  fragment.append(text);
  return fragment;
}

function getSelectableCurrencyOptions(
  currencies: readonly CurrencyMeta[]
): Record<string, string> {
  const options: Record<string, string> = {};
  for (const currency of currencies) {
    options[currency.code] = getCurrencySelectLabel(currency);
  }
  return options;
}

function createDetachedFileInput(containerEl: HTMLElement): HTMLInputElement {
  const input = containerEl.createEl("input");
  input.remove();
  return input;
}

function getDecimalPlacesText(scale: number): string {
  return `${scale} decimal place${scale === 1 ? "" : "s"}`;
}

function getPreviewAmountText(scale: number): string {
  if (scale === 0) return "120";
  if (scale === 1) return "19.9";
  if (scale === 2) return "19.99";

  return (0.01).toFixed(scale);
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

  display(): void {
    this.renderContents();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
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
          options: getSelectableCurrencyOptions(
            this.plugin.currencyRegistry.listSelectable()
          ),
        },
      },
      {
        name: "More precise totals",
        desc:
          "Show totals to one decimal place instead of rounding to whole numbers (disabled by default).",
        control: { type: "toggle", key: "moneyDisplayPrecision" },
      },
      {
        name: "Total position",
        desc: "Off: top (default). On: bottom.",
        control: { type: "toggle", key: "floatingYearlyTotal" },
      },
      {
        name: "Favicon provider",
        desc: "Auto icons are cached in plugin data and are not fetched during normal render.",
        control: {
          type: "dropdown",
          key: "faviconProvider",
          options: { "google-s2": "Google S2", none: "Disabled" },
        },
      },
      {
        name: "Confirm before delete",
        control: { type: "toggle", key: "confirmBeforeDelete" },
      },
      {
        name: "Refresh all icons",
        desc: "Refetches and caches icons for subscriptions using auto favicon and a service URL.",
        searchable: false,
        render: (setting) => {
          this.addRefreshAllIconsButton(setting);
        },
      },
      {
        name: "Backup and restore",
        searchable: false,
        render: (setting) => {
          this.renderBackupAndRestoreControls(setting.settingEl);
        },
      },
      {
        name: "Custom currencies",
        searchable: false,
        render: (setting) => {
          this.renderCustomCurrenciesContent(setting.settingEl);
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    const settings = this.plugin.data.settings;
    if (key === "moneyDisplayPrecision") {
      return settings.moneyDisplayPrecision === 1;
    }
    if (
      key === "openMode" ||
      key === "defaultCurrency" ||
      key === "floatingYearlyTotal" ||
      key === "faviconProvider" ||
      key === "confirmBeforeDelete"
    ) {
      return settings[key];
    }
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.data.settings;
    if (key === "openMode" && (value === "right-sidebar" || value === "main-tab")) {
      settings.openMode = value;
      await this.plugin.savePluginData();
      return;
    }
    if (key === "defaultCurrency" && typeof value === "string") {
      settings.defaultCurrency = value;
      await this.plugin.store.saveSettings();
      return;
    }
    if (key === "moneyDisplayPrecision" && typeof value === "boolean") {
      settings.moneyDisplayPrecision = value ? 1 : 0;
      await this.plugin.store.saveSettings();
      return;
    }
    if (key === "floatingYearlyTotal" && typeof value === "boolean") {
      settings.floatingYearlyTotal = value;
      await this.plugin.store.saveSettings();
      return;
    }
    if (key === "faviconProvider" && (value === "google-s2" || value === "none")) {
      settings.faviconProvider = value;
      await this.plugin.savePluginData();
      this.updateSettingsView();
      return;
    }
    if (key === "confirmBeforeDelete" && typeof value === "boolean") {
      settings.confirmBeforeDelete = value;
      await this.plugin.savePluginData();
    }
  }

  private updateSettingsView(): void {
    const update = (this as unknown as DynamicSettingTab).update;
    if (update) {
      update.call(this);
      return;
    }
    this.renderContents();
  }

  private renderContents(): void {
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
      for (const currency of this.plugin.currencyRegistry.listSelectable()) {
        dropdown.addOption(currency.code, getCurrencySelectLabel(currency));
      }
      dropdown.setValue(this.plugin.currencyRegistry.getDefault().code);
      dropdown.onChange(async (value) => {
        this.plugin.data.settings.defaultCurrency = value;
        await this.plugin.store.saveSettings();
      });
    });

    new Setting(containerEl)
      .setName("More precise totals")
      .setDesc(
        "Show totals to one decimal place instead of rounding to whole numbers (disabled by default)."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.settings.moneyDisplayPrecision === 1)
          .onChange(async (value) => {
            this.plugin.data.settings.moneyDisplayPrecision = value ? 1 : 0;
            await this.plugin.store.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Total position")
      .setDesc("Off: top (default). On: bottom.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.settings.floatingYearlyTotal)
          .onChange(async (value) => {
            this.plugin.data.settings.floatingYearlyTotal = value;
            await this.plugin.store.saveSettings();
          })
      );

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

    refreshAllButton = this.addRefreshAllIconsButton(
      new Setting(containerEl)
        .setName("Refresh all icons")
        .setDesc("Refetches and caches icons for subscriptions using auto favicon and a service URL.")
    );

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

    new Setting(containerEl).setName("Backup and restore").setHeading();
    this.renderBackupAndRestoreControls(containerEl);

    this.renderCustomCurrenciesSection(containerEl);
  }

  private renderBackupAndRestoreControls(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Export backup")
      .setDesc("Downloads settings, subscriptions, and custom currencies. Favicons are excluded.")
      .addButton((button) =>
        button.setButtonText("Export JSON").onClick(() => {
          try {
            downloadJson(
              containerEl.ownerDocument,
              backupFilename(),
              this.plugin.exportBackupJson()
            );
            new Notice("Backup downloaded");
          } catch (error) {
            console.error("Failed to export backup:", error);
            new Notice("Failed to download backup");
          }
        })
      );
    new Setting(containerEl)
      .setName("Restore backup")
      .setDesc(
        "Replaces current settings, subscriptions, and custom currencies. It does not add or merge records."
      )
      .addButton((button) => {
        button.buttonEl.addClass("mod-warning");
        button.setButtonText("Restore JSON").onClick(() => {
          const input = createDetachedFileInput(containerEl);
          input.type = "file";
          input.accept = "application/json,.json";
          input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (file) void this.restoreBackupFile(file, button);
          });
          input.click();
        });
      });
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
      this.updateSettingsView();
    } catch (error) {
      console.error("Failed to restore backup:", error);
      new Notice(error instanceof Error ? error.message : "Failed to restore backup");
    } finally {
      button.setButtonText("Restore JSON").setDisabled(false);
    }
  }

  private renderCustomCurrenciesSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Custom currencies").setHeading();
    this.renderCustomCurrenciesContent(containerEl);
  }

  private renderCustomCurrenciesContent(containerEl: HTMLElement): void {
    this.renderCustomCurrencyForm(containerEl);

    const customCurrencies = this.plugin.data.customCurrencies;
    if (customCurrencies.length === 0) {
      containerEl.createDiv({
        cls: "subscription-calculator-settings-note",
        text: "No custom currencies yet.",
      });
      return;
    }

    for (const currency of customCurrencies) {
      this.renderCustomCurrencyForm(containerEl, currency);
    }
  }

  private renderCustomCurrencyForm(
    containerEl: HTMLElement,
    currency?: CurrencyMeta
  ): void {
    const isEdit = currency !== undefined;
    const isUsed = currency ? this.plugin.store.isCurrencyUsed(currency.code) : false;
    const wrapper = containerEl.createDiv({
      cls: "subscription-calculator-currency-settings",
    });
    const title = wrapper.createDiv({
      text: isEdit
        ? `${getCurrencySelectLabel(currency)}${currency.isArchived ? " (archived)" : ""}`
        : "Add custom currency",
    });
    title.addClass("subscription-calculator-currency-settings-title");

    let label = currency?.label ?? "";
    let amountMarker = currency?.amountMarker ?? "";
    let scale = currency?.scale ?? 2;
    const originalScale = scale;
    const hasAdvancedPrecision =
      isEdit && originalScale !== 0 && originalScale !== 2;

    if (isEdit) {
      const status = [
        getDecimalPlacesText(currency.scale),
        isUsed ? "used by subscriptions" : "unused",
      ].join(" · ");
      wrapper.createDiv({
        cls: "subscription-calculator-settings-note",
        text: status,
      });
    }

    let updatePreview = () => undefined;

    new Setting(wrapper)
      .setName("Currency label")
      .setDesc(
        createTextFragment(
          "Short name shown in currency lists. Examples: USD, CAD, CHF, TOK."
        )
      )
      .addText((text) =>
        text.setPlaceholder("TOK").setValue(label).onChange((value) => {
          label = value;
          updatePreview();
        })
      );
    new Setting(wrapper)
      .setName("Amount marker")
      .setDesc(
        createTextFragment(
          "Optional. This is what appears next to the number: $ for USD, C$ for CAD, or emojis for a custom currency. Leave empty to use the currency label."
        )
      )
      .addText((text) =>
        text
          .setPlaceholder("E.g. €, c$, emojis")
          .setValue(amountMarker)
          .onChange((value) => {
            amountMarker = value;
            updatePreview();
          })
      );
    new Setting(wrapper)
      .setName("With decimals")
      .setDesc("Use cents-style prices, such as 19.99.")
      .addToggle((toggle) =>
        toggle
          .setValue(scale !== 0)
          .setDisabled(isUsed)
          .onChange((value) => {
            scale = value ? 2 : 0;
            updatePreview();
          })
      );
    wrapper.createDiv({
      cls: "subscription-calculator-settings-note",
      text: isUsed
        ? "Locked while this currency is used by subscriptions."
        : hasAdvancedPrecision
          ? `Advanced precision: ${getDecimalPlacesText(originalScale)}. Leave unchanged to keep it, or change this setting to use the MVP format.`
          : "Turn this off for whole-number prices, such as points, credits, or tokens.",
    });
    const preview = wrapper.createDiv({
      cls: "subscription-calculator-currency-preview",
    });
    updatePreview = () => {
      const previewLabel = label.trim().toUpperCase() || "TOK";
      const previewCurrency: CurrencyMeta = {
        code: currency?.code ?? "CUSTOM_PREVIEW",
        label: previewLabel,
        amountMarker: amountMarker.trim() || undefined,
        scale,
        source: "custom",
      };
      const previewAmount = getPreviewAmountText(scale);
      preview.empty();
      preview.createDiv({
        cls: "subscription-calculator-currency-preview-title",
        text: "Preview",
      });
      const listRow = preview.createDiv({
        cls: "subscription-calculator-currency-preview-row",
      });
      listRow.createSpan({
        cls: "subscription-calculator-currency-preview-label",
        text: "Currency list",
      });
      listRow.createSpan({
        cls: "subscription-calculator-currency-preview-value",
        text: getCurrencySelectLabel(previewCurrency),
      });
      const amountRow = preview.createDiv({
        cls: "subscription-calculator-currency-preview-row",
      });
      amountRow.createSpan({
        cls: "subscription-calculator-currency-preview-label",
        text: "Amount",
      });
      amountRow.createSpan({
        cls: "subscription-calculator-currency-preview-value",
        text: `${previewAmount} ${getCurrencyAmountMarker(previewCurrency)}`,
      });
    };
    updatePreview();

    const action = new Setting(wrapper);
    if (isEdit) {
      action.addButton((button) =>
        button.setButtonText("Save").setCta().onClick(async () => {
          try {
            await this.plugin.store.updateCustomCurrency(currency.code, {
              label,
              amountMarker,
              scale,
            });
            new Notice("Custom currency saved");
            this.updateSettingsView();
          } catch (e) {
            new Notice(e instanceof Error ? e.message : "Failed to save currency");
          }
        })
      );
      action.addButton((button) => {
        button.buttonEl.addClass("mod-warning");
        button.setButtonText(isUsed ? "Archive" : "Delete").onClick(async () => {
          try {
            await this.plugin.store.deleteCustomCurrency(currency.code);
            new Notice(isUsed ? "Currency archived" : "Currency deleted");
            this.updateSettingsView();
          } catch (e) {
            new Notice(e instanceof Error ? e.message : "Failed to remove currency");
          }
        });
      });
      return;
    }

    action.addButton((button) =>
      button.setButtonText("Add currency").setCta().onClick(async () => {
        try {
          await this.plugin.store.addCustomCurrency({ label, amountMarker, scale });
          new Notice("Custom currency added");
          this.updateSettingsView();
        } catch (e) {
          new Notice(e instanceof Error ? e.message : "Failed to add currency");
        }
      })
    );
  }
}
