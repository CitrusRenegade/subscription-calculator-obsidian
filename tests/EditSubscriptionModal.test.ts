// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App as ObsidianApp } from "obsidian";
import type { SubscriptionStore } from "../src/data/SubscriptionStore";
import { BuiltinCurrencyRegistry } from "../src/money/CurrencyRegistry";
import { EditSubscriptionModal } from "../src/ui/EditSubscriptionModal";
import { App, Notice, changeInput, changeSelect, findButton, findSetting, installObsidianDomHelpers, resetObsidianDom } from "./helpers/obsidianDom";
import { sub } from "./helpers/subscriptionFactory";
import type { CachedIcon } from "../src/types";
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
  it("locks every editable field while Save is pending and unlocks on failure", async () => {
    const gate = deferred<void>();
    const modal = openModal({ updateSubscription: vi.fn(() => gate.promise) });
    findButton(modal.contentEl, "Save").click();
    const controls = Array.from(modal.contentEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select"));
    expect(controls.every(control => control.disabled)).toBe(true);
    expect(findButton(modal.contentEl, "Refresh icon").disabled).toBe(true);
    gate.reject(new Error("disk full"));
    await vi.waitFor(() => expect(controls.every(control => !control.disabled)).toBe(true));
    expect(findButton(modal.contentEl, "Refresh icon").disabled).toBe(false);
  });
  it("ignores a second Save activation while the first write is pending", async () => {
    const gate = deferred<void>();
    const updateSubscription = vi.fn(() => gate.promise);
    const modal = openModal({ updateSubscription });
    const save = findButton(modal.contentEl, "Save");
    save.click();
    // dispatchEvent invokes the listener even while the button is disabled.
    save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(updateSubscription).toHaveBeenCalledOnce();
    gate.reject(new Error("disk full"));
    await vi.waitFor(() => expect(Notice.messages).toContain("disk full"));
    expect(save.disabled).toBe(false);
  });
  it("keeps the draft editable while an icon refresh runs and refuses to close", async () => {
    const gate = deferred<boolean>();
    const modal = openModal({ refreshIcon: vi.fn(() => gate.promise) });
    findButton(modal.contentEl, "Refresh icon").click();
    const name = findSetting(modal.contentEl, "Name").texts[0].inputEl;
    expect(name.disabled).toBe(false);
    expect(findButton(modal.contentEl, "Save").disabled).toBe(true);
    modal.close();
    expect(Notice.messages).toContain("An operation is still in progress. Please wait before closing.");
    expect(modal.contentEl.isConnected).toBe(true);
    gate.resolve(false);
    await vi.waitFor(() => expect(findButton(modal.contentEl, "Save").disabled).toBe(false));
    expect(name.disabled).toBe(false);
    expect(modal.contentEl.textContent).toContain("Could not load the website icon. Try again.");
    modal.close();
    expect(modal.contentEl.isConnected).toBe(false);
  });
  it("does not validate a partially typed URL before the first Save", () => {
    const modal = openModal();
    const url = findSetting(modal.contentEl, "Service URL").texts[0].inputEl;
    changeInput(url, "https://");
    expect(url.getAttribute("aria-invalid")).not.toBe("true");
  });
  it("keeps a successful refresh result visible even if the provider changes while pending", async () => {
    const gate = deferred<boolean>();
    let provider: "google-s2" | "none" = "google-s2";
    const modal = new EditSubscriptionModal(new App() as unknown as ObsidianApp,
      { refreshIcon: () => gate.promise, readSnapshot: async () => ({ data: { subscriptions: [item] } }) } as unknown as SubscriptionStore,
      new BuiltinCurrencyRegistry(), item, { iconService: { getCachedIcon: () => null }, getProvider: () => provider });
    modal.open(); findButton(modal.contentEl, "Refresh icon").click();
    provider = "none"; gate.resolve(true);
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain("Icon refreshed"));
    const status = modal.contentEl.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.hidden).toBe(false); expect(status.parentElement!.hidden).toBe(false);
  });
  it("reports refreshed cache separately from failure to read the updated snapshot", async () => {
    const modal = openModal({ refreshIcon: vi.fn().mockResolvedValue(true), readSnapshot: vi.fn().mockRejectedValue(new Error("read failed")) });
    findButton(modal.contentEl, "Refresh icon").click();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain("Icon refreshed, but the preview could not be updated. Reopen this form to see it."));
  });
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
    await vi.waitFor(() => expect(updateSubscription).toHaveBeenCalledWith("spotify", expect.objectContaining({ status: "disabled" })));
    expect(setSubscriptionEnabled).not.toHaveBeenCalled();
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
  it("retains the preview DOM while sequential URL edits keep the displayed icon", () => {
    const key = "google-s2:spotify.com";
    const cachedIcon = (dataUrl: string): CachedIcon => ({
      cacheKey: key, sourceUrl: "https://spotify.com/favicon.ico", serviceDomain: "spotify.com",
      dataUrl, contentType: "image/png", fetchedOn: "2026-06-01",
    });
    const cache: Record<string, CachedIcon> = { [key]: cachedIcon("data:image/png;base64,AAAA") };
    const saved = sub({ id: "spotify", name: "Spotify", serviceUrl: "https://spotify.com/",
      price: { amountMinor: 999, currencyCode: "USD" }, icon: { mode: "auto", cacheKey: key } });
    const modal = new EditSubscriptionModal(new App() as unknown as ObsidianApp,
      { readSnapshot: async () => ({ data: { subscriptions: [saved] } }) } as unknown as SubscriptionStore,
      new BuiltinCurrencyRegistry(), saved,
      { iconService: { getCachedIcon: (item) => cache[item.icon.cacheKey ?? ""] ?? null }, getProvider: () => "google-s2" });
    modal.open();
    const preview = modal.contentEl.querySelector('[aria-label="Icon preview"]')!;
    const url = findSetting(modal.contentEl, "Service URL").texts[0].inputEl;
    expect(preview.querySelector("img")).not.toBeNull();
    url.focus();
    const withIcon = preview.firstElementChild!;
    changeInput(url, "https://spotify.com/extra");
    // The edited URL no longer matches the saved icon, so the preview rebuilds once.
    const afterEdit = preview.firstElementChild!;
    expect(afterEdit).not.toBe(withIcon);
    expect(preview.querySelector("img")).toBeNull();
    changeInput(url, "https://spotify.com/extra/longer");
    expect(preview.firstElementChild).toBe(afterEdit);
    expect(document.activeElement).toBe(url);
    // Restoring the saved URL brings the cached icon preview back.
    changeInput(url, "https://spotify.com/");
    expect(preview.querySelector("img")).not.toBeNull();
  });
  it("updates the preview when a refresh replaces the cached icon under the same key", async () => {
    const key = "google-s2:spotify.com";
    const cachedIcon = (dataUrl: string): CachedIcon => ({
      cacheKey: key, sourceUrl: "https://spotify.com/favicon.ico", serviceDomain: "spotify.com",
      dataUrl, contentType: "image/png", fetchedOn: "2026-06-01",
    });
    const cache: Record<string, CachedIcon> = { [key]: cachedIcon("data:image/png;base64,AAAA") };
    const saved = sub({ id: "spotify", name: "Spotify", serviceUrl: "https://spotify.com/",
      price: { amountMinor: 999, currencyCode: "USD" }, icon: { mode: "auto", cacheKey: key } });
    const gate = deferred<boolean>();
    const modal = new EditSubscriptionModal(new App() as unknown as ObsidianApp,
      { refreshIcon: () => gate.promise, readSnapshot: async () => ({ data: { subscriptions: [saved] } }) } as unknown as SubscriptionStore,
      new BuiltinCurrencyRegistry(), saved,
      { iconService: { getCachedIcon: (item) => cache[item.icon.cacheKey ?? ""] ?? null }, getProvider: () => "google-s2" });
    modal.open();
    const img = () => modal.contentEl.querySelector('[aria-label="Icon preview"] img')!;
    expect(img().getAttribute("src")).toContain("AAAA");
    findButton(modal.contentEl, "Refresh icon").click();
    cache[key] = cachedIcon("data:image/png;base64,BBBBBB");
    gate.resolve(true);
    await vi.waitFor(() => expect(img().getAttribute("src")).toContain("BBBB"));
    expect(modal.contentEl.textContent).toContain("Icon refreshed");
  });
  it("propagates a provider change to the hint without rebuilding the preview", () => {
    let provider: "google-s2" | "none" = "google-s2";
    const modal = new EditSubscriptionModal(new App() as unknown as ObsidianApp,
      { readSnapshot: async () => ({ data: { subscriptions: [item] } }) } as unknown as SubscriptionStore,
      new BuiltinCurrencyRegistry(), item,
      { iconService: { getCachedIcon: () => null }, getProvider: () => provider });
    modal.open();
    const preview = modal.contentEl.querySelector('[aria-label="Icon preview"]')!;
    const child = preview.firstElementChild!;
    provider = "none";
    changeInput(findSetting(modal.contentEl, "Service URL").texts[0].inputEl, "https://spotify.com/x");
    expect(modal.contentEl.textContent).toContain("Website icon downloads are disabled in settings.");
    expect(preview.firstElementChild).toBe(child);
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
