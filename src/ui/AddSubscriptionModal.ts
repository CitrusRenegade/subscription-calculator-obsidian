import { UnsavedChangesModal } from "./components/UnsavedChangesModal";
import { App, Notice, Setting, ButtonComponent } from "obsidian";
import { DEFAULT_CUSTOM_BILLING_PERIOD_DAYS, MAX_CUSTOM_BILLING_PERIOD_DAYS } from "../constants";
import type { SubscriptionStore } from "../data/SubscriptionStore";
import type { CurrencyRegistry } from "../money/CurrencyRegistry";
import { getCurrencySelectLabel } from "../money/currencyDisplay";
import type { BillingPeriod } from "../types";
import { createSubscriptionStatusSetting } from "./components/FormControls";
import { parseMoneyInput } from "../money/parseMoneyInput";
import { isValidCustomPeriodDays } from "../data/subscriptionCommands";
import { FormFieldFeedback, focusFirstInvalid } from "./components/FormFieldFeedback";
import { SubscriptionDetailsFields, type SubscriptionIconContext } from "./components/SubscriptionDetailsFields";

export class AddSubscriptionModal extends UnsavedChangesModal {
  private readonly fields: SubscriptionDetailsFields;
  private priceFeedback: FormFieldFeedback | null = null;
  private daysFeedback: FormFieldFeedback | null = null;
  private submitted = false;
  private price = "";
  private currencyCode: string;
  private billingPeriod: BillingPeriod = "monthly";
  private customDays = DEFAULT_CUSTOM_BILLING_PERIOD_DAYS;
  private disabled = false;
  private submitting = false;
  private addButton: ButtonComponent | null = null;

  constructor(
    app: App,
    private readonly store: SubscriptionStore,
    private readonly registry: CurrencyRegistry,
    defaultCurrency: string,
    icons: SubscriptionIconContext
  ) {
    super(app);
    this.currencyCode = defaultCurrency;
    this.fields = new SubscriptionDetailsFields(registry, icons);
    this.fields.setCurrencyCode(defaultCurrency);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("subscription-calculator-modal");
    this.setTitle("Add subscription");

    const form = contentEl.createDiv({ cls: "subscription-calculator-form-grid subscription-calculator-add-form" });
    this.fields.renderName(form);

    new Setting(form).setName("Price").addText((text) => {
      text.setPlaceholder("0.00").setValue(this.price).onChange((value) => {
        this.price = value;
        if (this.submitted) this.validateFinancialFields();
      });
      text.inputEl.inputMode = "decimal";
      this.priceFeedback = new FormFieldFeedback(text.inputEl, "Price");
    }).settingEl.addClass("subscription-calculator-half-field");
    const currencySetting = new Setting(form).setName("Currency").addDropdown((dropdown) => {
      const selectable = this.registry.listSelectable();
      for (const currency of selectable) {
        dropdown.addOption(currency.code, getCurrencySelectLabel(currency));
      }
      this.currencyCode =
        selectable.find((currency) => currency.code === this.currencyCode)?.code ??
        this.registry.getDefault().code;
      dropdown.setValue(this.currencyCode);
      dropdown.selectEl.setAttribute("aria-label", "Currency");
      this.fields.setCurrencyCode(this.currencyCode);
      dropdown.onChange((value) => {
        this.currencyCode = value;
        this.fields.setCurrencyCode(value);
        if (this.submitted) this.validateFinancialFields();
      });
    });

    currencySetting.settingEl.addClass("subscription-calculator-half-field");

    const billingGroup = form.createDiv({ cls: "subscription-calculator-billing-group" });
    let customDaysSetting: Setting;
    new Setting(billingGroup).setName("Billing period").addDropdown((dropdown) => {
      dropdown.selectEl.setAttribute("aria-label", "Billing period");
      dropdown
        .addOption("weekly", "Weekly")
        .addOption("monthly", "Monthly")
        .addOption("quarterly", "Quarterly")
        .addOption("yearly", "Yearly")
        .addOption("custom", "Custom")
        .setValue(this.billingPeriod)
        .onChange((value) => {
          this.billingPeriod = value as BillingPeriod;
          if (this.submitted) this.validateFinancialFields();
          customDaysSetting.settingEl.hidden = this.billingPeriod !== "custom";
          customDaysSetting.settingEl.style.setProperty("display", this.billingPeriod === "custom" ? "" : "none");
          this.daysFeedback?.input.toggleAttribute("data-unsaved-ignore", this.billingPeriod !== "custom");
        });
    });



    customDaysSetting = new Setting(billingGroup).setName("Custom period days").addText((text) => {
      text.setValue(String(this.customDays)).onChange((value) => {
        this.customDays = Number(value);
        if (this.submitted) this.validateFinancialFields();
      });
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.inputEl.max = String(MAX_CUSTOM_BILLING_PERIOD_DAYS);
      text.inputEl.step = "1";
      this.daysFeedback = new FormFieldFeedback(text.inputEl, "Custom period days");
      text.inputEl.toggleAttribute("data-unsaved-ignore", this.billingPeriod !== "custom");
    });
    customDaysSetting.settingEl.addClass("subscription-calculator-days-setting");
    customDaysSetting.settingEl.hidden = this.billingPeriod !== "custom";
    customDaysSetting.settingEl.style.setProperty("display", this.billingPeriod === "custom" ? "" : "none");

    this.fields.renderDetails(form);

    createSubscriptionStatusSetting(contentEl, !this.disabled, (checked) => { this.disabled = !checked; });
    const actions = contentEl.createDiv({ cls: "subscription-calculator-modal-actions" });
    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
    this.addButton = new ButtonComponent(actions)
      .setButtonText("Add")
      .setCta()
      .setDisabled(this.submitting)
      .onClick(() => void this.submit());
    this.captureInitialValues();
  }

  private validateFinancialFields(): boolean {
    const priceValid = this.priceFeedback?.setError(parseMoneyInput(this.price, this.currencyCode, this.registry)
      ? null : "Enter a valid price for the selected currency.") ?? true;
    const daysValid = this.daysFeedback?.setError(this.billingPeriod === "custom" && !isValidCustomPeriodDays(this.customDays)
      ? `Enter a whole number from 1 to ${MAX_CUSTOM_BILLING_PERIOD_DAYS}.` : null) ?? true;
    return priceValid && daysValid;
  }

  protected isSaving(): boolean { return this.submitting; }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    this.submitted = true;
    const detailsValid = this.fields.validate();
    const financialValid = this.validateFinancialFields();
    if (!detailsValid || !financialValid) {
      focusFirstInvalid(this.contentEl);
      return;
    }
    this.submitting = true;
    this.setFormBusy(true);
    this.addButton?.setDisabled(true);
    this.fields.setBusy(true);
    try {
      await this.store.addSubscription({
        ...this.fields.getPatch(),
        priceText: this.price,
        currencyCode: this.currencyCode,
        billingPeriod: this.billingPeriod,
        customBillingPeriodDays:
          this.billingPeriod === "custom" ? this.customDays : undefined,
        status: this.disabled ? "disabled" : "enabled",
      });
      this.closeAfterSave();
    } catch (e) {
      new Notice(e instanceof Error ? e.message : "Failed to add subscription");
    } finally {
      this.submitting = false;
      this.setFormBusy(false);
      this.addButton?.setDisabled(false);
      this.fields.setBusy(false);
    }
  }
}
