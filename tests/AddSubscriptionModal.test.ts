// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App as ObsidianApp } from "obsidian";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import { BuiltinCurrencyRegistry } from "../src/money/CurrencyRegistry";
import { AddSubscriptionModal } from "../src/ui/AddSubscriptionModal";
import { App, Notice, changeInput, changeSelect, expectRowVisible, findButton, findSetting, resetObsidianDom } from "./helpers/obsidianDom";
import { deferred } from "./helpers/deferred";
vi.mock("obsidian", () => import("./helpers/obsidianDom"));
function openModal(addSubscription = vi.fn(async () => undefined)) {
  const modal = new AddSubscriptionModal(new App() as unknown as ObsidianApp,
    { addSubscription } as unknown as SubscriptionStore, new BuiltinCurrencyRegistry(), "USD", { iconService: { getCachedIcon: () => null }, getProvider: () => "google-s2" });
  modal.open();
  return { modal, addSubscription };
}
describe("AddSubscriptionModal", () => {
  beforeEach(resetObsidianDom);
  afterEach(() => vi.restoreAllMocks());
  it("uses the enabled status switch to create a disabled subscription", async () => {
    const { modal, addSubscription } = openModal();
    changeInput(findSetting(modal.contentEl, "Name").texts[0].inputEl, "Paused service");
    changeInput(findSetting(modal.contentEl, "Price").texts[0].inputEl, "12.99");
    const enabled = modal.contentEl.querySelector<HTMLInputElement>('input[aria-label="Enable subscription"]')!;
    expect(enabled.checked).toBe(true);
    enabled.checked = false;
    enabled.dispatchEvent(new Event("change", { bubbles: true }));
    findButton(modal.contentEl, "Add").click();
    await vi.waitFor(() => expect(modal.contentEl.isConnected).toBe(false));
    expect(addSubscription).toHaveBeenCalledWith(expect.objectContaining({ status: "disabled" }));
  });
  it("shows inline name, price and custom-day errors without writing, and Cancel confirms before discarding the draft", () => {
    const { modal, addSubscription } = openModal();
    findButton(modal.contentEl, "Add").click();
    const name = findSetting(modal.contentEl, "Name").texts[0].inputEl;
    const price = findSetting(modal.contentEl, "Price").texts[0].inputEl;
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(price.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(name);
    changeInput(name, "Music"); changeInput(price, "12.99");
    changeSelect(findSetting(modal.contentEl, "Billing period").dropdowns[0].selectEl, "custom");
    const days = findSetting(modal.contentEl, "Custom period days").texts[0].inputEl;
    changeInput(days, "0"); findButton(modal.contentEl, "Add").click();
    expect(days.getAttribute("aria-invalid")).toBe("true");
    expect(addSubscription).not.toHaveBeenCalled();
    findButton(modal.contentEl, "Cancel").click();
    expect(modal.contentEl.isConnected).toBe(true);
    findButton(document.body, "Discard changes").click();
    expect(modal.contentEl.isConnected).toBe(false);
  });
  it("creates with the chosen icon mode and retains emoji drafts across mode changes", async () => {
    const { modal, addSubscription } = openModal();
    changeInput(findSetting(modal.contentEl, "Name").texts[0].inputEl, "Music");
    changeInput(findSetting(modal.contentEl, "Price").texts[0].inputEl, "12.99");
    const mode = findSetting(modal.contentEl, "Icon").dropdowns[0].selectEl;
    const emoji = modal.contentEl.querySelector<HTMLInputElement>('input[aria-label="Emoji"]')!;
    expectRowVisible(emoji.closest<HTMLElement>(".subscription-calculator-emoji-field")!, false);
    mode.focus(); changeSelect(mode, "emoji");
    expect(document.activeElement).toBe(mode);
    changeInput(emoji, "🎵");
    changeSelect(mode, "none"); changeSelect(mode, "emoji");
    expect(emoji.value).toBe("🎵");
    expect(modal.contentEl.textContent).not.toContain("Open link");
    findButton(modal.contentEl, "Add").click();
    await vi.waitFor(() => expect(modal.contentEl.isConnected).toBe(false));
    expect(addSubscription).toHaveBeenCalledWith(expect.objectContaining({ icon: { mode: "emoji", emoji: "🎵" } }));
  });
  it("submits through Add once while pending, disables it, and permits retry after failure", async () => {
    const save = deferred<void>();
    const { modal, addSubscription } = openModal(vi.fn(() => save.promise));
    const add = findButton(modal.contentEl, "Add");
    changeInput(findSetting(modal.contentEl, "Name").texts[0].inputEl, "Netflix");
    changeInput(findSetting(modal.contentEl, "Price").texts[0].inputEl, "19.99");
    add.click(); add.click();
    expect(addSubscription).toHaveBeenCalledOnce();
    expect(add.disabled).toBe(true);
    expect(addSubscription).toHaveBeenCalledWith(expect.objectContaining({ name: "Netflix", priceText: "19.99" }));
    save.reject(new Error("disk full"));
    await vi.waitFor(() => expect(Notice.messages).toContain("disk full"));
    expect(modal.contentEl.isConnected).toBe(true);
    expect(add.disabled).toBe(false);
    addSubscription.mockImplementation(async () => undefined);
    add.click();
    await vi.waitFor(() => expect(modal.contentEl.isConnected).toBe(false));
    expect(addSubscription).toHaveBeenCalledTimes(2);
  });
  it("reveals and hides Custom days without replacing or unfocusing the period dropdown", () => {
    const { modal } = openModal();
    const period = findSetting(modal.contentEl, "Billing period").dropdowns[0].selectEl;
    const daysRow = findSetting(modal.contentEl, "Custom period days").settingEl;
    const name = findSetting(modal.contentEl, "Name").texts[0].inputEl;
    expectRowVisible(daysRow, false);
    period.focus(); changeSelect(period, "custom");
    expectRowVisible(daysRow, true);
    expect(document.activeElement).toBe(period);
    expect(findSetting(modal.contentEl, "Name").texts[0].inputEl).toBe(name);
    changeSelect(period, "monthly");
    expectRowVisible(daysRow, false);
    expect(document.activeElement).toBe(period);
  });
  it("guards a re-entered Add callback independently of the disabled button", async () => {
    const save = deferred<void>();
    const { modal, addSubscription } = openModal(vi.fn(() => save.promise));
    const add = findButton(modal.contentEl, "Add");
    changeInput(findSetting(modal.contentEl, "Name").texts[0].inputEl, "Music");
    changeInput(findSetting(modal.contentEl, "Price").texts[0].inputEl, "12.99");
    try {
      add.click();
      // dispatchEvent invokes the listener even when native button.click() is disabled.
      // This isolates the synchronous guard without reaching into private modal state.
      add.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(addSubscription).toHaveBeenCalledOnce();
    } finally {
      save.resolve();
      await vi.waitFor(() => expect(modal.contentEl.isConnected).toBe(false));
    }
  });
  it("keeps entered fields when the billing period changes", () => {
    const { modal } = openModal();
    const name = findSetting(modal.contentEl, "Name").texts[0].inputEl;
    const price = findSetting(modal.contentEl, "Price").texts[0].inputEl;
    const url = findSetting(modal.contentEl, "Service URL").texts[0].inputEl;
    changeInput(name, "Netflix"); changeInput(price, "19.99"); changeInput(url, "netflix.com");
    changeSelect(findSetting(modal.contentEl, "Billing period").dropdowns[0].selectEl, "custom");
    expect(["Name", "Price", "Service URL"].map(label => findSetting(modal.contentEl, label).texts[0].inputEl.value)).toEqual(["Netflix", "19.99", "netflix.com"]);
  });
});
