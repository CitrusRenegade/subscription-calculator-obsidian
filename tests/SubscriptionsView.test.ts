// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import type { IconService } from "../src/icons/IconService";
import { createDefaultData } from "../src/data/defaultData";
import { DataBackedCurrencyRegistry } from "../src/money/CurrencyRegistry";
import { App, Modal, WorkspaceLeaf, resetObsidianDom } from "./helpers/obsidianDom";
import { viewItem } from "./helpers/subscriptionFactory";

vi.mock("obsidian", () => import("./helpers/obsidianDom"));
import { SubscriptionsView } from "../src/ui/SubscriptionsView";

function setup(app = new App()) {
  const data = createDefaultData();
  const items = ["A", "B"].map((name) => viewItem(name, { startDate: "2026-10-05" }));
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

  it("distinguishes Add and individual Edit dialogs while reusing repeated actions", async () => {
    const { view, container } = setup(); await open(view);
    const dialogs: Modal[] = [];
    vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) { dialogs.push(this); this.onOpen(); });
    try {
      const add = container.querySelector<HTMLButtonElement>(".subscription-calculator-add-card")!;
      const edits = container.querySelectorAll<HTMLButtonElement>('button[aria-label="Edit subscription"]');
      add.click(); edits[0].click(); edits[1].click(); edits[0].click(); add.click();
      expect(dialogs.map(dialog => dialog.title)).toEqual(["Add subscription", "Edit subscription", "Edit subscription"]);
      expect(dialogs.slice(1).map(dialog => dialog.contentEl.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value)).toEqual(["A", "B"]);
    } finally { for (const dialog of dialogs.reverse()) dialog.close(); }
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

  it("suppresses the teardown blur Chromium fires from a still-connected editor", async () => {
    const { view, container, store, notify } = setup();
    await open(view);
    const input = beginPrice(container, "B");
    input.value = "123.45";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Chromium dispatches blur from inside removeChild, before the removed editor
    // is disconnected, so the editor's detached check cannot ignore it; committing
    // from that blur ping-pongs with the re-render. Mimic the timing.
    const body = container.querySelector<HTMLElement>(".subscription-calculator-view-body")!;
    const realEmpty = body.empty.bind(body);
    vi.spyOn(body, "empty").mockImplementation(function (this: HTMLElement) {
      input.dispatchEvent(new FocusEvent("blur"));
      return realEmpty();
    });
    notify();
    expect(store.updateSubscription).not.toHaveBeenCalled();
    const restored = price(container, "B");
    expect(document.activeElement).toBe(restored);
    expect(restored.value).toBe("123.45");
    expect(restored.hidden).toBe(false);
    // The suppression is scoped to the teardown: an ordinary blur afterwards
    // still commits the draft exactly once.
    restored.dispatchEvent(new FocusEvent("blur"));
    expect(store.updateSubscription).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      expect.objectContaining({ priceText: "123.45" })
    );
  });

  it("never reads selection APIs of the number price editor during a re-render", async () => {
    const { view, container, notify } = setup();
    await open(view);
    const selectionEnd = vi.spyOn(HTMLInputElement.prototype, "selectionEnd", "get");
    const input = beginPrice(container, "B");
    input.value = "123.45";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    selectionEnd.mockClear();
    notify();
    expect(selectionEnd).not.toHaveBeenCalled();
    const restored = price(container, "B");
    expect(document.activeElement).toBe(restored);
    expect(restored.value).toBe("123.45");
    expect(restored.hidden).toBe(false);
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
