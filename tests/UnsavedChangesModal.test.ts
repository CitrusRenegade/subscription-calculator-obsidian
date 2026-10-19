// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App as ObsidianApp } from "obsidian";
import { UnsavedChangesModal } from "../src/ui/components/UnsavedChangesModal";
import { App, findButton, resetObsidianDom } from "./helpers/obsidianDom";
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
    expect(form.contentEl.isConnected).toBe(true);
    expect(document.querySelector(".subscription-calculator-discard-actions")).toBeNull();
    form.saved(); expect(form.contentEl.isConnected).toBe(false);
  });
});
