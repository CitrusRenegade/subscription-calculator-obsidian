import { Notice } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import {
  setSubscriptionCardDeletionPending,
  toggleSubscriptionEnabled,
} from "../src/ui/components/SubscriptionCard";

class FakeCard {
  readonly classes = new Set<string>();
  readonly attributes = new Map<string, string>();
  readonly controls = [{ disabled: false }, { disabled: false }];
  readonly classList = {
    toggle: (className: string, enabled: boolean) => {
      if (enabled) this.classes.add(className);
      else this.classes.delete(className);
    },
  };

  querySelectorAll(): Array<{ disabled: boolean }> {
    return this.controls;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

describe("toggleSubscriptionEnabled", () => {
  it("shows the save failure from a status toggle", async () => {
    const notices = Notice as unknown as {
      messages: string[];
      reset(): void;
    };
    notices.reset();
    const store = {
      setSubscriptionEnabled: vi.fn().mockRejectedValue(new Error("disk full")),
    } as unknown as SubscriptionStore;

    toggleSubscriptionEnabled(store, "subscription-id", false);
    await Promise.resolve();

    expect(notices.messages).toEqual(["disk full"]);
  });

  it("blocks card controls while a confirmed deletion is saving", () => {
    const card = new FakeCard();

    setSubscriptionCardDeletionPending(card as unknown as HTMLElement, true);

    expect(card.controls.every((control) => control.disabled)).toBe(true);
    expect(card.attributes.get("aria-busy")).toBe("true");
    expect(card.classes.has("is-deleting")).toBe(true);

    setSubscriptionCardDeletionPending(card as unknown as HTMLElement, false);

    expect(card.controls.some((control) => control.disabled)).toBe(false);
    expect(card.attributes.has("aria-busy")).toBe(false);
    expect(card.classes.has("is-deleting")).toBe(false);
  });
});
