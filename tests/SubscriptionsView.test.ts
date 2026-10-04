// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import type { IconService } from "../src/icons/IconService";
import { createDefaultData } from "../src/data/defaultData";
import { DataBackedCurrencyRegistry } from "../src/money/CurrencyRegistry";
import { App, WorkspaceLeaf, resetObsidianDom } from "./helpers/obsidianDom";

vi.mock("obsidian", () => import("./helpers/obsidianDom"));
import { SubscriptionsView } from "../src/ui/SubscriptionsView";

function setup(app = new App()) {
  const data = createDefaultData();
  const items = ["A", "B"].map((name) => ({ id: name, name, status: "enabled" as const, effectiveStatus: "enabled" as const, inDisableGracePeriod: false, price: { amountMinor: 1000, currencyCode: "USD" }, billingPeriod: "monthly" as const, icon: { mode: "none" as const }, startDate: "2026-10-05", createdOn: "2026-01-01", updatedOn: "2026-01-01" }));
  const callbacks = new Set<() => void>();
  const store = {
    subscribe: (callback: () => void) => { callbacks.add(callback); return () => callbacks.delete(callback); },
    getTotalsByCurrency: () => [], getVisibleSubscriptions: () => items, getEnabledSubscriptions: () => items,
    updateSubscription: vi.fn().mockResolvedValue(undefined), updateSettings: vi.fn().mockResolvedValue(undefined),
  };
  const registry = new DataBackedCurrencyRegistry(() => data.settings.defaultCurrency, () => data.customCurrencies);
  const icons = { getCachedIcon: () => null } as unknown as IconService;
  const leaf = new WorkspaceLeaf(app);
  const view = new SubscriptionsView(leaf as never, store as unknown as SubscriptionStore, registry, icons, () => data.settings);
  return { view, leaf, container: view.contentEl, store, data, app, notify: () => callbacks.forEach((callback) => callback()) };
}

const opened: SubscriptionsView[] = [];
async function open(view: SubscriptionsView) { opened.push(view); await view.onOpen(); }
function price(container: HTMLElement, name: string) { return container.querySelector<HTMLInputElement>(`input[aria-label="Price for ${name}"]`)!; }
function beginPrice(container: HTMLElement, name: string) {
  container.querySelector<HTMLButtonElement>(`button[aria-label^="Edit price for ${name}:"]`)!.click();
  return price(container, name);
}

describe("SubscriptionsView interaction continuity with actual cards", () => {
  beforeEach(() => {
    resetObsidianDom();
    vi.stubGlobal("ResizeObserver", class {
      observe(): void {}
      disconnect(): void {}
    });
  });
  afterEach(async () => {
    for (const view of opened.splice(0)) await view.onClose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps an unfinished price and focus when an unrelated save notifies", async () => {
    const { view, container, store, notify } = setup();
    await open(view);
    const input = beginPrice(container, "B");
    input.value = "123.45";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBeNull();
    notify();
    const restored = price(container, "B");
    expect(restored).not.toBe(input);
    expect(document.activeElement).toBe(restored);
    expect(restored.value).toBe("123.45");
    expect(restored.hidden).toBe(false);
    expect(restored.parentElement?.querySelector<HTMLButtonElement>("button")?.hidden).toBe(true);
    expect(store.updateSubscription).not.toHaveBeenCalled();
  });

  it("keeps keyboard position after a save and skips same-day focus refresh", async () => {
    const { view, container, notify } = setup();
    await open(view);
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Currency for B"]')!;
    select.focus();
    notify();
    const restored = container.querySelector<HTMLSelectElement>('select[aria-label="Currency for B"]')!;
    expect(restored).not.toBe(select);
    expect(document.activeElement).toBe(restored);
    const render = vi.spyOn(view, "render");
    window.dispatchEvent(new Event("focus"));
    expect(render).not.toHaveBeenCalled();
  });

  it("refreshes visible countdown on return after midnight without writes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 4, 23, 59));
    const { view, container, store, data } = setup();
    const before = JSON.stringify(data);
    await open(view);
    expect(container.querySelector(".subscription-calculator-next-payment")?.textContent).toBe("tomorrow");
    const render = vi.spyOn(view, "render");
    vi.setSystemTime(new Date(2026, 9, 5, 0, 1));
    window.dispatchEvent(new Event("focus"));
    expect(container.querySelector(".subscription-calculator-next-payment")?.textContent).toBe("today");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(render).toHaveBeenCalledOnce();
    expect(store.updateSubscription).not.toHaveBeenCalled();
    expect(store.updateSettings).not.toHaveBeenCalled();
    expect(JSON.stringify(data)).toBe(before);
  });

  it("refreshes only its active leaf and waits for a visible document", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 4));
    const { view, app, leaf } = setup();
    await open(view);
    const render = vi.spyOn(view, "render");
    vi.setSystemTime(new Date(2026, 9, 5));
    app.workspace.trigger("active-leaf-change", new WorkspaceLeaf(app));
    expect(render).not.toHaveBeenCalled();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    app.workspace.trigger("active-leaf-change", leaf);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(render).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    app.workspace.trigger("active-leaf-change", leaf);
    expect(render).toHaveBeenCalledOnce();
  });

  it("closing one of two views removes only its listeners and subscriptions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 4));
    const first = setup();
    const second = setup(first.app);
    await open(first.view);
    await open(second.view);
    const firstRender = vi.spyOn(first.view, "render");
    const secondRender = vi.spyOn(second.view, "render");
    vi.setSystemTime(new Date(2026, 9, 5));
    window.dispatchEvent(new Event("focus"));
    expect(firstRender).toHaveBeenCalledOnce();
    expect(secondRender).toHaveBeenCalledOnce();
    await first.view.onClose();
    firstRender.mockClear(); secondRender.mockClear();
    vi.setSystemTime(new Date(2026, 9, 6));
    window.dispatchEvent(new Event("focus"));
    expect(firstRender).not.toHaveBeenCalled();
    expect(secondRender).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date(2026, 9, 7));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(firstRender).not.toHaveBeenCalled();
    expect(secondRender).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date(2026, 9, 8));
    first.app.workspace.trigger("active-leaf-change", first.leaf);
    expect(firstRender).not.toHaveBeenCalled();
    first.app.workspace.trigger("active-leaf-change", second.leaf);
    expect(secondRender).toHaveBeenCalledTimes(3);
    first.notify();
    expect(firstRender).not.toHaveBeenCalled();
    second.notify();
    expect(secondRender).toHaveBeenCalledTimes(4);
  });
});
