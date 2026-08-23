import { Notice } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import { toggleSubscriptionEnabled } from "../src/ui/components/SubscriptionCard";

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
});
