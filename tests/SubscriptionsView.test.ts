import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import type { CurrencyRegistry } from "../src/money/CurrencyRegistry";
import type { IconService } from "../src/icons/IconService";
import { createDefaultData } from "../src/data/defaultData";

const dom = vi.hoisted(() => {
  class Element {
    children: Element[] = [];
    parentElement: Element | null = null;
    attributes = new Map<string, string>();
    classes = new Set<string>();
    hidden = false;
    value = "";
    scrollTop = 0;
    selectionStart: number | null = 2;
    selectionEnd: number | null = 2;
    tagName: string;
    style = { setProperty: vi.fn(), removeProperty: vi.fn() };
    classList = {
      contains: (value: string) => this.classes.has(value),
      add: (...values: string[]) => values.forEach((value) => this.classes.add(value)),
      toggle: (value: string, enabled: boolean) => enabled ? this.classes.add(value) : this.classes.delete(value),
    };
    listeners = new Map<string, Array<() => void>>();
    constructor(readonly ownerDocument: DocumentFixture, tag = "div") { this.tagName = tag.toUpperCase(); }
    private appendElement(tag: string, options?: { cls?: string | string[]; attr?: Record<string, string> }): Element {
      const child = new Element(this.ownerDocument, tag);
      const classes = options?.cls;
      for (const cls of Array.isArray(classes) ? classes : classes?.split(" ") ?? []) child.classes.add(cls);
      for (const [key, value] of Object.entries(options?.attr ?? {})) { child.setAttribute(key, value); if (key === "value") child.value = value; }
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    createEl(tag = "div", options?: { cls?: string | string[]; attr?: Record<string, string> }): Element { return this.appendElement(tag, options); }
    createDiv(options?: { cls?: string | string[] }): Element { return this.appendElement("div", options); }
    createSpan(options?: { cls?: string }): Element { return this.appendElement("span", options); }
    addClass(value: string): void { this.classes.add(value); }
    removeClass(value: string): void { this.classes.delete(value); }
    setAttribute(key: string, value: string): void { this.attributes.set(key, value); }
    getAttribute(key: string): string | null { return this.attributes.get(key) ?? null; }
    setText(): void {}
    contains(element: Element | null): boolean { return element === this || this.children.some((child) => child.contains(element)); }
    empty(): void {
      if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = null;
      this.children.forEach((child) => { child.parentElement = null; });
      this.children = [];
    }
    matches(selector: string): boolean {
      if (selector.startsWith(".")) return this.classes.has(selector.slice(1));
      if (selector.startsWith("[")) return this.attributes.has(selector.slice(1, -1));
      return selector.toUpperCase() === this.tagName;
    }
    closest(selector: string): Element | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
    querySelectorAll(selector: string): Element[] {
      return this.children.flatMap((child) => [...(selector.split(",").some((part) => child.matches(part.trim())) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector: string): Element | null { return this.querySelectorAll(selector)[0] ?? null; }
    get lastElementChild(): Element | null { return this.children.at(-1) ?? null; }
    addEventListener(event: string, callback: () => void): void { this.listeners.set(event, [...this.listeners.get(event) ?? [], callback]); }
    removeEventListener(event: string, callback: () => void): void { this.listeners.set(event, this.listeners.get(event)?.filter((listener) => listener !== callback) ?? []); }
    fire(event: string): void { this.listeners.get(event)?.forEach((callback) => callback()); }
    focus(): void { this.ownerDocument.activeElement = this; }
    blur(): void { this.ownerDocument.activeElement = null; this.fire("blur"); }
    setSelectionRange(start: number, end: number): void { this.selectionStart = start; this.selectionEnd = end; }
    remove(): void { this.parentElement = null; }
  }
  class DocumentFixture {
    activeElement: Element | null = null;
    visibilityState = "visible";
    events = new Map<string, () => void>();
    defaultView = {
      requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn(),
      addEventListener: (name: string, callback: () => void) => this.events.set(name, callback),
      removeEventListener: (name: string) => this.events.delete(name),
      ResizeObserver: class { observe(): void {} disconnect(): void {} },
    };
    addEventListener(name: string, callback: () => void): void { this.events.set(name, callback); }
    removeEventListener(name: string): void { this.events.delete(name); }
    querySelector(): null { return null; }
  }
  return { Element, DocumentFixture, leafCallbacks: [] as Array<(leaf: unknown) => void> };
});

vi.mock("obsidian", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("obsidian");
  return { ...actual, ItemView: class {
    contentEl = new dom.Element(new dom.DocumentFixture());
    app = { workspace: { on: (_event: string, callback: (leaf: unknown) => void) => { dom.leafCallbacks.push(callback); return callback; }, offref: (callback: (leaf: unknown) => void) => { dom.leafCallbacks.splice(dom.leafCallbacks.indexOf(callback), 1); } } };
    constructor(readonly leaf: unknown) {}
  } };
});
vi.mock("../src/ui/components/SubscriptionCard", async () => {
  const { createMoneyInput } = await import("../src/ui/components/FormControls");
  return { setSubscriptionCardDeletionPending: vi.fn(), renderSubscriptionCard: (container: HTMLElement, item: { id: string; name: string; price: { amountMinor: number; currencyCode: string } }, store: SubscriptionStore, registry: CurrencyRegistry) => {
    const card = container.createDiv({ cls: "subscription-calculator-card" });
    createMoneyInput(card, item.price, registry, (priceText) => { void store.updateSubscription(item.id, { priceText }); }, `Price for ${item.name}`);
    card.createEl("select", { cls: "subscription-calculator-currency-select" });
    return () => undefined;
  } };
});
vi.mock("../src/ui/components/SummaryHeader", () => {
  const render = (container: HTMLElement) => { const header = container.createDiv(); header.createDiv({ cls: "subscription-calculator-summary-values" }); return header; };
  return { renderSummaryHeader: render, renderFloatingSummary: render, updateFloatingSummary: vi.fn() };
});
vi.mock("../src/ui/components/SubscriptionSummaryTable", () => ({ renderSubscriptionSummaryTable: vi.fn() }));
vi.mock("../src/ui/components/AddSubscriptionCard", () => ({ renderAddSubscriptionCard: vi.fn() }));

import { SubscriptionsView } from "../src/ui/SubscriptionsView";

function setup() {
  const data = createDefaultData();
  const items = ["A", "B"].map((name) => ({ id: name, name, status: "enabled" as const, effectiveStatus: "enabled" as const, inDisableGracePeriod: false, price: { amountMinor: 1000, currencyCode: "USD" }, billingPeriod: "monthly" as const, icon: { mode: "none" as const }, createdOn: "2026-01-01", updatedOn: "2026-01-01" }));
  let notify!: () => void;
  const store = { subscribe: (callback: () => void) => { notify = callback; return vi.fn(); }, getTotalsByCurrency: () => [], getVisibleSubscriptions: () => items, getEnabledSubscriptions: () => items, updateSubscription: vi.fn().mockResolvedValue(undefined) };
  const registry = { get: () => ({ code: "USD", scale: 2 }), listSelectable: () => [] };
  const view = new SubscriptionsView({} as never, store as unknown as SubscriptionStore, registry as unknown as CurrencyRegistry, {} as IconService, () => data.settings);
  const container = view.contentEl as unknown as InstanceType<typeof dom.Element>;
  return { view, container, store, notify: () => notify() };
}

describe("SubscriptionsView interaction continuity", () => {
  beforeEach(() => { dom.leafCallbacks.length = 0; });

  it("keeps an unfinished price and focus when an unrelated save notifies", async () => {
    const { view, container, store, notify } = setup();
    await view.onOpen();
    const price = container.querySelectorAll("input")[1];
    price.hidden = false;
    price.value = "123.45";
    price.focus();
    notify();
    const restored = container.ownerDocument.activeElement;
    expect(restored?.value).toBe("123.45");
    expect(restored?.hidden).toBe(false);
    expect(restored?.getAttribute("aria-label")).toBe("Price for B");
    expect(store.updateSubscription).not.toHaveBeenCalled();
    await view.onClose();
  });

  it("keeps keyboard position after a save and refreshes on a new day only", async () => {
    const { view, container, notify } = setup();
    await view.onOpen();
    container.querySelectorAll("select")[1].focus();
    notify();
    expect(container.ownerDocument.activeElement?.tagName).toBe("SELECT");
    const render = vi.spyOn(view, "render");
    container.ownerDocument.events.get("focus")?.();
    expect(render).not.toHaveBeenCalled();
    await view.onClose();
    expect(container.ownerDocument.events.size).toBe(0);
    expect(dom.leafCallbacks).toHaveLength(0);
  });

  it("refreshes date presentation on return after midnight without saving", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 4, 23, 59));
      const { view, container, store } = setup();
      await view.onOpen();
      const render = vi.spyOn(view, "render");
      vi.setSystemTime(new Date(2026, 9, 5, 0, 1));
      container.ownerDocument.events.get("focus")?.();
      expect(render).toHaveBeenCalledOnce();
      container.ownerDocument.events.get("visibilitychange")?.();
      expect(render).toHaveBeenCalledOnce();
      expect(store.updateSubscription).not.toHaveBeenCalled();
      await view.onClose();
    } finally { vi.useRealTimers(); }
  });

  it("refreshes only when its own leaf becomes active, and skips hidden documents", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 4));
      const { view, container } = setup();
      await view.onOpen();
      const render = vi.spyOn(view, "render");
      vi.setSystemTime(new Date(2026, 9, 5));
      dom.leafCallbacks[0]({});
      expect(render).not.toHaveBeenCalled();
      container.ownerDocument.visibilityState = "hidden";
      dom.leafCallbacks[0](view.leaf);
      expect(render).not.toHaveBeenCalled();
      container.ownerDocument.visibilityState = "visible";
      dom.leafCallbacks[0](view.leaf);
      expect(render).toHaveBeenCalledOnce();
      await view.onClose();
    } finally { vi.useRealTimers(); }
  });
});
