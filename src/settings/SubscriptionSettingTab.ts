import { App, Notice, PluginSettingTab, Setting, type ButtonComponent } from "obsidian";
import type SubscriptionCalculatorPlugin from "../main";
import {
  getCurrencyAmountMarker,
  getCurrencySelectLabel,
} from "../money/currencyDisplay";
import type { CurrencyMeta, FaviconProvider, OpenMode } from "../types";

function createTextFragment(text: string): DocumentFragment {
  const fragment = activeDocument.createDocumentFragment();
  fragment.append(text);
  return fragment;
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

export class SubscriptionSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SubscriptionCalculatorPlugin) {
    super(app, plugin);
  }

  display(): void {
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

    this.renderCustomCurrenciesSection(containerEl);
  }

  private renderCustomCurrenciesSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Custom currencies").setHeading();
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
            this.renderContents();
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
            this.renderContents();
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
          this.renderContents();
        } catch (e) {
          new Notice(e instanceof Error ? e.message : "Failed to add currency");
        }
      })
    );
  }
}
