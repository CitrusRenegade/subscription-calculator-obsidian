import { App, Modal, Notice, Setting } from "obsidian";
import { DEFAULT_CUSTOM_BILLING_PERIOD_DAYS } from "../constants";
import type { SubscriptionStore } from "../data/SubscriptionStore";
import type { CurrencyRegistry } from "../money/CurrencyRegistry";
import { getCurrencySelectLabel } from "../money/currencyDisplay";
import type { BillingPeriod } from "../types";

export class AddSubscriptionModal extends Modal {
  private name = "";
  private price = "";
  private currencyCode: string;
  private startDate = "";
  private billingPeriod: BillingPeriod = "monthly";
  private customDays = DEFAULT_CUSTOM_BILLING_PERIOD_DAYS;
  private serviceUrl = "";

  constructor(
    app: App,
    private readonly store: SubscriptionStore,
    private readonly registry: CurrencyRegistry,
    defaultCurrency: string
  ) {
    super(app);
    this.currencyCode = defaultCurrency;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("subscription-calculator-modal");
    contentEl.createEl("h2", { text: "Add subscription" });

    new Setting(contentEl).setName("Name").addText((text) =>
      text.setPlaceholder("ChatGPT").onChange((value) => {
        this.name = value;
      })
    );

    new Setting(contentEl).setName("Price").addText((text) =>
      text.setPlaceholder("20").onChange((value) => {
        this.price = value;
      })
    );

    new Setting(contentEl).setName("Currency").addDropdown((dropdown) => {
      const selectable = this.registry.listSelectable();
      for (const currency of selectable) {
        dropdown.addOption(currency.code, getCurrencySelectLabel(currency));
      }
      this.currencyCode =
        selectable.find((currency) => currency.code === this.currencyCode)?.code ??
        this.registry.getDefault().code;
      dropdown.setValue(this.currencyCode);
      dropdown.onChange((value) => {
        this.currencyCode = value;
      });
    });

    new Setting(contentEl).setName("Billing period").addDropdown((dropdown) => {
      dropdown
        .addOption("weekly", "Weekly")
        .addOption("monthly", "Monthly")
        .addOption("quarterly", "Quarterly")
        .addOption("yearly", "Yearly")
        .addOption("custom", "Custom")
        .setValue(this.billingPeriod)
        .onChange((value) => {
          this.billingPeriod = value as BillingPeriod;
          this.onOpen();
        });
    });

    new Setting(contentEl)
      .setName("Start date")
      .setDesc("Optional. Used to calculate the next payment.")
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.startDate).onChange((value) => {
          this.startDate = value;
        });
      });

    if (this.billingPeriod === "custom") {
      new Setting(contentEl).setName("Custom period days").addText((text) =>
        text
          .setPlaceholder(String(DEFAULT_CUSTOM_BILLING_PERIOD_DAYS))
          .setValue(String(this.customDays))
          .onChange((value) => {
            this.customDays = Number(value);
          })
      );
    }

    new Setting(contentEl)
      .setName("Service URL")
      .setDesc("Used for favicon lookup. Optional.")
      .addText((text) =>
        text.setPlaceholder("https://example.com").onChange((value) => {
          this.serviceUrl = value;
        })
      );

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Add")
        .setCta()
        .onClick(() => void this.submit())
    );
  }

  private async submit(): Promise<void> {
    try {
      await this.store.addSubscription({
        name: this.name,
        priceText: this.price,
        currencyCode: this.currencyCode,
        startDate: this.startDate,
        billingPeriod: this.billingPeriod,
        customBillingPeriodDays:
          this.billingPeriod === "custom" ? this.customDays : undefined,
        serviceUrl: this.serviceUrl,
      });
      this.close();
    } catch (e) {
      new Notice(e instanceof Error ? e.message : "Failed to add subscription");
    }
  }
}
