import { describe, expect, it, vi } from "vitest";
import { SubscriptionSettingTab } from "../src/settings/SubscriptionSettingTab";

describe("SubscriptionSettingTab with the shared Obsidian mock", () => {
  it("refreshes the native settings tab after a saved control", async () => {
    const data = {
      settings: {
        openMode: "right-sidebar" as const,
        defaultCurrency: "USD",
        faviconProvider: "google-s2" as const,
        confirmBeforeDelete: true,
        moneyDisplayPrecision: 0 as const,
        floatingYearlyTotal: false,
      },
      customCurrencies: [],
    };
    const plugin = {
      data,
      store: {
        updateSettings: vi.fn(async (mutation: (settings: typeof data.settings) => void) => {
          mutation(data.settings);
        }),
      },
    };
    const tab = new SubscriptionSettingTab({} as never, plugin as never);

    await expect(tab.setControlValue("openMode", "main-tab")).resolves.toBeUndefined();

    expect(plugin.data.settings.openMode).toBe("main-tab");
  });
});
