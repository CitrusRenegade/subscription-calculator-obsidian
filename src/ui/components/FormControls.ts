import type { CurrencyRegistry } from "../../money/CurrencyRegistry";
import { moneyToInputValue } from "../../money/formatMoney";
import type { BillingPeriod, Money } from "../../types";

const PERIOD_LABELS: Record<BillingPeriod, string> = {
  weekly: "weekly",
  monthly: "monthly",
  quarterly: "quarterly",
  yearly: "yearly",
  custom: "custom",
};

function setFieldTextWidth(element: HTMLElement, text: string, minCh: number, maxCh: number): void {
  element.style.setProperty("--subscription-field-ch", String(Math.max(text.length, minCh)));
  element.style.setProperty("--subscription-field-min-ch", String(minCh));
  element.style.setProperty("--subscription-field-max-ch", String(maxCh));
}

function updateSelectTextWidth(select: HTMLSelectElement, minCh: number, maxCh: number): void {
  setFieldTextWidth(select, select.selectedOptions[0]?.text ?? select.value, minCh, maxCh);
}

export function createMoneyInput(
  container: HTMLElement,
  money: Money,
  registry: CurrencyRegistry,
  onCommit: (value: string) => void
): HTMLInputElement {
  const field = container.createDiv({ cls: "subscription-calculator-money-field" });
  const display = field.createEl("button", {
    cls: "subscription-calculator-money-display",
    attr: { type: "button" },
  });
  const input = field.createEl("input", {
    cls: "subscription-calculator-money-input",
    attr: {
      type: "number",
      min: "0",
      step: "any",
      inputmode: "decimal",
      value: moneyToInputValue(money, registry),
    },
  });
  input.hidden = true;

  const renderDisplay = () => {
    display.empty();
    const [whole, fraction] = input.value.split(/[.,]/, 2);
    display.createSpan({ text: whole || "0" });
    if (fraction !== undefined) {
      display.createSpan({
        cls: "subscription-calculator-money-fraction",
        text: `.${fraction}`,
      });
    }
    display.setAttribute("aria-label", `Edit price ${input.value || "0"}`);
  };
  const updateWidth = () => setFieldTextWidth(field, input.value || "0", 5, 14);
  const commit = () => onCommit(input.value);
  const finishEditing = () => {
    renderDisplay();
    input.hidden = true;
    display.hidden = false;
    commit();
  };

  renderDisplay();
  updateWidth();
  input.addEventListener("input", updateWidth);
  input.addEventListener("blur", finishEditing);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
  });
  display.addEventListener("click", () => {
    display.hidden = true;
    input.hidden = false;
    input.focus();
  });
  return input;
}

export function createCurrencySelect(
  container: HTMLElement,
  registry: CurrencyRegistry,
  selectedCode: string,
  onChange: (currencyCode: string) => void
): HTMLSelectElement {
  const select = container.createEl("select", {
    cls: "subscription-calculator-select",
  });
  for (const currency of registry.list()) {
    const option = select.createEl("option", {
      text: `${currency.code} ${currency.symbol}`,
      attr: { value: currency.code },
    });
    option.selected = currency.code === selectedCode;
  }
  updateSelectTextWidth(select, 5, 10);
  select.addEventListener("change", () => {
    updateSelectTextWidth(select, 5, 10);
    onChange(select.value);
  });
  return select;
}

export function createPeriodSelect(
  container: HTMLElement,
  selectedPeriod: BillingPeriod,
  onChange: (period: BillingPeriod) => void
): HTMLSelectElement {
  const select = container.createEl("select", {
    cls: "subscription-calculator-select subscription-calculator-period-select",
  });
  for (const [period, label] of Object.entries(PERIOD_LABELS)) {
    const option = select.createEl("option", {
      text: label,
      attr: { value: period },
    });
    option.selected = period === selectedPeriod;
  }
  updateSelectTextWidth(select, 5, 10);
  select.addEventListener("change", () => {
    updateSelectTextWidth(select, 5, 10);
    onChange(select.value as BillingPeriod);
  });
  return select;
}

export function createToggleSwitch(
  container: HTMLElement,
  checked: boolean,
  onChange: (checked: boolean) => void
): HTMLLabelElement {
  const label = container.createEl("label", {
    cls: "subscription-calculator-toggle",
  });
  const input = label.createEl("input", {
    attr: { type: "checkbox" },
  });
  input.checked = checked;
  label.createSpan({ cls: "subscription-calculator-toggle-track" });
  input.addEventListener("change", () => onChange(input.checked));
  return label;
}
