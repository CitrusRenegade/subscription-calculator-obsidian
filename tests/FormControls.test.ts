import { describe, expect, it } from "vitest";
import { MAX_CUSTOM_BILLING_PERIOD_DAYS } from "../src/constants";
import type { CurrencyRegistry } from "../src/money/CurrencyRegistry";
import {
  createCurrencySelect,
  createCustomBillingPeriodDaysInput,
  createMoneyInput,
  createPeriodSelect,
  createToggleSwitch,
} from "../src/ui/components/FormControls";

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  checked = false;
  value = "";
  text = "";
  selected = false;
  hidden = false;
  readonly style = { setProperty: (_name: string, _value: string) => undefined };
  readonly selectedOptions: FakeElement[] = [];

  createDiv(): FakeElement {
    const child = new FakeElement();
    this.children.push(child);
    return child;
  }

  createEl(_tagName?: string, options?: { attr?: Record<string, string> }): FakeElement {
    const child = new FakeElement();
    for (const [name, value] of Object.entries(options?.attr ?? {})) {
      child.setAttribute(name, value);
      if (name === "value") child.value = value;
    }
    this.children.push(child);
    return child;
  }

  createSpan(options?: { text?: string }): FakeElement {
    const child = new FakeElement();
    child.text = options?.text ?? "";
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setText(text: string): void {
    this.text = text;
  }

  empty(): void {
    this.children.length = 0;
  }

  focus(): void {}

  blur(): void {}

  addEventListener(_event: string, _listener: () => void): void {}
}

describe("createToggleSwitch", () => {
  it("labels the checkbox for assistive technology", () => {
    const container = new FakeElement();

    createToggleSwitch(
      container as unknown as HTMLElement,
      true,
      () => undefined,
      "Enable or disable Netflix"
    );

    expect(container.children[0]?.children[0]?.attributes.get("aria-label")).toBe(
      "Enable or disable Netflix"
    );
  });

  it("labels card controls by their purpose instead of their selected value", () => {
    const container = new FakeElement();
    const registry = {
      get: () => ({ code: "USD", label: "USD", scale: 2, source: "builtin" }),
      listSelectable: () => [{ code: "USD", label: "USD", scale: 2, source: "builtin" }],
    } as unknown as CurrencyRegistry;

    const currency = createCurrencySelect(
      container as unknown as HTMLElement,
      registry,
      "USD",
      () => undefined,
      "Currency for Netflix"
    );
    const period = createPeriodSelect(
      container as unknown as HTMLElement,
      "monthly",
      () => undefined,
      "Billing period for Netflix"
    );
    const days = createCustomBillingPeriodDaysInput(
      container as unknown as HTMLElement,
      30,
      () => undefined,
      "Custom billing period days for Netflix"
    );

    expect(currency.getAttribute("aria-label")).toBe("Currency for Netflix");
    expect(period.getAttribute("aria-label")).toBe("Billing period for Netflix");
    expect(days.getAttribute("aria-label")).toBe(
      "Custom billing period days for Netflix"
    );
    expect(days.getAttribute("max")).toBe(String(MAX_CUSTOM_BILLING_PERIOD_DAYS));
  });

  it("labels the focused price input by its purpose", () => {
    const container = new FakeElement();
    const registry = {
      get: () => ({ code: "USD", label: "USD", scale: 2, source: "builtin" }),
    } as unknown as CurrencyRegistry;

    const input = createMoneyInput(
      container as unknown as HTMLElement,
      { amountMinor: 1999, currencyCode: "USD" },
      registry,
      () => undefined,
      "Price for Netflix"
    );

    expect(input.getAttribute("aria-label")).toBe("Price for Netflix");
  });
});
