// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App as ObsidianApp } from "obsidian";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import type { SubscriptionItem } from "../src/types";
import { BuiltinCurrencyRegistry } from "../src/money/CurrencyRegistry";
import { EditSubscriptionModal } from "../src/ui/EditSubscriptionModal";
import { App, Notice, changeInput, changeSelect, findButton, findSetting, installObsidianDomHelpers, resetObsidianDom } from "./helpers/obsidianDom";
vi.mock("obsidian", () => import("./helpers/obsidianDom"));
const item: SubscriptionItem = { id: "spotify", name: "Spotify", status: "enabled", price: { amountMinor: 999, currencyCode: "USD" }, billingPeriod: "monthly", icon: { mode: "auto" }, createdOn: "2026-07-19", updatedOn: "2026-07-19" };
function openModal(store: Partial<SubscriptionStore>, app = new App()) {
  const modal = new EditSubscriptionModal(app as unknown as ObsidianApp, store as SubscriptionStore, new BuiltinCurrencyRegistry(), item);
  modal.open(); return modal;
}
describe("EditSubscriptionModal", () => {
  beforeEach(resetObsidianDom);
  afterEach(() => vi.restoreAllMocks());
  it("Clear retains the open draft and Save commits it through its public button", async () => {
    const updateSubscription = vi.fn().mockResolvedValue(undefined);
    const clearIcon = vi.fn().mockResolvedValue(undefined);
    const modal = openModal({ updateSubscription, clearIcon });
    changeInput(findSetting(modal.contentEl, "Name").texts[0].inputEl, "Draft Spotify");
    findButton(modal.contentEl, "Clear icon").click();
    await vi.waitFor(() => expect(Notice.messages).toContain("Icon cleared"));
    expect(modal.contentEl.isConnected).toBe(true);
    expect(findSetting(modal.contentEl, "Name").texts[0].inputEl.value).toBe("Draft Spotify");
    expect(updateSubscription).not.toHaveBeenCalled();
    findButton(modal.contentEl, "Save").click();
    await vi.waitFor(() => expect(modal.contentEl.isConnected).toBe(false));
    expect(updateSubscription).toHaveBeenCalledWith("spotify", expect.objectContaining({ name: "Draft Spotify" }));
  });
  it("reveals and hides Emoji while retaining the focused mode dropdown", () => {
    const modal = openModal({});
    const mode = findSetting(modal.contentEl, "Icon mode").dropdowns[0].selectEl;
    const emoji = findSetting(modal.contentEl, "Emoji").settingEl;
    expect(emoji.hidden).toBe(true);
    mode.focus(); changeSelect(mode, "emoji");
    expect(emoji.hidden).toBe(false);
    expect(emoji.style.display).not.toBe("none");
    expect(document.activeElement).toBe(mode);
    changeSelect(mode, "none");
    expect(emoji.hidden).toBe(true);
    expect(emoji.style.display).toBe("none");
    expect(document.activeElement).toBe(mode);
  });
  it("Open URL uses the modal owner window and unsaved input without saving", () => {
    const frame = document.body.createEl("iframe");
    const owner = frame.contentWindow!; installObsidianDomHelpers(owner);
    const updateSubscription = vi.fn();
    const ownerOpen = vi.spyOn(owner, "open").mockImplementation(() => null);
    const globalOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    const modal = openModal({ updateSubscription }, new App(frame.contentDocument!));
    const input = findSetting(modal.contentEl, "Service URL").texts[0].inputEl;
    const button = findButton(modal.contentEl, "Open URL");
    expect(button.disabled).toBe(true);
    changeInput(input, "example.com"); expect(button.disabled).toBe(false);
    changeInput(input, "mailto:hello@example.com"); expect(button.disabled).toBe(true);
    changeInput(input, "example.com"); button.click();
    expect(ownerOpen).toHaveBeenCalledWith("https://example.com/", "_blank");
    expect(globalOpen).not.toHaveBeenCalled();
    expect(updateSubscription).not.toHaveBeenCalled();
    expect(modal.contentEl.isConnected).toBe(true);
  });
  it("reports Refresh and Clear failures and preserves the draft/modal", async () => {
    const modal = openModal({ updateSubscription: vi.fn().mockResolvedValue(undefined), refreshIcon: vi.fn().mockRejectedValue(new Error("refresh failed")), clearIcon: vi.fn().mockRejectedValue(new Error("clear failed")) });
    changeInput(findSetting(modal.contentEl, "Name").texts[0].inputEl, "Draft");
    findButton(modal.contentEl, "Refresh icon").click();
    await vi.waitFor(() => expect(Notice.messages).toContain("refresh failed"));
    findButton(modal.contentEl, "Clear icon").click();
    await vi.waitFor(() => expect(Notice.messages).toContain("clear failed"));
    expect(modal.contentEl.isConnected).toBe(true);
    expect(findSetting(modal.contentEl, "Name").texts[0].inputEl.value).toBe("Draft");
  });
});
