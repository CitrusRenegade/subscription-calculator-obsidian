import { App, Setting } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import type { CurrencyRegistry } from "../src/money/CurrencyRegistry";
import type { SubscriptionItem } from "../src/types";
import { EditSubscriptionModal } from "../src/ui/EditSubscriptionModal";

type MockText = {
  emitChange(value: string): void;
};

type MockButton = {
  disabled: boolean;
  buttonText: string;
  click(): void;
};

type MockSetting = {
  name: string;
  texts: MockText[];
  buttons: MockButton[];
};

const mockSettings = Setting as unknown as {
  instances: MockSetting[];
  reset(): void;
};

const item: SubscriptionItem = {
  id: "spotify",
  name: "Spotify",
  status: "enabled",
  price: { amountMinor: 999, currencyCode: "USD" },
  billingPeriod: "monthly",
  icon: { mode: "auto" },
  createdOn: "2026-07-19",
  updatedOn: "2026-07-19",
};

describe("EditSubscriptionModal Service URL", () => {
  beforeEach(() => {
    mockSettings.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates Open URL for unsaved input and opens its normalized URL in the modal window without saving", () => {
    const updateSubscription = vi.fn();
    const modal = new EditSubscriptionModal(
      {} as App,
      { updateSubscription } as unknown as SubscriptionStore,
      {} as CurrencyRegistry,
      item
    );
    const ownerWindowOpen = vi.fn();
    const globalWindowOpen = vi.fn();
    vi.stubGlobal("window", { open: globalWindowOpen });
    (
      modal as unknown as {
        contentEl: { ownerDocument: { defaultView: { open: typeof ownerWindowOpen } } };
      }
    ).contentEl.ownerDocument = { defaultView: { open: ownerWindowOpen } };

    modal.onOpen();

    const serviceUrlSetting = mockSettings.instances.find(
      (setting) => setting.name === "Service URL"
    );
    const input = serviceUrlSetting?.texts[0];
    const openUrlButton = serviceUrlSetting?.buttons[0];

    expect(openUrlButton?.buttonText).toBe("Open URL");
    expect(openUrlButton?.disabled).toBe(true);

    input?.emitChange("example.com");
    expect(openUrlButton?.disabled).toBe(false);

    input?.emitChange("mailto:hello@example.com");
    expect(openUrlButton?.disabled).toBe(true);

    input?.emitChange("example.com");
    openUrlButton?.click();

    expect(ownerWindowOpen).toHaveBeenCalledWith("https://example.com/", "_blank");
    expect(globalWindowOpen).not.toHaveBeenCalled();
    expect(updateSubscription).not.toHaveBeenCalled();
    expect((modal as unknown as { isClosed: boolean }).isClosed).toBe(false);
  });
});
