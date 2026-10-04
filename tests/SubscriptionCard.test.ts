// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import { Notice, installObsidianDomHelpers, resetObsidianDom } from "./helpers/obsidianDom";
vi.mock("obsidian", () => import("./helpers/obsidianDom"));
import { setSubscriptionCardDeletionPending, toggleSubscriptionEnabled, watchNextPaymentCollision } from "../src/ui/components/SubscriptionCard";

describe("subscription card behavior", () => {
  beforeEach(() => resetObsidianDom());

  it("shows the save failure from a status toggle", async () => {
    const store = { setSubscriptionEnabled: vi.fn().mockRejectedValue(new Error("disk full")) } as unknown as SubscriptionStore;
    toggleSubscriptionEnabled(store, "subscription-id", false);
    await vi.waitFor(() => expect(Notice.messages).toEqual(["disk full"]));
  });

  it("blocks native card controls while deletion saves and enables them on recovery", () => {
    const card = document.body.createDiv();
    const button = card.createEl("button");
    const input = card.createEl("input");
    const select = card.createEl("select");
    const click = vi.fn();
    button.addEventListener("click", click);
    setSubscriptionCardDeletionPending(card, true);
    expect([button, input, select].every(control => control.disabled)).toBe(true);
    expect(card.getAttribute("aria-busy")).toBe("true");
    expect(card.classList.contains("is-deleting")).toBe(true);
    button.click();
    expect(click).not.toHaveBeenCalled();
    setSubscriptionCardDeletionPending(card, false);
    expect([button, input, select].every(control => !control.disabled)).toBe(true);
    expect(card.hasAttribute("aria-busy")).toBe(false);
    expect(card.classList.contains("is-deleting")).toBe(false);
    button.click();
    expect(click).toHaveBeenCalledOnce();
  });

  it("disconnects and cancels observers in the card's owner window", () => {
    const iframe = document.body.createEl("iframe");
    const owner = iframe.contentWindow!;
    installObsidianDomHelpers(owner);
    const card = owner.document.body.createDiv();
    const observe = vi.fn();
    const disconnect = vi.fn();
    class Observer {
      constructor(_callback: ResizeObserverCallback) {}
      observe = observe;
      disconnect = disconnect;
    }
    Object.defineProperty(owner, "ResizeObserver", { configurable: true, value: Observer });
    const request = vi.spyOn(owner, "requestAnimationFrame").mockReturnValue(42);
    const cancel = vi.spyOn(owner, "cancelAnimationFrame");
    const dispose = watchNextPaymentCollision(card, card, card, card);
    expect(observe).toHaveBeenCalledExactlyOnceWith(card);
    expect(request).toHaveBeenCalledOnce();
    dispose();
    dispose();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(42);
    request.mockRestore(); cancel.mockRestore();
    iframe.remove();
  });
});
