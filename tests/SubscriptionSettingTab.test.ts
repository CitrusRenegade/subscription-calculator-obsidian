// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App as ObsidianApp } from "obsidian";
import type SubscriptionCalculatorPlugin from "../src/main";
import { SubscriptionSettingTab } from "../src/settings/SubscriptionSettingTab";
import { createDefaultData } from "../src/data/defaultData";
import { DataBackedCurrencyRegistry } from "../src/money/CurrencyRegistry";
import { App, Notice, Setting, SettingPage, changeInput, findButton, resetObsidianDom } from "./helpers/obsidianDom";
import { deferred } from "./helpers/deferred";
vi.mock("obsidian", () => import("./helpers/obsidianDom"));
interface Definition {
  name?: string; heading?: string; type?: string;
  control?: { key?: string; type?: string; options?: Record<string, string> };
  items?: Definition[]; page?: () => SettingPage;
  action?: () => void; addItem?: { name: string; action: () => void }; emptyState?: string;
  render?: (setting: Setting, group: unknown) => void;
}
function createPlugin() {
  const data = createDefaultData();
  return { data, currencyRegistry: new DataBackedCurrencyRegistry(() => data.settings.defaultCurrency, () => data.customCurrencies),
    store: {
      addCustomCurrency: vi.fn().mockResolvedValue(undefined), deleteCustomCurrency: vi.fn().mockResolvedValue(undefined),
      isCurrencyUsed: vi.fn(() => false), refreshAllIcons: vi.fn().mockResolvedValue({ refreshed: 1, failed: 0, skipped: 0 }),
      updateCustomCurrency: vi.fn().mockResolvedValue(undefined),
      updateSettings: vi.fn(async (mutation: (settings: typeof data.settings) => void) => mutation(data.settings)),
    },
    exportBackupJson: vi.fn(async () => '{"format":"backup"}'),
    restoreBackupJson: vi.fn().mockResolvedValue({ subscriptions: { imported: 1, skipped: 0 }, customCurrencies: { imported: 0, skipped: 0 } }),
  };
}
function setup(plugin = createPlugin()) {
  const tab = new SubscriptionSettingTab(new App() as unknown as ObsidianApp, plugin as unknown as SubscriptionCalculatorPlugin);
  const definitions = tab.getSettingDefinitions() as unknown as Definition[];
  function find(name: string, items = definitions): Definition {
    for (const item of items) {
      if (item.name === name || item.heading === name) return item;
      if (item.items) { try { return find(name, item.items); } catch { /* search sibling */ } }
    }
    throw new Error(`Definition not found: ${name}`);
  }
  const render = (name: string) => { const definition = find(name); definition.render!(new Setting(tab.containerEl).setName(name), {}); return findButton(tab.containerEl, name === "Refresh all icons" ? "Refresh all" : name === "Export backup" ? "Export JSON" : "Restore JSON"); };
  return { plugin, tab, find, render };
}
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Expected text blob"));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read blob"));
    reader.readAsText(blob);
  });
}
describe("SubscriptionSettingTab", () => {
  it("shows both archived and used indicators for the same currency", () => {
    const plugin = createPlugin();
    plugin.data.customCurrencies.push({ code: "TOK", label: "TOK", scale: 2, source: "custom", isArchived: true });
    plugin.store.isCurrencyUsed.mockReturnValue(true);
    const { find } = setup(plugin);
    const row = find("Custom currencies").items![0].items![0] as Definition & { desc: string };
    expect(row.desc).toContain("Archived"); expect(row.desc).toContain("Used by subscriptions");
  });
  beforeEach(resetObsidianDom);
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("uses a native currency list and opens the shared Add/Edit form from its actions", async () => {
    const plugin = createPlugin();
    plugin.data.customCurrencies.push({ code: "TOK", label: "TOK", amountMarker: "¤", scale: 2, source: "custom" });
    const { find, tab } = setup(plugin);
    const update = vi.spyOn(tab, "update");
    const list = find("Custom currencies").items![0];
    expect(list.type).toBe("list"); expect(list.emptyState).toContain("No custom currencies");
    expect(tab.containerEl.querySelector("input")).toBeNull();
    list.addItem!.action();
    const label = document.querySelector<HTMLInputElement>('input[aria-label="Currency label"]')!;
    changeInput(label, "PTS"); findButton(document.body, "Add currency").click();
    await vi.waitFor(() => expect(plugin.store.addCustomCurrency).toHaveBeenCalledWith({ label: "PTS", amountMarker: "", scale: 2 }));
    await vi.waitFor(() => expect(label.isConnected).toBe(false));
    list.items![0].action!();
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Currency label"]')!.value).toBe("TOK");
    findButton(document.body, "Save").click();
    await vi.waitFor(() => expect(plugin.store.updateCustomCurrency).toHaveBeenCalledWith("TOK", { label: "TOK", amountMarker: "¤", scale: 2 }));
    expect(update).toHaveBeenCalledTimes(2);
  });
  it("publishes declarative controls, backup group and Custom currencies page", () => {
    const { find } = setup();
    expect(find("Open subscriptions in").control).toMatchObject({ key: "openMode", type: "dropdown" });
    expect(find("Default currency").control).toMatchObject({ key: "defaultCurrency", type: "dropdown" });
    expect(find("Default currency").control?.options?.USD).toBe("USD $");
    expect(find("Custom currencies").type).toBe("page"); expect(find("Backup and restore").type).toBe("group");
  });
  it("reads/writes every declarative control through the store and refreshes", async () => {
    const { tab, plugin } = setup(); const update = vi.spyOn(tab, "update");
    const cases = [["openMode", "main-tab"], ["defaultCurrency", "EUR"], ["moneyDisplayPrecision", true], ["floatingYearlyTotal", true], ["faviconProvider", "none"], ["confirmBeforeDelete", false]] as const;
    for (const [key, value] of cases) { await tab.setControlValue(key, value); expect(tab.getControlValue(key)).toBe(value); }
    expect(plugin.data.settings.moneyDisplayPrecision).toBe(1); expect(plugin.store.updateSettings).toHaveBeenCalledTimes(cases.length); expect(update).toHaveBeenCalledTimes(cases.length);
  });
  it("refreshes and reports settings save failure without changing saved data", async () => {
    const { tab, plugin } = setup(); const update = vi.spyOn(tab, "update");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    plugin.store.updateSettings.mockRejectedValueOnce(new Error("disk full"));
    await tab.setControlValue("defaultCurrency", "EUR");
    expect(plugin.data.settings.defaultCurrency).toBe("USD"); expect(Notice.messages).toContain("Failed to save setting"); expect(update).toHaveBeenCalledOnce();
  });
  it("Refresh all disables while pending and when provider is disabled", async () => {
    const { render, plugin, tab } = setup(); const fetching = deferred<{ refreshed: number; failed: number; skipped: number }>();
    plugin.store.refreshAllIcons.mockImplementationOnce(() => fetching.promise);
    const button = render("Refresh all icons"); button.click(); button.click();
    expect(button.disabled).toBe(true); expect(button.textContent).toBe("Refreshing…"); expect(plugin.store.refreshAllIcons).toHaveBeenCalledOnce();
    fetching.resolve({ refreshed: 1, failed: 0, skipped: 0 });
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(button.textContent).toBe("Refresh all");
    plugin.data.settings.faviconProvider = "none"; tab.containerEl.empty();
    expect(render("Refresh all icons").disabled).toBe(true);
  });
  it("waits for async export and reports failure without creating another download", async () => {
    const { render, plugin } = setup(); const exporting = deferred<string>(); plugin.exportBackupJson.mockImplementationOnce(() => exporting.promise);
    const createObjectURL = vi.fn((_blob: Blob) => "blob:backup");
    const NativeURL = window.URL;
    vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, { createObjectURL, revokeObjectURL: vi.fn() }));
    const linkClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const button = render("Export backup"); button.click(); expect(createObjectURL).not.toHaveBeenCalled();
    exporting.resolve('{"format":"backup"}');
    await vi.waitFor(() => expect(linkClick).toHaveBeenCalledOnce());
    expect(await readBlob(createObjectURL.mock.calls[0][0])).toBe('{"format":"backup"}');
    expect(Notice.messages).toContain("Backup downloaded");
    plugin.exportBackupJson.mockRejectedValueOnce(new Error("Read failed")); vi.spyOn(console, "error").mockImplementation(() => undefined);
    button.click(); await vi.waitFor(() => expect(Notice.messages).toContain("Failed to download backup"));
    expect(createObjectURL).toHaveBeenCalledOnce();
  });
  it("opens a detached Restore file chooser and updates controls after its selected file restores", async () => {
    const { render, tab, plugin } = setup(); const update = vi.spyOn(tab, "update");
    const chooserClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    const button = render("Restore backup"); button.click();
    expect(chooserClick).toHaveBeenCalledOnce();
    const input = chooserClick.mock.contexts[0] as HTMLInputElement;
    expect(input.type).toBe("file"); expect(input.accept).toBe("application/json,.json"); expect(input.isConnected).toBe(false);
    const file = new File(["{}"], "backup.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => "{}" });
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(plugin.restoreBackupJson).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(false); expect(button.textContent).toBe("Restore JSON");
  });
});
