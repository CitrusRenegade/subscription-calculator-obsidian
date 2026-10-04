import { App, Setting } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import type { CurrencyRegistry } from "../src/money/CurrencyRegistry";
import { AddSubscriptionModal } from "../src/ui/AddSubscriptionModal";

type MockSetting = {
  name: string;
  texts: Array<{ emitChange(value: string): void; value: string }>;
  dropdowns: Array<{ emitChange(value: string): void }>;
};

const mockSettings = Setting as unknown as {
  instances: MockSetting[];
  reset(): void;
};

function latestSetting(name: string): MockSetting {
  const setting = [...mockSettings.instances].reverse().find((item) => item.name === name);
  if (!setting) throw new Error(`Missing setting: ${name}`);
  return setting;
}

describe("AddSubscriptionModal", () => {
  beforeEach(() => {
    mockSettings.reset();
  });

  it("submits once while pending and permits retry after failure", async () => {
    let rejectSave!: (error: Error) => void;
    const addSubscription = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    const modal = new AddSubscriptionModal({} as App, { addSubscription } as unknown as SubscriptionStore,
      {} as CurrencyRegistry, "USD") as unknown as { submit(): Promise<void>; isClosed: boolean };
    const first = modal.submit();
    void modal.submit();
    expect(addSubscription).toHaveBeenCalledOnce();
    rejectSave(new Error("disk full"));
    await first;
    expect(modal.isClosed).toBe(false);
    addSubscription.mockImplementation(async () => undefined);
    await modal.submit();
    expect(addSubscription).toHaveBeenCalledTimes(2);
    expect(modal.isClosed).toBe(true);
  });

  it("reveals custom days without recreating existing settings", () => {
    const modal = new AddSubscriptionModal({} as App, {} as SubscriptionStore, {
      getDefault: () => ({ code: "USD" }),
      listSelectable: () => [{ code: "USD", label: "USD", scale: 2, source: "builtin" }],
    } as CurrencyRegistry, "USD");
    modal.onOpen();
    const name = latestSetting("Name");
    const count = mockSettings.instances.length;
    latestSetting("Billing period").dropdowns[0]?.emitChange("custom");
    expect(mockSettings.instances).toHaveLength(count);
    expect(latestSetting("Name")).toBe(name);
  });

  it("keeps entered fields visible when changing the billing period", () => {
    const modal = new AddSubscriptionModal(
      {} as App,
      {} as SubscriptionStore,
      {
        getDefault: () => ({ code: "USD" }),
        listSelectable: () => [{ code: "USD", label: "USD", scale: 2, source: "builtin" }],
      } as CurrencyRegistry,
      "USD"
    );

    modal.onOpen();
    latestSetting("Name").texts[0]?.emitChange("Netflix");
    latestSetting("Price").texts[0]?.emitChange("19.99");
    latestSetting("Service URL").texts[0]?.emitChange("netflix.com");
    latestSetting("Billing period").dropdowns[0]?.emitChange("custom");

    expect(latestSetting("Name").texts[0]?.value).toBe("Netflix");
    expect(latestSetting("Price").texts[0]?.value).toBe("19.99");
    expect(latestSetting("Service URL").texts[0]?.value).toBe("netflix.com");
  });
});
