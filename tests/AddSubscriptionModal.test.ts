// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App as ObsidianApp } from "obsidian";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import { BuiltinCurrencyRegistry } from "../src/money/CurrencyRegistry";
import { AddSubscriptionModal } from "../src/ui/AddSubscriptionModal";
import { App, Notice, changeInput, changeSelect, findButton, findSetting, resetObsidianDom } from "./helpers/obsidianDom";
import { deferred } from "./helpers/deferred";
vi.mock("obsidian", () => import("./helpers/obsidianDom"));
function openModal(addSubscription = vi.fn(async () => undefined)) {
  const modal = new AddSubscriptionModal(new App() as unknown as ObsidianApp,
    { addSubscription } as unknown as SubscriptionStore, new BuiltinCurrencyRegistry(), "USD");
  modal.open();
  return { modal, addSubscription };
}
describe("AddSubscriptionModal", () => {
  beforeEach(resetObsidianDom);
  afterEach(() => vi.restoreAllMocks());
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
    expect(daysRow.hidden).toBe(true);
    expect(daysRow.style.display).toBe("none");
    period.focus(); changeSelect(period, "custom");
    expect(daysRow.hidden).toBe(false);
    expect(daysRow.style.display).not.toBe("none");
    expect(document.activeElement).toBe(period);
    expect(findSetting(modal.contentEl, "Name").texts[0].inputEl).toBe(name);
    changeSelect(period, "monthly");
    expect(daysRow.hidden).toBe(true);
    expect(daysRow.style.display).toBe("none");
    expect(document.activeElement).toBe(period);
  });
  it("guards a re-entered Add callback independently of the disabled button", async () => {
    const save = deferred<void>();
    const { modal, addSubscription } = openModal(vi.fn(() => save.promise));
    const add = findButton(modal.contentEl, "Add");
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
