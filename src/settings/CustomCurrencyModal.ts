import { App, ButtonComponent, Notice, Setting } from "obsidian";
import type { SubscriptionStore } from "../data/SubscriptionStore";
import type { CurrencyMeta } from "../types";
import { normalizeCurrencyAmountMarker, normalizeCurrencyLabel } from "../money/currencyValidation";
import { getCurrencyAmountMarker, getCurrencySelectLabel } from "../money/currencyDisplay";
import { FormFieldFeedback, focusFirstInvalid } from "../ui/components/FormFieldFeedback";
import { ConfirmationModal, UnsavedChangesModal } from "../ui/components/UnsavedChangesModal";
import { openModalInDocument } from "../ui/components/openModalInDocument";

type CurrencyStore = Pick<SubscriptionStore, "addCustomCurrency" | "updateCustomCurrency" | "deleteCustomCurrency" | "isCurrencyUsed">;

export function getCurrencyPreviewAmount(scale: number): string { return scale === 0 ? "19" : scale === 1 ? "19.9" : (19.99).toFixed(scale); }

export class CustomCurrencyModal extends UnsavedChangesModal {
  private label: string;
  private marker: string;
  private scale: number;
  private busy = false;
  private removing = false;
  private labelFeedback!: FormFieldFeedback;
  private markerFeedback!: FormFieldFeedback;
  private formError!: HTMLElement;
  private formatSelect!: HTMLSelectElement;

  constructor(app: App, private readonly store: CurrencyStore, private readonly onSaved: () => void,
    private readonly currency?: CurrencyMeta) {
    super(app);
    this.label = currency?.label ?? "";
    this.marker = currency?.amountMarker ?? "";
    this.scale = currency?.scale ?? 2;
  }

  protected isSaving(): boolean { return this.busy; }

  onOpen(): void {
    const content = this.contentEl;
    content.empty(); content.addClass("subscription-calculator-modal", "subscription-calculator-currency-modal");
    this.setTitle(this.currency ? "Edit currency" : "Add currency");
    const form = content.createDiv({ cls: "subscription-calculator-form-grid" });
    new Setting(form).setName("Label").addText((text) => {
      text.setValue(this.label).setPlaceholder("TOK").onChange((value) => { this.label = value; update(); });
      this.labelFeedback = new FormFieldFeedback(text.inputEl, "Currency label");
      text.inputEl.parentElement!.createDiv({ cls: "subscription-calculator-form-hint", text: "Name in currency lists. Up to 8 characters." });
    }).settingEl.addClass("subscription-calculator-half-field");
    new Setting(form).setName("Symbol").addText((text) => {
      text.setValue(this.marker).setPlaceholder("Optional").onChange((value) => { this.marker = value; update(); });
      this.markerFeedback = new FormFieldFeedback(text.inputEl, "Symbol");
      text.inputEl.parentElement!.createDiv({ cls: "subscription-calculator-form-hint", text: "Shown next to amounts. Leave empty to use the label." });
    }).settingEl.addClass("subscription-calculator-half-field");
    const used = !!this.currency && this.store.isCurrencyUsed(this.currency.code);
    const format = new Setting(form).setName("Price format").addDropdown((dropdown) => {
      dropdown.addOption("0", "Whole numbers — 19").addOption("2", "Two decimal places — 19.99");
      if (this.scale !== 0 && this.scale !== 2) dropdown.addOption(String(this.scale), `${this.scale} decimal place${this.scale === 1 ? "" : "s"} — ${getCurrencyPreviewAmount(this.scale)}`);
      this.formatSelect = dropdown.selectEl;
      dropdown.setValue(String(this.scale)); dropdown.selectEl.disabled = used;
      dropdown.selectEl.setAttribute("aria-label", "Price format");
      dropdown.onChange((value) => { this.scale = Number(value); update(); });
    });
    if (used) format.controlEl.createDiv({ cls: "subscription-calculator-form-hint", text: "Locked because this currency is used by subscriptions." });
    const preview = content.createDiv({ cls: "subscription-calculator-currency-preview", attr: { role: "status", "aria-live": "polite" } });
    const update = () => {
      this.formError?.empty();
      if (normalizeCurrencyLabel(this.label)) this.labelFeedback.setError(null);
      if (normalizeCurrencyAmountMarker(this.marker) !== null) this.markerFeedback.setError(null);
      const meta: CurrencyMeta = { code: this.currency?.code ?? "CUSTOM_PREVIEW", label: this.label.trim().toUpperCase() || "TOK",
        amountMarker: this.marker.trim() || undefined, scale: this.scale, source: "custom" };
      preview.empty();
      preview.createSpan({ cls: "subscription-calculator-form-hint", text: `In lists: ${getCurrencySelectLabel(meta)}` });
      preview.createEl("output", { text: `${getCurrencyPreviewAmount(this.scale)} ${getCurrencyAmountMarker(meta)}` });
    };
    update();
    this.formError = content.createDiv({ cls: "subscription-calculator-form-error", attr: { role: "alert" } });
    const actions = content.createDiv({ cls: "subscription-calculator-modal-actions" });
    if (this.currency && (!this.currency.isArchived || !used)) {
      const remove = new ButtonComponent(actions).setButtonText(used ? "Archive currency" : "Delete currency")
        .onClick(() => this.confirmRemoval());
      remove.buttonEl.addClass("subscription-calculator-currency-remove");
    }
    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
    new ButtonComponent(actions).setButtonText(this.currency ? "Save" : "Add currency").setCta().onClick(() => void this.save());
    this.captureInitialValues();
  }

  private validate(): boolean {
    const labelValid = this.labelFeedback.setError(normalizeCurrencyLabel(this.label) ? null : "Enter a label with 1 to 8 characters.");
    const markerValid = this.markerFeedback.setError(normalizeCurrencyAmountMarker(this.marker) === null ? "Use no more than 6 characters for the symbol." : null);
    if (!labelValid || !markerValid) focusFirstInvalid(this.contentEl);
    return labelValid && markerValid;
  }

  protected isDerivedControl(input: HTMLInputElement | HTMLSelectElement | HTMLButtonElement): boolean {
    return input === this.formatSelect;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.setFormBusy(busy, true);
    if (!busy) this.formatSelect.disabled = !!this.currency && this.store.isCurrencyUsed(this.currency.code);
  }

  private async save(): Promise<void> {
    if (this.busy || !this.validate()) return;
    this.formError.empty(); this.setBusy(true);
    const input = { label: this.label, amountMarker: this.marker, scale: this.scale };
    try {
      if (this.currency) await this.store.updateCustomCurrency(this.currency.code, input);
      else await this.store.addCustomCurrency(input);
      this.closeAfterSave(); this.onSaved();
    } catch (cause) { this.formError.setText(cause instanceof Error ? cause.message : "Could not save currency."); }
    finally { this.setBusy(false); }
  }

  private confirmRemoval(): void {
    if (!this.currency || this.busy || this.removing) return;
    const used = this.store.isCurrencyUsed(this.currency.code);
    this.removing = true;
    let created: ConfirmationModal | undefined;
    try {
      openModalInDocument(() => {
        created = new ConfirmationModal(this.app, {
          title: used ? "Archive currency?" : "Delete currency?",
          message: used
            ? `${this.currency!.label} will no longer be available for new subscriptions. Existing subscriptions and their amounts will be kept.`
            : `${this.currency!.label} will be permanently removed. No subscriptions use this currency.`,
          confirmLabel: used ? "Archive currency" : "Delete currency",
          cancelLabel: "Cancel",
          warning: true,
          busyNotice: "Removing this currency is still in progress. Please wait before closing.",
          errorFallback: "Could not remove currency.",
          onConfirm: async () => {
            this.setBusy(true);
            try { await this.store.deleteCustomCurrency(this.currency!.code); this.closeAfterSave(); this.onSaved(); }
            finally { this.setBusy(false); }
          },
          onSettle: () => { this.removing = false; },
        });
        return created;
      }, this.contentEl.ownerDocument);
    } catch {
      this.removing = false;
      created?.forceCloseOnWindowTeardown();
      new Notice("Could not open the confirmation. Please try again.");
    }
  }
}
