import { UnsavedChangesModal } from "./components/UnsavedChangesModal";
import { focusFirstInvalid } from "./components/FormFieldFeedback";
import { App, Notice, ButtonComponent } from "obsidian";
import type { SubscriptionStore } from "../data/SubscriptionStore";
import type { CurrencyRegistry } from "../money/CurrencyRegistry";
import type { SubscriptionItem, SubscriptionViewItem } from "../types";
import { createSubscriptionStatusSetting } from "./components/FormControls";
import { SubscriptionDetailsFields, type SubscriptionIconContext } from "./components/SubscriptionDetailsFields";

export class EditSubscriptionModal extends UnsavedChangesModal {
  private readonly fields: SubscriptionDetailsFields;
  private saveButton: ButtonComponent | null = null;
  private busy = false;
  private enabled: boolean;
  private readonly initialEnabled: boolean;

  constructor(
    app: App,
    private readonly store: SubscriptionStore,
    registry: CurrencyRegistry,
    private readonly item: SubscriptionItem & Partial<Pick<SubscriptionViewItem, "effectiveStatus">>,
    icons: SubscriptionIconContext
  ) {
    super(app);
    this.fields = new SubscriptionDetailsFields(registry, icons, item);
    this.initialEnabled = (item.effectiveStatus ?? item.status) === "enabled";
    this.enabled = this.initialEnabled;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("subscription-calculator-modal");
    this.setTitle("Edit subscription");
    const form = contentEl.createDiv({ cls: "subscription-calculator-form-grid" });
    this.fields.renderName(form);
    this.fields.renderDetails(form, { openLink: true, onRefresh: () => void this.runAction("refresh") });
    createSubscriptionStatusSetting(contentEl, this.enabled, (checked) => { this.enabled = checked; });
    const actions = contentEl.createDiv({ cls: "subscription-calculator-modal-actions" });
    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
    this.saveButton = new ButtonComponent(actions)
      .setButtonText("Save").setCta().onClick(() => void this.runAction("save"));
    this.captureInitialValues();
  }

  protected isSaving(): boolean { return this.busy; }

  private async runAction(action: "save" | "refresh"): Promise<void> {
    if (this.busy || (action === "refresh" && !this.fields.canRefresh())) return;
    if (action === "save" && !this.fields.validate()) { focusFirstInvalid(this.contentEl); return; }
    this.busy = true;
    if (action === "save") this.setFormBusy(true);
    this.fields.setBusy(true);
    this.saveButton?.setDisabled(true);
    try {
      if (action === "save") {
        await this.store.updateSubscription(this.item.id, {
          ...this.fields.getPatch(),
          ...(this.enabled !== this.initialEnabled ? { status: this.enabled ? "enabled" as const : "disabled" as const } : {}),
        });
        this.closeAfterSave();
      } else {
        this.fields.setRefreshResult("Refreshing…");
        const refreshed = await this.store.refreshIcon(this.item.id);
        let snapshot;
        if (refreshed) {
          try { snapshot = await this.store.readSnapshot(); }
          catch {
            this.fields.setRefreshResult("Icon refreshed, but the preview could not be updated. Reopen this form to see it.");
            return;
          }
        }
        this.fields.setRefreshResult(
          refreshed ? "Icon refreshed" : "Could not load the website icon. Try again.",
          snapshot?.data.subscriptions.find((item) => item.id === this.item.id)
        );
      }
    } catch (e) {
      if (action === "refresh") this.fields.setRefreshResult("Could not refresh the website icon. Try again.");
      else new Notice(e instanceof Error ? e.message : "Failed to save subscription");
    } finally {
      this.busy = false;
      this.setFormBusy(false);
      this.fields.setBusy(false);
      this.saveButton?.setDisabled(false);
    }
  }
}
