import { App, ButtonComponent, Modal, Scope } from "obsidian";

class DiscardChangesModal extends Modal {
  private settled = false;

  constructor(app: App, private readonly discard: () => void, private readonly keep: () => void) {
    super(app);
    this.scope = new Scope(this.scope);
  }

  onOpen(): void {
    this.scope.register([], "Escape", (event) => {
      if (!event.repeat) this.confirmDiscard();
      return false;
    });
    this.setTitle("Discard changes?");
    this.contentEl.createEl("p", { text: "Your changes have not been saved." });
    const actions = this.contentEl.createDiv({ cls: "subscription-calculator-discard-actions" });
    const keep = new ButtonComponent(actions).setButtonText("Keep editing").setCta().onClick(() => this.close());
    new ButtonComponent(actions).setButtonText("Discard changes").onClick(() => this.confirmDiscard());
    keep.buttonEl.focus();
  }

  private confirmDiscard(): void {
    if (this.settled) return;
    this.settled = true;
    super.close();
    this.discard();
  }

  close(): void {
    if (this.settled) return;
    this.settled = true;
    super.close();
    this.keep();
  }
}

/** Owns dismissal for both subscription forms; saving bypasses the draft prompt. */
export abstract class UnsavedChangesModal extends Modal {
  private baseline: string | null = null;
  private confirmation: DiscardChangesModal | null = null;

  protected abstract isSaving(): boolean;

  protected captureInitialValues(): void { this.baseline = this.values(); }

  private values(): string {
    return JSON.stringify(Array.from(this.contentEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "input, select:not(.is-measuring)"
    ), (input) => input instanceof this.contentEl.ownerDocument.defaultView!.HTMLInputElement && input.type === "checkbox"
      ? input.checked : input.value));
  }

  protected closeAfterSave(): void { super.close(); }

  close(): void {
    if (this.isSaving() || this.confirmation) return;
    if (this.baseline === null || this.baseline === this.values()) {
      super.close();
      return;
    }
    const focused = this.contentEl.ownerDocument.activeElement;
    this.confirmation = new DiscardChangesModal(this.app, () => {
      this.confirmation = null;
      super.close();
    }, () => {
      this.confirmation = null;
      if (focused instanceof this.contentEl.ownerDocument.defaultView!.HTMLElement && focused.isConnected) focused.focus();
    });
    this.confirmation.open();
  }
}
