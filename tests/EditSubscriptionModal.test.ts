import { App, Notice, Setting } from "obsidian";
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
  dropdowns: Array<{ emitChange(value: string): void }>;
};

const mockSettings = Setting as unknown as {
  instances: MockSetting[];
  reset(): void;
};

const notices = Notice as unknown as {
  messages: string[];
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
    notices.reset();
  });

  it("clears the icon without closing or committing the current draft", async () => {
    const updateSubscription = vi.fn().mockResolvedValue(undefined);
    const clearIcon = vi.fn().mockResolvedValue(undefined);
    const modal = new EditSubscriptionModal({} as App, { updateSubscription, clearIcon } as unknown as SubscriptionStore,
      {} as CurrencyRegistry, item);
    modal.onOpen();
    mockSettings.instances.find((setting) => setting.name === "Name")?.texts[0]?.emitChange("Draft Spotify");
    mockSettings.instances.find((setting) => setting.name === "Icon cache")?.buttons[1]?.click();
    await Promise.resolve();
    expect((modal as unknown as { isClosed: boolean }).isClosed).toBe(false);
    expect(updateSubscription).not.toHaveBeenCalled();
    await (modal as unknown as { save(): Promise<void> }).save();
    expect(updateSubscription).toHaveBeenCalledWith("spotify", expect.objectContaining({ name: "Draft Spotify" }));
  });

  it("reveals emoji without replacing the focused mode dropdown", () => {
    const modal = new EditSubscriptionModal({} as App, {} as SubscriptionStore, {} as CurrencyRegistry, item);
    modal.onOpen();
    const mode = mockSettings.instances.find((setting) => setting.name === "Icon mode")!;
    const count = mockSettings.instances.length;
    mode.dropdowns[0].emitChange("emoji");
    expect(mockSettings.instances).toHaveLength(count);
    expect(mockSettings.instances.find((setting) => setting.name === "Icon mode")).toBe(mode);
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

  it("shows save failures from refresh and clear icon actions", async () => {
    const modal = new EditSubscriptionModal(
      {} as App,
      {
        updateSubscription: vi.fn().mockResolvedValue(undefined),
        refreshIcon: vi.fn().mockRejectedValue(new Error("refresh failed")),
        clearIcon: vi.fn().mockRejectedValue(new Error("clear failed")),
      } as unknown as SubscriptionStore,
      {} as CurrencyRegistry,
      item
    );

    modal.onOpen();
    const iconCacheSetting = mockSettings.instances.find(
      (setting) => setting.name === "Icon cache"
    );

    iconCacheSetting?.buttons[0]?.click();
    await Promise.resolve();
    await Promise.resolve();
    iconCacheSetting?.buttons[1]?.click();
    await Promise.resolve();

    expect(notices.messages).toEqual(["refresh failed", "clear failed"]);
    expect((modal as unknown as { isClosed: boolean }).isClosed).toBe(false);
  });
});
