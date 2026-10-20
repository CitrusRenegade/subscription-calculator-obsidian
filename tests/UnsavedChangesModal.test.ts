// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App as ObsidianApp } from "obsidian";
import { UnsavedChangesModal } from "../src/ui/components/UnsavedChangesModal";
import { App, Modal, Notice, Scope, findButton, resetObsidianDom } from "./helpers/obsidianDom";
vi.mock("obsidian", () => import("./helpers/obsidianDom"));
class Form extends UnsavedChangesModal {
  saving = false;
  protected isSaving(): boolean { return this.saving; }
  onOpen(): void {
    this.contentEl.createEl("input", { attr: { value: "Original" } });
    this.contentEl.createEl("input", { attr: { type: "checkbox" } });
    this.captureInitialValues();
  }
  saved(): void { this.closeAfterSave(); }
}
function open() { const form = new Form(new App() as unknown as ObsidianApp); form.open(); return form; }
describe("UnsavedChangesModal", () => {
  beforeEach(resetObsidianDom);
  it("Escape in the confirmation keeps the draft and restores focus", () => {
    const register = vi.spyOn(Scope.prototype, "register");
    try {
      const form = open(); const input = form.contentEl.querySelector("input")!;
      input.value = "Draft"; input.focus(); form.close();
      const escape = register.mock.calls.find((call) => call[1] === "Escape")![2];
      escape(new KeyboardEvent("keydown", { key: "Escape", repeat: true }));
      expect(document.querySelector(".subscription-calculator-discard-actions")).not.toBeNull();
      escape(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(form.contentEl.isConnected).toBe(true);
      expect(input.value).toBe("Draft"); expect(document.activeElement).toBe(input);
      expect(document.querySelector(".subscription-calculator-discard-actions")).toBeNull();
    } finally { register.mockRestore(); }
  });
  it("closes an unchanged form, including edits reverted to the initial value", () => {
    const form = open(); const input = form.contentEl.querySelector("input")!;
    input.value = "Changed"; input.value = "Original"; form.close();
    expect(form.contentEl.isConnected).toBe(false);
  });
  it("keeps a dirty draft and focus after Keep editing, then discards explicitly", () => {
    const form = open(); const input = form.contentEl.querySelector("input")!;
    input.value = "Draft"; input.focus(); form.close(); form.close();
    expect(document.querySelectorAll(".subscription-calculator-discard-actions")).toHaveLength(1);
    findButton(document.body, "Keep editing").click();
    expect(input.value).toBe("Draft"); expect(document.activeElement).toBe(input);
    form.close(); findButton(document.body, "Discard changes").click();
    expect(form.contentEl.isConnected).toBe(false);
  });
  it("detects checkbox changes as unsaved changes", () => {
    const form = open(); form.contentEl.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = true;
    form.close(); expect(form.contentEl.isConnected).toBe(true);
    expect(findButton(document.body, "Keep editing")).toBeTruthy();
  });
  it("blocks dismissal during saving and closes after successful save without prompting", () => {
    const form = open(); form.contentEl.querySelector("input")!.value = "Draft";
    form.saving = true; form.close();
    expect(Notice.messages).toContain("An operation is still in progress. Please wait before closing.");
    expect(form.contentEl.isConnected).toBe(true);
    expect(document.querySelector(".subscription-calculator-discard-actions")).toBeNull();
    form.saved(); expect(form.contentEl.isConnected).toBe(false);
  });
  it("force-closes a dirty or saving form when the host window is destroyed", () => {
    const form = open(); form.contentEl.querySelector("input")!.value = "Draft";
    form.saving = true; form.close();
    expect(form.contentEl.isConnected).toBe(true);
    expect(document.querySelector(".subscription-calculator-discard-actions")).toBeNull();
    form.forceCloseOnWindowTeardown();
    expect(form.contentEl.isConnected).toBe(false);
  });
  it("skips a pending discard confirmation during window teardown", () => {
    const form = open(); form.contentEl.querySelector("input")!.value = "Draft";
    form.close();
    expect(document.querySelector(".subscription-calculator-discard-actions")).not.toBeNull();
    form.forceCloseOnWindowTeardown();
    expect(form.contentEl.isConnected).toBe(false);
    expect(document.querySelector(".subscription-calculator-discard-actions")).toBeNull();
  });
  it("permits retrying dismissal after the confirmation fails to open", () => {
    const form = open(); form.contentEl.querySelector("input")!.value = "Draft";
    const opening = vi.spyOn(Modal.prototype, "open").mockImplementationOnce(() => { throw new Error("open failed"); });
    try {
      form.close();
      expect(Notice.messages).toContain("Could not open the confirmation. Please try again.");
      form.close();
      expect(opening).toHaveBeenCalledTimes(2);
      findButton(document.body, "Discard changes").click();
      expect(form.contentEl.isConnected).toBe(false);
    } finally { opening.mockRestore(); }
  });
  it("ignores native dropdown measuring copies when checking for changes", () => {
    const form = open();
    form.contentEl.createEl("select", { cls: "is-measuring" }).createEl("option", { text: "Temporary measurement" });
    form.close(); expect(form.contentEl.isConnected).toBe(false);
  });
  it("closes without consulting the draft when its document has lost its window", () => {
    const form = open(); form.contentEl.querySelector("input")!.value = "Draft";
    const owner = vi.spyOn(document, "defaultView", "get").mockReturnValue(null);
    try { form.close(); expect(form.contentEl.isConnected).toBe(false); }
    finally { owner.mockRestore(); }
  });
  it("rate-limits the in-progress notice while saving", () => {
    const form = open(); form.contentEl.querySelector("input")!.value = "Draft";
    form.saving = true;
    const before = Notice.messages.length;
    for (let step = 0; step < 5; step += 1) form.close();
    expect(Notice.messages.slice(before)).toHaveLength(1);
  });
});
