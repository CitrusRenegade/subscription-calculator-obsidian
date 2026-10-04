// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultData } from "../src/data/defaultData";
import { SubscriptionStore } from "../src/data/SubscriptionStore";
import { DataBackedCurrencyRegistry } from "../src/money/CurrencyRegistry";
import { IconService } from "../src/icons/IconService";
import type { PluginData } from "../src/types";
import { App, WorkspaceLeaf, resetObsidianDom } from "./helpers/obsidianDom";
import { deferred } from "./helpers/deferred";
vi.mock("obsidian", () => import("./helpers/obsidianDom"));
import { SubscriptionsView } from "../src/ui/SubscriptionsView";

function setup(save: (data: PluginData) => Promise<void>) {
  const data = createDefaultData();
  data.subscriptions = ["A", "B"].map(name => ({ id: name, name, status: "enabled", price: { amountMinor: 1000, currencyCode: "USD" }, billingPeriod: "monthly", icon: { mode: "none" }, startDate: "2026-10-05", createdOn: "2026-01-01", updatedOn: "2026-01-01" }));
  const registry = new DataBackedCurrencyRegistry(() => data.settings.defaultCurrency, () => data.customCurrencies);
  const icons = new IconService(data, () => data.settings.faviconProvider);
  const saveData = vi.fn(() => save(data));
  const store = new SubscriptionStore(data, registry, icons, saveData, { now: () => new Date() });
  const view = new SubscriptionsView(new WorkspaceLeaf(new App()) as never, store, registry, icons, () => data.settings);
  return { data, store, view, saveData };
}
function beginPrice(view: SubscriptionsView, name: string): HTMLInputElement {
  view.contentEl.querySelector<HTMLButtonElement>(`button[aria-label^="Edit price for ${name}:"]`)!.click();
  return view.contentEl.querySelector<HTMLInputElement>(`input[aria-label="Price for ${name}"]`)!;
}
function enter(input: HTMLInputElement): void {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

describe("real store, view and card integration", () => {
  beforeEach(() => {
    resetObsidianDom();
    vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("keeps B's native price editor while A's deferred card save completes, then commits B", async () => {
    const gate = deferred<void>();
    const snapshots: PluginData[] = [];
    const { data, store, view, saveData } = setup(async current => {
      await gate.promise;
      snapshots.push(structuredClone(current));
    });
    try {
      await view.onOpen();
      const a = beginPrice(view, "A");
      a.value = "20.25";
      enter(a);
      await vi.waitFor(() => expect(saveData).toHaveBeenCalledOnce());
      const b = beginPrice(view, "B");
      b.value = "123.45";
      b.dispatchEvent(new Event("input", { bubbles: true }));
      expect(document.activeElement).toBe(b);
      expect(b.selectionStart).toBeNull();
      expect(snapshots).toHaveLength(0);
      gate.resolve();
      await vi.waitFor(() => expect(b.isConnected).toBe(false));
      const restored = view.contentEl.querySelector<HTMLInputElement>('input[aria-label="Price for B"]')!;
      expect(document.activeElement).toBe(restored);
      expect(restored.hidden).toBe(false);
      expect(restored.value).toBe("123.45");
      expect(restored.parentElement?.querySelector<HTMLButtonElement>("button")?.hidden).toBe(true);
      expect(data.subscriptions.find(item => item.id === "A")?.price.amountMinor).toBe(2025);
      expect(data.subscriptions.find(item => item.id === "B")?.price.amountMinor).toBe(1000);
      expect(snapshots).toHaveLength(1);
      expect(saveData).toHaveBeenCalledOnce();
      expect(view.contentEl.querySelector('.subscription-calculator-summary:not(.subscription-calculator-summary-floating) .subscription-calculator-summary-values')?.textContent).toBe("363 $");
      enter(restored);
      await store.readSnapshot();
      expect(saveData).toHaveBeenCalledTimes(2);
      expect(snapshots[1]?.subscriptions.find(item => item.id === "B")?.price.amountMinor).toBe(12345);
    } finally {
      gate.resolve();
      await store.readSnapshot();
      await view.onClose();
      store.dispose();
    }
  });

  it("refreshes actual countdowns after midnight without mutating or saving stored data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 4, 23, 59));
    const { data, store, view, saveData } = setup(async () => undefined);
    const before = structuredClone(data);
    try {
      await view.onOpen();
      expect(view.contentEl.querySelector(".subscription-calculator-next-payment")?.textContent).toBe("tomorrow");
      vi.setSystemTime(new Date(2026, 9, 5, 0, 1));
      document.dispatchEvent(new Event("visibilitychange"));
      expect(view.contentEl.querySelector(".subscription-calculator-next-payment")?.textContent).toBe("today");
      expect(data).toEqual(before);
      expect(saveData).not.toHaveBeenCalled();
    } finally { await view.onClose(); store.dispose(); }
  });
});
