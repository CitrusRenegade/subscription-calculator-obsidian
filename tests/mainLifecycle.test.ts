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
    vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout: vi.fn(), clearTimeout: vi.fn() }));
    const plugin = new SubscriptionCalculatorPlugin({} as never, {} as never) as unknown as {
      loadData(): Promise<unknown>;
      onload(): Promise<void>;
      registeredViewTypes: string[];
      cliHandlers: Map<string, (params: Record<string, string>) => string | Promise<string>>;
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
    expect([...plugin.cliHandlers.keys()]).toEqual([
      "subscription-calculator:list", "subscription-calculator", "subscription-calculator:export",
    ]);
    expect(notices.messages).toEqual(["Saved-data cleanup failed"]);
    expect(error).toHaveBeenCalledWith(
      "Failed to clean up saved subscription data:",
      expect.any(Error)
    );
  });

  it("registers unload durability and removes handlers and listeners during cleanup", async () => {
    const hostWindow = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
    vi.stubGlobal("window", hostWindow);
    const plugin = new SubscriptionCalculatorPlugin({} as never, {} as never) as SubscriptionCalculatorPlugin & {
      cliHandlers: Map<string, unknown>;
      runRegisteredCleanups(): void;
    };
    await plugin.onload();
    const flush = vi.spyOn(plugin.store, "flushDisableGracePeriods").mockResolvedValue(undefined);
    const dispose = vi.spyOn(plugin.store, "dispose");
    hostWindow.dispatchEvent(new Event("beforeunload"));
    expect(flush).toHaveBeenCalledOnce();
    plugin.onunload();
    expect(flush).toHaveBeenCalledTimes(2);
    plugin.runRegisteredCleanups();
    expect(dispose).toHaveBeenCalledOnce();
    expect(plugin.cliHandlers.size).toBe(0);
    hostWindow.dispatchEvent(new Event("beforeunload"));
    expect(flush).toHaveBeenCalledTimes(2);
    plugin.runRegisteredCleanups();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
