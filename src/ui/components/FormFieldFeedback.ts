let nextFieldId = 0;

/** Focus errors in visual DOM order, including fields owned by different sections. */
export function focusFirstInvalid(container: HTMLElement): void {
  container.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus();
}

/** Keeps an input's accessible label and inline error in sync. */
export class FormFieldFeedback {
  readonly errorEl: HTMLElement;
  constructor(readonly input: HTMLInputElement, label: string) {
    input.setAttribute("aria-label", label);
    const id = `subscription-field-${Date.now()}-${++nextFieldId}`;
    this.errorEl = input.parentElement!.createDiv({
      cls: "subscription-calculator-form-error",
      attr: { id, role: "alert" },
    });
    input.setAttribute("aria-describedby", id);
    this.setError(null);
  }

  setError(message: string | null): boolean {
    this.errorEl.setText(message ?? "");
    this.errorEl.hidden = message === null;
    if (message) this.input.setAttribute("aria-invalid", "true");
    else this.input.removeAttribute("aria-invalid");
    return message === null;
  }

  get invalid(): boolean { return !this.errorEl.hidden; }
}
