import { Notice } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import SubscriptionCalculatorPlugin from "../src/main";

const notices = Notice as unknown as {
  messages: string[];
  reset(): void;
};

describe("plugin startup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("continues registering the plugin when startup cleanup cannot be saved", async () => {
    notices.reset();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("window", { setTimeout: vi.fn(), clearTimeout: vi.fn() });
    const plugin = new SubscriptionCalculatorPlugin({} as never, {} as never) as unknown as {
      loadData(): Promise<unknown>;
      onload(): Promise<void>;
      registeredViewTypes: string[];
      saveData(data: unknown): Promise<void>;
    };
    plugin.loadData = async () => ({
      customCurrencies: [
        {
          code: "TOK",
          label: "TOK",
          scale: 0,
          source: "custom",
          isArchived: true,
        },
      ],
    });
    plugin.saveData = async () => {
      throw new Error("disk full");
    };

    await expect(plugin.onload()).resolves.toBeUndefined();

    expect(plugin.registeredViewTypes).toEqual(["subscription-calculator-view"]);
    expect(notices.messages).toEqual(["Saved-data cleanup failed"]);
    expect(error).toHaveBeenCalledWith(
      "Failed to clean up saved subscription data:",
      expect.any(Error)
    );
  });
});
