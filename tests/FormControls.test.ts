// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CUSTOM_BILLING_PERIOD_DAYS } from "../src/constants";
import { createDefaultData } from "../src/data/defaultData";
import { DataBackedCurrencyRegistry } from "../src/money/CurrencyRegistry";
import { resetObsidianDom } from "./helpers/obsidianDom";
import { createCurrencySelect, createCustomBillingPeriodDaysInput, createMoneyInput, createPeriodSelect, createToggleSwitch } from "../src/ui/components/FormControls";

function setup() {
  const data = createDefaultData();
  const registry = new DataBackedCurrencyRegistry(() => data.settings.defaultCurrency, () => data.customCurrencies);
  const container = document.body.createDiv();
  return { container, registry };
}

describe("card form controls in a DOM", () => {
  beforeEach(() => resetObsidianDom());

  it("labels the checkbox and sends the changed checked state", () => {
    const { container } = setup();
    const onChange = vi.fn();
    const label = createToggleSwitch(container, true, onChange, "Enable or disable Netflix");
    const checkbox = label.querySelector<HTMLInputElement>("input")!;
    expect(checkbox.getAttribute("aria-label")).toBe("Enable or disable Netflix");
    expect(checkbox.checked).toBe(true);
    checkbox.click();
    expect(checkbox.checked).toBe(false);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("labels card controls by purpose and handles actual change events", () => {
    const { container, registry } = setup();
    const onCurrency = vi.fn();
    const onPeriod = vi.fn();
    const onDays = vi.fn();
    const currency = createCurrencySelect(container, registry, "USD", onCurrency, "Currency for Netflix");
    const period = createPeriodSelect(container, "monthly", onPeriod, "Billing period for Netflix");
    const days = createCustomBillingPeriodDaysInput(container, 30, onDays, "Custom billing period days for Netflix");
    expect(currency.getAttribute("aria-label")).toBe("Currency for Netflix");
    expect(period.getAttribute("aria-label")).toBe("Billing period for Netflix");
    expect(days.getAttribute("aria-label")).toBe("Custom billing period days for Netflix");
    expect(days.max).toBe(String(MAX_CUSTOM_BILLING_PERIOD_DAYS));
    currency.value = "EUR";
    currency.dispatchEvent(new Event("change", { bubbles: true }));
    period.value = "custom";
    period.dispatchEvent(new Event("change", { bubbles: true }));
    days.value = "45";
    days.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onCurrency).toHaveBeenCalledExactlyOnceWith("EUR");
    expect(onPeriod).toHaveBeenCalledExactlyOnceWith("custom");
    expect(onDays).toHaveBeenCalledExactlyOnceWith(45);
    expect(period.parentElement?.querySelector(".subscription-calculator-select-display")?.textContent).toBe("custom");
  });

  it("opens a labeled price editor and commits once on Enter through native blur", () => {
    const { container, registry } = setup();
    const commit = vi.fn();
    const input = createMoneyInput(container, { amountMinor: 1999, currencyCode: "USD" }, registry, commit, "Price for Netflix");
    const display = container.querySelector<HTMLButtonElement>("button")!;
    expect(input.getAttribute("aria-label")).toBe("Price for Netflix");
    expect(display.getAttribute("aria-label")).toBe("Edit price for Netflix: 19.99");
    expect(input.hidden).toBe(true);
    display.click();
    expect(document.activeElement).toBe(input);
    expect(input.hidden).toBe(false);
    expect(display.hidden).toBe(true);
    expect(input.type).toBe("number");
    expect(input.selectionStart).toBeNull();
    input.value = "123.45";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(commit).toHaveBeenCalledExactlyOnceWith("123.45");
    expect(document.activeElement).toBe(display);
    expect(input.hidden).toBe(true);
    expect(display.hidden).toBe(false);
    expect(display.textContent).toBe("123.45");
  });

  it("commits a price when focus moves to another native control", () => {
    const { container, registry } = setup();
    const commit = vi.fn();
    const input = createMoneyInput(container, { amountMinor: 1000, currencyCode: "USD" }, registry, commit);
    container.querySelector<HTMLButtonElement>("button")!.click();
    input.value = "12.50";
    const next = container.createEl("button");
    next.focus();
    expect(document.activeElement).toBe(next);
    expect(commit).toHaveBeenCalledExactlyOnceWith("12.50");
    expect(input.hidden).toBe(true);
  });
});
