// Scenario 1: Add/Edit dialogs through real UI actions; conditional icon controls,
// retained drafts across mode switches, close without saving unintended edits.
import { readVaultData } from "../lib/probes.mjs";

const MODAL = ".modal .subscription-calculator-modal";

export const scenario = {
  id: "s1-icon-drafts",
  title: "Add/Edit dialogs: conditional icon controls and retained drafts",
  async run(ctx, s) {
    const { page, fixtures } = ctx;
    const name = `SMOKE S1 ${ctx.run.id}`;
    await fixtures.ensureViewOpen();
    const before = await s.do("read baseline subscription count", () => readVaultData(ctx.config));
    const beforeCount = before.data.subscriptions.length;

    // --- Add dialog: conditional icon controls ---
    await page.locator(".subscription-calculator-add-card").click();
    const modal = page.locator(MODAL);
    await modal.waitFor({ state: "visible" });
    await s.do("Add dialog establishes initial focus on Name", () =>
      fixtures.expectInitialFocus(modal, "Name", "Add dialog")
    );
    await s.do("Auto mode hides the emoji field", async () => {
      s.expect((await modal.locator('select[aria-label="Icon"]').inputValue()) === "auto", "icon mode should default to auto");
      s.expect(await modal.locator(".subscription-calculator-emoji-field").isHidden(), "emoji field must be hidden in Auto mode");
    });
    await s.do("service URL draft updates the icon hint", async () => {
      await modal.locator('input[aria-label="Service URL"]').fill(`example.com/${ctx.run.id}`);
      const hint = await modal.locator(".subscription-calculator-icon-field .subscription-calculator-form-hint").textContent();
      s.expect(hint === "The website icon will be loaded when you save.", `unexpected hint: "${hint}"`);
    });
    await s.do("Emoji mode shows the emoji field and accepts a draft", async () => {
      await modal.locator('select[aria-label="Icon"]').selectOption("emoji");
      s.expect(await modal.locator(".subscription-calculator-emoji-field").isVisible(), "emoji field must appear in Emoji mode");
      await modal.locator('input[aria-label="Emoji"]').fill("🎯");
      const hint = await modal.locator(".subscription-calculator-icon-field .subscription-calculator-form-hint").textContent();
      s.expect(hint === "Paste an emoji to use as the subscription icon.", `unexpected hint: "${hint}"`);
    });
    await s.do("Currency mode hides the emoji field", async () => {
      await modal.locator('select[aria-label="Icon"]').selectOption("none");
      s.expect(await modal.locator(".subscription-calculator-emoji-field").isHidden(), "emoji field must hide in Currency mode");
    });
    await s.do("returning to Emoji mode retains the draft", async () => {
      await modal.locator('select[aria-label="Icon"]').selectOption("emoji");
      s.expect((await modal.locator('input[aria-label="Emoji"]').inputValue()) === "🎯", "emoji draft must be retained");
    });

    // --- Close without saving unintended edits ---
    await s.do("typing a name and price makes the dialog dirty", async () => {
      await modal.locator('input[aria-label="Name"]').fill(name);
      await modal.locator('input[aria-label="Price"]').fill("3.50");
    });
    await s.do("Cancel asks before discarding and discards", async () => {
      await modal.getByRole("button", { name: "Cancel", exact: true }).click();
      const confirm = page.locator(".modal").filter({ hasText: "Discard changes?" });
      await confirm.waitFor({ state: "visible" });
      await confirm.getByRole("button", { name: "Discard changes", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
    });
    await s.do("discarded dialog leaves subscription count unchanged", async () => {
      const after = await readVaultData(ctx.config);
      s.expect(after.data.subscriptions.length === beforeCount, `subscriptions changed: ${beforeCount} -> ${after.data.subscriptions.length}`);
      s.expect(!after.data.subscriptions.some((item) => item.name === name), "discarded draft must not persist");
    });

    // --- Edit dialog on a suite-owned fixture ---
    await fixtures.addSubscription({ name, price: "3.50" });
    const card = fixtures.cardLocator(name);
    await s.do("fixture card is visible", async () => {
      await card.waitFor({ state: "visible" });
    });
    await card.locator('[aria-label="Edit subscription"]').click();
    const editModal = page.locator(MODAL);
    await editModal.waitFor({ state: "visible" });
    await s.do("Edit dialog establishes initial focus on Name", () =>
      fixtures.expectInitialFocus(editModal, "Name", "Edit dialog")
    );
    await s.do("Edit dialog loads saved values", async () => {
      s.expect((await editModal.locator('input[aria-label="Name"]').inputValue()) === name, "name should be pre-filled");
      s.expect((await editModal.locator('select[aria-label="Icon"]').inputValue()) === "auto", "icon mode should be auto");
    });
    await s.do("Edit dialog: emoji draft retained across mode switches", async () => {
      await editModal.locator('select[aria-label="Icon"]').selectOption("emoji");
      await editModal.locator('input[aria-label="Emoji"]').fill("✅");
      await editModal.locator('select[aria-label="Icon"]').selectOption("none");
      await editModal.locator('select[aria-label="Icon"]').selectOption("emoji");
      s.expect((await editModal.locator('input[aria-label="Emoji"]').inputValue()) === "✅", "emoji draft must be retained in Edit");
    });
    await s.do("Edit Cancel with a dirty name discards", async () => {
      await editModal.locator('input[aria-label="Name"]').fill(`${name} edited`);
      await editModal.getByRole("button", { name: "Cancel", exact: true }).click();
      const confirm = page.locator(".modal").filter({ hasText: "Discard changes?" });
      await confirm.waitFor({ state: "visible" });
      await confirm.getByRole("button", { name: "Discard changes", exact: true }).click();
      await editModal.waitFor({ state: "hidden" });
    });
    await s.do("fixture keeps its saved values after discarded edit", async () => {
      const after = await readVaultData(ctx.config);
      const record = after.data.subscriptions.find((item) => item.name === name);
      s.expect(!!record, "fixture must still exist");
      s.expect(record.icon.mode === "auto", `icon mode changed: ${record.icon.mode}`);
      s.expect(!record.icon.emoji, "emoji must not persist after discard");
    });
    await ctx.screenshot("s1-final-view");
  },
};
