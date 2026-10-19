import { Setting, TextComponent, type ButtonComponent } from "obsidian";
import { parseDateOnly } from "../../date/dateOnly";
import { getOpenableServiceUrl, normalizeUrlInput } from "../../icons/url";
import type { IconService } from "../../icons/IconService";
import type { CurrencyRegistry } from "../../money/CurrencyRegistry";
import type { FaviconProvider, IconMode, SubscriptionItem } from "../../types";
import { FormFieldFeedback } from "./FormFieldFeedback";
import { renderSubscriptionIcon } from "./SubscriptionIcon";

export interface SubscriptionIconContext {
  iconService: Pick<IconService, "getCachedIcon">;
  getProvider: () => FaviconProvider;
}

/** Shared draft, validation and preview; persistence belongs to the dialog/store. */
export class SubscriptionDetailsFields {
  name: string;
  serviceUrl: string;
  startDate: string;
  iconMode: IconMode;
  emoji: string;
  private currencyCode: string;
  private savedItem?: SubscriptionItem;
  private preview: HTMLElement | null = null;
  private emojiField: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private refreshStatus: HTMLElement | null = null;
  private refreshButton: ButtonComponent | null = null;
  private feedback: Partial<Record<"name" | "date" | "url" | "emoji", FormFieldFeedback>> = {};
  private submitted = false;
  private busy = false;

  constructor(
    private readonly registry: CurrencyRegistry,
    private readonly icons: SubscriptionIconContext,
    item?: SubscriptionItem
  ) {
    this.savedItem = item;
    this.name = item?.name ?? "";
    this.serviceUrl = item?.serviceUrl ?? "";
    this.startDate = item?.startDate ?? "";
    this.iconMode = item?.icon.mode ?? "auto";
    this.emoji = item?.icon.emoji ?? "";
    this.currencyCode = item?.price.currencyCode ?? registry.getDefault().code;
  }

  renderName(container: HTMLElement): void {
    new Setting(container).setName("Name").addText((text) => {
      text.setPlaceholder("ChatGPT").setValue(this.name).onChange((value) => {
        this.name = value;
        if (this.submitted) this.validate();
      });
      this.feedback.name = new FormFieldFeedback(text.inputEl, "Name");
    });
  }

  renderDetails(container: HTMLElement, options: {
    openLink?: boolean;
    onRefresh?: () => void;
  } = {}): void {
    const date = new Setting(container).setName("Start date")
      .addText((text) => {
        text.inputEl.type = "date";
        text.setValue(this.startDate).onChange((value) => {
          this.startDate = value;
          if (this.submitted) this.validate();
        });
        this.feedback.date = new FormFieldFeedback(text.inputEl, "Start date");
      });

    date.settingEl.addClass("subscription-calculator-date-setting");
    date.controlEl.createDiv({ cls: "subscription-calculator-form-hint",
      text: "Optional. Sets the next payment date." });

    let openButton: ButtonComponent | undefined;
    const url = new Setting(container).setName("Service URL").addText((text) => {
      text.setPlaceholder("https://example.com").setValue(this.serviceUrl).onChange((value) => {
        this.serviceUrl = value;
        openButton?.setDisabled(!getOpenableServiceUrl(value));
        this.updateIconState();
        this.validateUrl();
      });
      this.feedback.url = new FormFieldFeedback(text.inputEl, "Service URL");
    });
    url.settingEl.addClass("subscription-calculator-service-url-setting");
    if (options.openLink) url.addButton((button) => {
      openButton = button.setButtonText("Open link")
        .setDisabled(!getOpenableServiceUrl(this.serviceUrl)).onClick(() => {
          const value = getOpenableServiceUrl(this.serviceUrl);
          if (value) container.ownerDocument.defaultView?.open(value, "_blank");
        });
    });
    // Keep an inline error after the input/button pair.
    if (this.feedback.url) url.controlEl.append(this.feedback.url.errorEl);

    url.controlEl.createDiv({ cls: "subscription-calculator-form-hint",
      text: options.openLink
        ? "Optional. Open link opens this address in your browser without saving changes."
        : "Optional. Used to open the service and load its website icon." });

    const icon = new Setting(container).setName("Icon");
    icon.settingEl.addClass("subscription-calculator-icon-setting");
    const block = icon.controlEl.createDiv({ cls: "subscription-calculator-icon-field" });
    const line = block.createDiv({ cls: "subscription-calculator-icon-preview-line" });
    this.preview = line.createSpan({ attr: { "aria-label": "Icon preview", role: "img" } });
    icon.addDropdown((dropdown) => {
      dropdown.addOption("auto", "Auto favicon").addOption("emoji", "Emoji")
        .addOption("none", "Currency icon").setValue(this.iconMode).onChange((value) => {
          this.iconMode = value as IconMode;
          this.updateIconState();
          if (this.submitted) this.validate();
        });
      dropdown.selectEl.setAttribute("aria-label", "Icon");
      line.append(dropdown.selectEl);
    });
    this.emojiField = block.createDiv({ cls: "subscription-calculator-emoji-field" });
    const emojiInput = new TextComponent(this.emojiField)
      .setPlaceholder("Paste an emoji you like").setValue(this.emoji).onChange((value) => {
        this.emoji = value;
        this.updateIconState();
        if (this.submitted) this.validate();
      });
    this.feedback.emoji = new FormFieldFeedback(emojiInput.inputEl, "Emoji");
    const emojiLabel = this.emojiField.createEl("label", { text: "Emoji" });
    emojiInput.inputEl.id = `${this.feedback.emoji.errorEl.id}-input`;
    emojiLabel.htmlFor = emojiInput.inputEl.id;
    this.emojiField.prepend(emojiLabel);
    this.hint = block.createDiv({ cls: "subscription-calculator-form-hint" });
    if (options.onRefresh) {
      const actions = block.createDiv({ cls: "subscription-calculator-icon-refresh" });
      icon.addButton((button) => {
        this.refreshButton = button.setButtonText("Refresh icon").onClick(() => {
          if (this.canRefresh() && !this.busy) options.onRefresh?.();
        });
        actions.append(button.buttonEl);
      });
      this.refreshStatus = actions.createSpan({
        cls: "subscription-calculator-form-hint", attr: { role: "status", "aria-live": "polite" },
      });
    }
    this.updateIconState();
  }

  setCurrencyCode(code: string): void { this.currencyCode = code; this.updateIconState(); }
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.refreshButton?.setDisabled(busy);
  }
  setRefreshResult(message: string, item?: SubscriptionItem): void {
    if (item) this.savedItem = item;
    this.updateIconState();
    this.refreshStatus?.setText(message);
  }

  canRefresh(): boolean {
    return this.iconMode === "auto" && this.savedItem?.icon.mode === "auto" &&
      this.icons.getProvider() !== "none" && !!getOpenableServiceUrl(this.serviceUrl) &&
      normalizeUrlInput(this.serviceUrl) === normalizeUrlInput(this.savedItem.serviceUrl);
  }

  private updateIconState(): void {
    const visible = this.iconMode === "emoji";
    if (this.emojiField) {
      this.emojiField.hidden = !visible;
      this.emojiField.style.display = visible ? "" : "none";
    }
    const sameUrl = normalizeUrlInput(this.serviceUrl) === normalizeUrlInput(this.savedItem?.serviceUrl);
    if (this.preview) {
      this.preview.empty();
      if (visible && !this.emoji.trim()) this.preview.setText("…");
      else {
        const previewItem: SubscriptionItem = {
          id: "", name: this.name, status: "enabled", billingPeriod: "monthly",
          price: { amountMinor: 0, currencyCode: this.currencyCode },
          icon: { mode: this.iconMode, emoji: this.emoji,
            cacheKey: sameUrl ? this.savedItem?.icon.cacheKey : undefined },
          createdOn: "", updatedOn: "",
        };
        renderSubscriptionIcon(this.preview, previewItem, this.icons.iconService, this.registry);
      }
    }
    let message = this.iconMode === "emoji"
      ? "Paste an emoji to use as the subscription icon."
      : "Uses the subscription currency icon. No download needed.";
    if (this.iconMode === "auto") {
      if (!getOpenableServiceUrl(this.serviceUrl)) message = "Add a service URL to use a website icon.";
      else if (this.icons.getProvider() === "none") message = "Website icon downloads are disabled in settings.";
      else if (!this.canRefresh()) message = "The website icon will be loaded when you save.";
      else if (this.savedItem && !this.icons.iconService.getCachedIcon(this.savedItem)) {
        message = "No website icon loaded. Refresh to try again.";
      } else message = "Uses the service website icon. Refresh icon downloads it again.";
    }
    if (this.hint) { this.hint.setText(message); this.hint.hidden = !message; }
    if (this.refreshButton) {
      this.refreshButton.buttonEl.hidden = !this.canRefresh();
      this.refreshButton.buttonEl.parentElement!.hidden = !this.canRefresh();
    }
    if (this.refreshStatus) { this.refreshStatus.setText(""); this.refreshStatus.hidden = !this.canRefresh(); }
  }

  private validateUrl(): boolean {
    return this.feedback.url?.setError(this.serviceUrl.trim() && !getOpenableServiceUrl(this.serviceUrl)
      ? "Enter a website address, such as example.com." : null) ?? true;
  }

  validate(): boolean {
    this.submitted = true;
    this.feedback.name?.setError(!this.name.trim() ? "Enter a subscription name." : null);
    this.feedback.date?.setError(this.startDate && !parseDateOnly(this.startDate) ? "Select a valid start date." : null);
    this.feedback.emoji?.setError(this.iconMode === "emoji" && !this.emoji.trim() ? "Paste an emoji to use as the icon." : null);
    this.validateUrl();
    return !Object.values(this.feedback).some((field) => field.invalid);
  }

  focusInvalid(): void { Object.values(this.feedback).find((field) => field.invalid)?.input.focus(); }

  getPatch() {
    return { name: this.name, serviceUrl: this.serviceUrl, startDate: this.startDate,
      icon: { mode: this.iconMode, emoji: this.emoji } };
  }
}
