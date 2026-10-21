// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App as ObsidianApp } from "obsidian";
import { CustomCurrencyModal } from "../src/settings/CustomCurrencyModal";
import type { CurrencyMeta } from "../src/types";
import { App, Modal, changeInput, changeSelect, findButton, resetObsidianDom } from "./helpers/obsidianDom";
import { deferred } from "./helpers/deferred";
import { openModalInDocument } from "../src/ui/components/openModalInDocument";
vi.mock("obsidian", () => import("./helpers/obsidianDom"));
const token: CurrencyMeta = { code: "TOK", label: "TOK", amountMarker: "🪙", scale: 2, source: "custom" };
function setup(currency?: CurrencyMeta, used = false, routed = false) {
  const store = { addCustomCurrency: vi.fn().mockResolvedValue(undefined), updateCustomCurrency: vi.fn().mockResolvedValue(undefined),
    deleteCustomCurrency: vi.fn().mockResolvedValue(undefined), isCurrencyUsed: vi.fn(() => used) };
  const saved = vi.fn(); const modal = new CustomCurrencyModal(new App() as unknown as ObsidianApp, store, saved, currency);
  if (routed) openModalInDocument(() => modal, document); else modal.open();
  const input = (label: string) => modal.contentEl.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const format = modal.contentEl.querySelector<HTMLSelectElement>('select[aria-label="Price format"]')!;
  return { store, saved, modal, input, format };
}
describe("CustomCurrencyModal", () => {
  beforeEach(resetObsidianDom);
  it("shows a fractional example for legacy one-decimal currencies", () => {
    const { modal } = setup({ ...token, scale: 1 });
    expect(modal.contentEl.querySelector("output")?.textContent).toBe("19.9 🪙");
    modal.forceCloseOnWindowTeardown();
  });
  it.each([false, true])("closes a pending removal on window teardown even when save fails=%s", async (fails) => {
    const { modal, store } = setup(token, false, true);
    const gate = deferred<void>(); store.deleteCustomCurrency.mockImplementationOnce(() => gate.promise);
    findButton(modal.contentEl, "Delete currency").click();
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find(button => button.textContent === "Delete currency" && !modal.contentEl.contains(button))!;
    confirm.click();
    const closed = vi.spyOn(Modal.prototype, "close");
    window.dispatchEvent(new Event("pagehide"));
    expect(confirm.isConnected).toBe(false);
    if (fails) gate.reject(new Error("disk full")); else gate.resolve();
    await vi.waitFor(() => expect(confirm.disabled).toBe(false));
    expect(closed).toHaveBeenCalledTimes(2); // Editor and confirmation, with no second close after saving.
    closed.mockRestore();
  });
  it("allows deleting an unused archived currency retained by a restored backup", async () => {
    const { modal, store } = setup({ ...token, isArchived: true });
    findButton(modal.contentEl, "Delete currency").click();
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find(button => button.textContent === "Delete currency" && !modal.contentEl.contains(button))!;
    confirm.click();
    await vi.waitFor(() => expect(store.deleteCustomCurrency).toHaveBeenCalledWith("TOK"));
    await vi.waitFor(() => expect(modal.contentEl.isConnected).toBe(false));
  });
  it("previews label, symbol, fallback and price format without saving", () => {
    const { modal, input, format, store } = setup();
    changeInput(input("Currency label"), "pts"); changeSelect(format, "0");
    expect(modal.contentEl.querySelector("output")?.textContent).toBe("19 PTS");
    changeInput(input("Symbol"), "✨");
    expect(modal.contentEl.querySelector("output")?.textContent).toBe("19 ✨");
    expect(store.addCustomCurrency).not.toHaveBeenCalled();
  });
  it("validates label and symbol inline, then creates through Add currency", async () => {
    const { modal, input, store, saved } = setup();
    findButton(modal.contentEl, "Add currency").click();
    expect(input("Currency label").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input("Currency label"));
    changeInput(input("Currency label"), "BONUS"); changeInput(input("Symbol"), "1234567");
    findButton(modal.contentEl, "Add currency").click(); expect(store.addCustomCurrency).not.toHaveBeenCalled();
    expect(input("Symbol").getAttribute("aria-invalid")).toBe("true");
    changeInput(input("Symbol"), "✨"); findButton(modal.contentEl, "Add currency").click();
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(store.addCustomCurrency).toHaveBeenCalledWith({ label: "BONUS", amountMarker: "✨", scale: 2 });
    expect(modal.contentEl.isConnected).toBe(false);
  });
  it("retains a failed save, blocks duplicate submissions and freezes fields while pending", async () => {
    const { modal, input, store } = setup(token); const gate = deferred<void>();
    store.updateCustomCurrency.mockImplementationOnce(() => gate.promise);
    changeInput(input("Currency label"), "NEW"); const save = findButton(modal.contentEl, "Save"); save.click(); save.click();
    expect(store.updateCustomCurrency).toHaveBeenCalledOnce(); expect(input("Currency label").disabled).toBe(true);
    modal.close(); expect(modal.contentEl.isConnected).toBe(true);
    gate.reject(new Error("Currency display already exists."));
    await vi.waitFor(() => expect(save.disabled).toBe(false));
    expect(input("Currency label").value).toBe("NEW"); expect(modal.contentEl.textContent).toContain("Currency display already exists.");
    save.click(); await vi.waitFor(() => expect(modal.contentEl.isConnected).toBe(false));
  });
  it("restores a failed save while keeping the used-currency format lock", async () => {
    const { modal, input, store, format } = setup(token, true); const gate = deferred<void>();
    store.updateCustomCurrency.mockImplementationOnce(() => gate.promise);
    changeInput(input("Currency label"), "EDIT");
    const save = findButton(modal.contentEl, "Save"); save.click();
    expect(input("Currency label").disabled).toBe(true);
    expect(format.disabled).toBe(true);
    gate.reject(new Error("disk full"));
    await vi.waitFor(() => expect(input("Currency label").disabled).toBe(false));
    expect(save.disabled).toBe(false);
    // Initially locked because the currency is used; failure restores that exact state.
    expect(format.disabled).toBe(true);
    expect(modal.contentEl.textContent).toContain("disk full");
  });
  it("preserves legacy precision and locks it for used currencies", async () => {
    const { modal, format, store } = setup({ ...token, scale: 3 }, true);
    expect(format.value).toBe("3"); expect(format.disabled).toBe(true);
    expect(modal.contentEl.querySelector("output")?.textContent).toBe("19.990 🪙");
    findButton(modal.contentEl, "Save").click();
    await vi.waitFor(() => expect(store.updateCustomCurrency).toHaveBeenCalledWith("TOK", expect.objectContaining({ scale: 3 })));
  });
  it("asks before discarding edits and never persists on Cancel", () => {
    const { modal, input, store } = setup(token); changeInput(input("Currency label"), "NEW");
    findButton(modal.contentEl, "Cancel").click(); findButton(document.body, "Keep editing").click();
    expect(input("Currency label").value).toBe("NEW");
    findButton(modal.contentEl, "Cancel").click(); findButton(document.body, "Discard changes").click();
    expect(modal.contentEl.isConnected).toBe(false); expect(store.updateCustomCurrency).not.toHaveBeenCalled();
  });
  it.each([false, true])("confirms removal with the correct semantics when used=%s", async (used) => {
    const { modal, store, saved } = setup(token, used); const name = used ? "Archive currency" : "Delete currency";
    findButton(modal.contentEl, name).click(); expect(store.deleteCustomCurrency).not.toHaveBeenCalled();
    const confirmation = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === name && !modal.contentEl.contains(b))!;
    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === "Cancel" && !modal.contentEl.contains(b))!;
    cancel.click(); expect(store.deleteCustomCurrency).not.toHaveBeenCalled();
    findButton(modal.contentEl, name).click();
    const next = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === name && !modal.contentEl.contains(b))!;
    expect(confirmation.isConnected).toBe(false); next.click();
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce()); expect(store.deleteCustomCurrency).toHaveBeenCalledWith("TOK");
    expect(modal.contentEl.isConnected).toBe(false);
  });
  it("keeps the editor on removal failure and permits retry without duplicate writes", async () => {
    const { modal, input, store, saved } = setup(token);
    const gate = deferred<void>(); store.deleteCustomCurrency.mockImplementationOnce(() => gate.promise);
    changeInput(input("Currency label"), "DRAFT");
    findButton(modal.contentEl, "Delete currency").click();
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === "Delete currency" && !modal.contentEl.contains(b))!;
    confirm.click(); confirm.click(); expect(store.deleteCustomCurrency).toHaveBeenCalledOnce();
    expect(input("Currency label").disabled).toBe(true);
    gate.reject(new Error("disk full"));
    await vi.waitFor(() => expect(confirm.disabled).toBe(false));
    expect(document.body.textContent).toContain("disk full"); expect(input("Currency label").value).toBe("DRAFT");
    expect(saved).not.toHaveBeenCalled(); confirm.click();
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(modal.contentEl.isConnected).toBe(false);
  });
});
