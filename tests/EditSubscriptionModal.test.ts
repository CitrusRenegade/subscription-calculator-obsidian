// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App as ObsidianApp } from "obsidian";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import { BuiltinCurrencyRegistry } from "../src/money/CurrencyRegistry";
import { EditSubscriptionModal } from "../src/ui/EditSubscriptionModal";
import { App, Notice, changeInput, changeSelect, findButton, findSetting, installObsidianDomHelpers, resetObsidianDom } from "./helpers/obsidianDom";
import { sub } from "./helpers/subscriptionFactory";
import { deferred } from "./helpers/deferred";
vi.mock("obsidian", () => import("./helpers/obsidianDom"));
const item = sub({ id: "spotify", name: "Spotify", serviceUrl: "https://spotify.com/", price: { amountMinor: 999, currencyCode: "USD" }, icon: { mode: "auto" } });
function openModal(store: Partial<SubscriptionStore> = {}, app = new App(), provider: "google-s2" | "none" = "google-s2") {
  const modal = new EditSubscriptionModal(app as unknown as ObsidianApp, { readSnapshot: async () => ({ data: { subscriptions: [item] } }), ...store } as unknown as SubscriptionStore, new BuiltinCurrencyRegistry(), item,
    { iconService: { getCachedIcon: () => null }, getProvider: () => provider });
  modal.open(); return modal;
}
function emoji(modal: EditSubscriptionModal) { return modal.contentEl.querySelector<HTMLInputElement>('input[aria-label="Emoji"]')!; }
describe("EditSubscriptionModal", () => {
  beforeEach(resetObsidianDom);
  afterEach(() => vi.restoreAllMocks());
  it("keeps status changes as a draft until Save and discards them on Cancel", async () => {
    const updateSubscription = vi.fn().mockResolvedValue(undefined);
    const setSubscriptionEnabled = vi.fn().mockResolvedValue(undefined);
    const cancelled = openModal({ updateSubscription, setSubscriptionEnabled });
    const toggle = cancelled.contentEl.querySelector<HTMLInputElement>('input[aria-label="Enable subscription"]')!;
    expect(toggle.checked).toBe(true);
    toggle.click();
    expect(setSubscriptionEnabled).not.toHaveBeenCalled();
    findButton(cancelled.contentEl, "Cancel").click();
    expect(updateSubscription).not.toHaveBeenCalled();
    const saved = openModal({ updateSubscription, setSubscriptionEnabled });
    saved.contentEl.querySelector<HTMLInputElement>('input[aria-label="Enable subscription"]')!.click();
    findButton(saved.contentEl, "Save").click();
    await vi.waitFor(() => expect(setSubscriptionEnabled).toHaveBeenCalledWith("spotify", false));
    expect(saved.contentEl.isConnected).toBe(false);
  });
  it("previews modes, retains emoji drafts and shows Refresh only for a saved website icon", () => {
    const modal = openModal();
    const mode = findSetting(modal.contentEl, "Icon").dropdowns[0].selectEl;
    const refresh = findButton(modal.contentEl, "Refresh icon");
    expect(modal.contentEl.textContent).not.toContain("Icon cache");
    expect(modal.contentEl.textContent).not.toContain("Clear icon");
    expect(refresh.hidden).toBe(false);
    expect(modal.contentEl.textContent).toContain("No website icon loaded. Refresh to try again.");
    expect(emoji(modal).closest<HTMLElement>(".subscription-calculator-emoji-field")?.hidden).toBe(true);
    mode.focus(); changeSelect(mode, "emoji");
    expect(refresh.hidden).toBe(true);
    expect(emoji(modal).closest<HTMLElement>(".subscription-calculator-emoji-field")?.hidden).toBe(false);
    changeInput(emoji(modal), "🎵");
    expect(modal.contentEl.querySelector('[aria-label="Icon preview"]')?.textContent).toBe("🎵");
    changeSelect(mode, "none");
    expect(emoji(modal).closest<HTMLElement>(".subscription-calculator-emoji-field")?.hidden).toBe(true);
    expect(modal.contentEl.querySelector('[aria-label="Icon preview"] [data-icon]')).not.toBeNull();
    changeSelect(mode, "emoji");
    expect(emoji(modal).closest<HTMLElement>(".subscription-calculator-emoji-field")?.hidden).toBe(false);
    expect(emoji(modal).value).toBe("🎵");
    expect(document.activeElement).toBe(mode);
    expect(modal.contentEl.textContent).not.toContain("Price");
  });
  it("refreshes only the saved icon, keeps drafts, and reports the result inline", async () => {
    const refreshIcon = vi.fn().mockResolvedValue(true), updateSubscription = vi.fn();
    const modal = openModal({ refreshIcon, updateSubscription });
    changeInput(findSetting(modal.contentEl, "Name").texts[0].inputEl, "Unsaved name");
    findButton(modal.contentEl, "Refresh icon").click();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain("Icon refreshed"));
    expect(refreshIcon).toHaveBeenCalledWith("spotify");
    expect(updateSubscription).not.toHaveBeenCalled();
    expect(modal.contentEl.isConnected).toBe(true);
  });
  it("explains unavailable refresh for changed URLs and disabled downloads", () => {
    const modal = openModal();
    const url = findSetting(modal.contentEl, "Service URL").texts[0].inputEl;
    changeInput(url, "example.com");
    expect(findButton(modal.contentEl, "Refresh icon").hidden).toBe(true);
    expect(modal.contentEl.textContent).toContain("The website icon will be loaded when you save.");
    changeInput(url, "");
    expect(modal.contentEl.textContent).toContain("Add a service URL to use a website icon.");
    const disabled = openModal({}, new App(), "none");
    expect(findButton(disabled.contentEl, "Refresh icon").hidden).toBe(true);
    expect(disabled.contentEl.textContent).toContain("Website icon downloads are disabled in settings.");
  });
  it("validates empty emoji and URL near their fields without writing, then saves corrected values", async () => {
    const updateSubscription = vi.fn().mockResolvedValue(undefined);
    const modal = openModal({ updateSubscription });
    const mode = findSetting(modal.contentEl, "Icon").dropdowns[0].selectEl;
    changeSelect(mode, "emoji");
    changeInput(emoji(modal), "");
    const url = findSetting(modal.contentEl, "Service URL").texts[0].inputEl;
    changeInput(url, "not a url");
    findButton(modal.contentEl, "Save").click();
    expect(updateSubscription).not.toHaveBeenCalled();
    expect(url.getAttribute("aria-invalid")).toBe("true");
    expect(emoji(modal).getAttribute("aria-invalid")).toBe("true");
    expect(modal.contentEl.textContent).toContain("Paste an emoji to use as the icon.");
    changeInput(url, "example.com"); changeInput(emoji(modal), "🎵");
    findButton(modal.contentEl, "Save").click();
    await vi.waitFor(() => expect(modal.contentEl.isConnected).toBe(false));
    expect(updateSubscription).toHaveBeenCalledWith("spotify", expect.objectContaining({ icon: { mode: "emoji", emoji: "🎵" }, serviceUrl: "example.com" }));
  });
  it("Cancel asks before discarding the draft", () => {
    const updateSubscription = vi.fn();
    const modal = openModal({ updateSubscription });
    changeInput(findSetting(modal.contentEl, "Name").texts[0].inputEl, "Draft");
    findButton(modal.contentEl, "Cancel").click();
    expect(modal.contentEl.isConnected).toBe(true);
    findButton(document.body, "Discard changes").click();
    expect(modal.contentEl.isConnected).toBe(false);
    expect(updateSubscription).not.toHaveBeenCalled();
  });
  it("Open link uses the modal window and unsaved input without saving", () => {
    const frame = document.body.createEl("iframe");
    const owner = frame.contentWindow!; installObsidianDomHelpers(owner);
    const updateSubscription = vi.fn();
    const ownerOpen = vi.spyOn(owner, "open").mockImplementation(() => null);
    const globalOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    const modal = openModal({ updateSubscription }, new App(frame.contentDocument!));
    const input = findSetting(modal.contentEl, "Service URL").texts[0].inputEl;
    const button = findButton(modal.contentEl, "Open link");
    changeInput(input, ""); expect(button.disabled).toBe(true);
    changeInput(input, "mailto:hello@example.com"); expect(button.disabled).toBe(true);
    changeInput(input, "example.com"); button.click();
    expect(ownerOpen).toHaveBeenCalledWith("https://example.com/", "_blank");
    expect(globalOpen).not.toHaveBeenCalled(); expect(updateSubscription).not.toHaveBeenCalled();
  });
  it("reports a failed refresh inline without discarding the draft", async () => {
    const modal = openModal({ refreshIcon: vi.fn().mockResolvedValue(false) });
    changeInput(findSetting(modal.contentEl, "Name").texts[0].inputEl, "Draft");
    findButton(modal.contentEl, "Refresh icon").click();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain("Could not load the website icon. Try again."));
    expect(findSetting(modal.contentEl, "Name").texts[0].inputEl.value).toBe("Draft");
    expect(modal.contentEl.isConnected).toBe(true);
  });
  it("serializes refresh and save, and permits retry after a save failure", async () => {
    const gate = deferred<boolean>();
    const updateSubscription = vi.fn().mockRejectedValue(new Error("disk full"));
    const modal = openModal({ refreshIcon: vi.fn(() => gate.promise), updateSubscription });
    findButton(modal.contentEl, "Refresh icon").click();
    expect(findButton(modal.contentEl, "Save").disabled).toBe(true);
    gate.resolve(true);
    await vi.waitFor(() => expect(findButton(modal.contentEl, "Save").disabled).toBe(false));
    findButton(modal.contentEl, "Save").click();
    await vi.waitFor(() => expect(Notice.messages).toContain("disk full"));
    expect(modal.contentEl.isConnected).toBe(true);
    expect(findButton(modal.contentEl, "Save").disabled).toBe(false);
  });
});
