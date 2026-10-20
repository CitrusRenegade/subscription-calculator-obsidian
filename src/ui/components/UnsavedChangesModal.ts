import { App, ButtonComponent, Modal, Notice, Scope } from "obsidian";
import { openModalInDocument } from "./openModalInDocument";

const busyNoticeIntervalMs = 2500;

/** At most one notice per interval, however often dismissal is attempted. */
function showThrottledNotice(lastAt: { value: number }, message: string): void {
  if (Date.now() - lastAt.value < busyNoticeIntervalMs) return;
  lastAt.value = Date.now();
  new Notice(message);
}

interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Destructive confirmations style the confirm button with "mod-warning". */
  warning?: boolean;
  /** The cancel button is the primary action of the dialog. */
  cancelCta?: boolean;
  /** Close is refused with this notice while the confirm action runs. */
  busyNotice?: string;
  /** Shown when the confirm action rejects with a non-Error cause. */
  errorFallback?: string;
  onConfirm: () => Promise<void> | void;
  /** Cancel path; not invoked after window teardown. */
  onKeep?: () => void;
  /** Runs once on any terminal close, including teardown. */
  onSettle?: () => void;
}

/** Shared confirm/cancel dialog: busy refusal, inline errors, teardown safety. */
export class ConfirmationModal extends Modal {
  private settled = false;
  private busy = false;
  private readonly busyNoticeAt = { value: 0 };
  private errorEl: HTMLElement | null = null;
  private actionsEl!: HTMLElement;

  constructor(app: App, private readonly options: ConfirmationOptions) {
    super(app);
    this.scope = new Scope(this.scope);
    this.scope.register([], "Escape", (event) => {
      if (!event.repeat) this.close();
      return false;
    });
  }

  onOpen(): void {
    this.setTitle(this.options.title);
    this.contentEl.createEl("p", { text: this.options.message });
    this.actionsEl = this.contentEl.createDiv({ cls: "subscription-calculator-discard-actions" });
    const cancel = new ButtonComponent(this.actionsEl).setButtonText(this.options.cancelLabel);
    if (this.options.cancelCta) cancel.setCta();
    cancel.onClick(() => this.close());
    const confirm = new ButtonComponent(this.actionsEl).setButtonText(this.options.confirmLabel)
      .onClick(() => void this.run());
    if (this.options.warning) confirm.buttonEl.addClass("mod-warning");
    cancel.buttonEl.focus();
  }

  private async run(): Promise<void> {
    if (this.busy || this.settled) return;
    this.busy = true;
    for (const button of this.actionsEl.querySelectorAll<HTMLButtonElement>("button")) button.disabled = true;
    try {
      await this.options.onConfirm();
      this.settle();
    } catch (cause) {
      this.showError(cause instanceof Error ? cause.message : this.options.errorFallback ?? "The action failed.");
    } finally {
      this.busy = false;
      for (const button of this.actionsEl.querySelectorAll<HTMLButtonElement>("button")) button.disabled = false;
    }
  }

  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.options.onSettle?.();
    super.close();
  }

  close(): void {
    if (this.settled) return;
    if (this.busy) {
      showThrottledNotice(this.busyNoticeAt, this.options.busyNotice ?? "An operation is still in progress. Please wait before closing.");
      return;
    }
    this.settle();
    this.options.onKeep?.();
  }

  forceCloseOnWindowTeardown(): void {
    this.settle();
  }

  private showError(message: string): void {
    if (!this.errorEl) {
      this.errorEl = this.contentEl.createDiv({ cls: "subscription-calculator-form-error", attr: { role: "alert" } });
      this.actionsEl.before(this.errorEl);
    }
    this.errorEl.setText(message);
  }
}

/** Owns dismissal for both subscription forms; saving bypasses the draft prompt. */
export abstract class UnsavedChangesModal extends Modal {
  private baseline: string | null = null;
  private confirmation: ConfirmationModal | null = null;
  private readonly busyNoticeAt = { value: 0 };
  private readonly disabledControls = new Map<HTMLInputElement | HTMLSelectElement | HTMLButtonElement, boolean>();
  private tearingDown = false;
  private forceClosed = false;

  protected abstract isSaving(): boolean;

  protected captureInitialValues(): void { this.baseline = this.values(); }

  protected setFormBusy(busy: boolean, includeButtons = false): void {
    if (busy) {
      for (const input of Array.from(this.contentEl.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(includeButtons ? "input, select, button" : "input, select"))) {
        if (!this.disabledControls.has(input)) this.disabledControls.set(input, input.disabled);
        input.disabled = true;
      }
    } else {
      for (const [input, disabled] of this.disabledControls) {
        if (!this.isDerivedControl(input)) input.disabled = disabled;
      }
      this.disabledControls.clear();
    }
  }

  /** Derived controls recompute their own disabled state; the blanket restore skips them. */
  protected isDerivedControl(input: HTMLInputElement | HTMLSelectElement | HTMLButtonElement): boolean { return false; }

  private values(): string {
    // Hidden controls count toward the draft only when their value would persist:
    // the custom-days input is excluded while hidden (data-unsaved-ignore), while the
    // equally hidden emoji input stays measured because its draft is saved. Obsidian's
    // transient width-measuring select copies (is-measuring) are never draft state.
    return JSON.stringify(Array.from(this.contentEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "input:not([data-unsaved-ignore]), select:not(.is-measuring)"
    ), (input) => input.tagName === "INPUT" && input.type === "checkbox"
      ? input.checked : input.value));
  }

  protected closeAfterSave(): void { if (!this.forceClosed) super.close(); }

  /** Host window destruction cannot surface interactive dismissal; close unconditionally. */
  forceCloseOnWindowTeardown(): void {
    this.tearingDown = true;
    this.confirmation?.forceCloseOnWindowTeardown();
    this.confirmation = null;
    if (!this.forceClosed) {
      this.forceClosed = true;
      super.close();
    }
  }

  close(): void {
    const ownerWindow = this.contentEl.ownerDocument.defaultView;
    if (this.tearingDown || !ownerWindow || ownerWindow.closed) {
      this.forceCloseOnWindowTeardown();
      return;
    }
    if (this.isSaving()) {
      showThrottledNotice(this.busyNoticeAt, "An operation is still in progress. Please wait before closing.");
      return;
    }
    if (this.confirmation) return;
    if (this.baseline === null || this.baseline === this.values()) {
      super.close();
      return;
    }
    const focused = this.contentEl.ownerDocument.activeElement;
    let created: ConfirmationModal | undefined;
    try {
      openModalInDocument(() => {
        created = new ConfirmationModal(this.app, {
          title: "Discard changes?",
          message: "Your changes have not been saved.",
          confirmLabel: "Discard changes",
          cancelLabel: "Keep editing",
          cancelCta: true,
          onConfirm: () => { this.confirmation = null; super.close(); },
          onKeep: () => {
            this.confirmation = null;
            if (focused instanceof ownerWindow.HTMLElement && focused.isConnected) focused.focus();
          },
        });
        this.confirmation = created;
        return created;
      }, this.contentEl.ownerDocument);
    } catch {
      this.confirmation = null;
      created?.forceCloseOnWindowTeardown();
      new Notice("Could not open the confirmation. Please try again.");
    }
  }
}
