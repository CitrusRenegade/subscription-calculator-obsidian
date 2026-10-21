// Scenario 3: save a custom currency through the real settings UI while the Symbol
// field holds a draft and an active selection. Establishes the initial focus and
// selection first, then verifies the pending-save freeze semantics (fields and
// action buttons freeze, newer typing is dropped by the frozen dialog, draft and
// selection survive), and that releasing the save persists the currency exactly
// once and closes the dialog. Reopening the editor then shows the saved values,
// editability and its own initial focus. Focus continuity is not claimed across
// the disabled/closed modal boundary: freezing a focused input moves focus, and a
// successful save closes the dialog.
import { readVaultData, waitForVaultData } from "../lib/probes.mjs";

const MODAL = ".modal .subscription-calculator-modal";

export const scenario = {
  id: "s3-currency-save-focus",
  title: "Custom currency save freezes the dialog, persists once, and reopens editable",
  async run(ctx, s) {
    const { fixtures, gate } = ctx;
    const label = "SMOKE3";
    const marker = "st";

    const existing = await s.do("check the fixture label is free", () => readVaultData(ctx.config));
    if (existing.data.customCurrencies.some((currency) => currency.label === label)) {
      s.block(`fixture currency "${label}" already exists; a previous cleanup did not complete`);
    }
    // Register the fixture intent before the save: cleanup tolerates absence.
    fixtures.createdCurrencies.push({ label, displayLabel: `${label} ${marker}`, code: null });

    const settingsPage = await fixtures.openSettings();
    await fixtures.openCustomCurrenciesPage(settingsPage);
    await settingsPage.locator('[aria-label="Add currency"]').click();
    const modal = settingsPage.locator(MODAL);
    await modal.waitFor({ state: "visible" });
    await s.do("Add-currency dialog establishes initial focus on Label", () =>
      fixtures.expectInitialFocus(modal, "Currency label", "Add-currency dialog")
    );
    await s.do("label draft typed", async () => {
      await modal.locator('input[aria-label="Currency label"]').fill(label);
      s.expect((await modal.locator('input[aria-label="Currency label"]').inputValue()) === label, "label draft value");
    });
    const symbol = modal.locator('input[aria-label="Symbol"]');
    await s.do("Symbol field focused with draft and active selection", async () => {
      await symbol.click();
      await settingsPage.keyboard.type(marker);
      // Select the last typed character with real keyboard input.
      await settingsPage.keyboard.press("Shift+ArrowLeft");
      s.expect(await symbol.evaluate((el) => document.activeElement === el), "Symbol must hold focus before the save");
      s.expect((await symbol.inputValue()) === marker, "Symbol draft value");
      const selection = await symbol.evaluate((el) => [el.selectionStart, el.selectionEnd]);
      s.expect(selection[0] === 1 && selection[1] === 2, `selection must cover the last character (got ${JSON.stringify(selection)})`);
    });

    await gate.install("hold");
    await s.do("real settings save starts and freezes the dialog", async () => {
      await modal
        .locator(".subscription-calculator-modal-actions")
        .getByRole("button", { name: "Add currency", exact: true })
        .click();
      await gate.waitForCalls(1, 6000);
      const actions = modal.locator(".subscription-calculator-modal-actions");
      s.expect(await modal.locator('input[aria-label="Currency label"]').isDisabled(), "Label must freeze while the save is pending");
      s.expect(await symbol.isDisabled(), "Symbol must freeze while the save is pending");
      s.expect(await actions.getByRole("button", { name: "Add currency", exact: true }).isDisabled(), "Add-currency button must freeze while the save is pending");
      s.expect(await actions.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), "Cancel button must freeze while the save is pending");
    });
    await s.do("newer typing during the pending save is dropped by the frozen dialog", async () => {
      await settingsPage.keyboard.type("X");
      s.expect(
        (await modal.locator('input[aria-label="Currency label"]').inputValue()) === label,
        "frozen Label must not accept newer typing while pending"
      );
      s.expect((await symbol.inputValue()) === marker, "frozen Symbol must keep its draft");
    });
    await s.do("draft and selection survive the pending settings update", async () => {
      const selection = await symbol.evaluate((el) => [el.selectionStart, el.selectionEnd]);
      s.expect((await symbol.inputValue()) === marker, "Symbol draft must survive the pending window");
      s.expect(selection[0] === 1 && selection[1] === 2, `selection must survive the pending window (got ${JSON.stringify(selection)})`);
      const focus = await symbol.evaluate((el) => ({
        active: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName,
        symbolHasFocus: document.activeElement === el,
      }));
      await ctx.screenshot("s3-pending-save");
      // Freezing a focused input moves focus (native disabled behavior); the
      // meaningful editable-focus assertion happens on the editor after the update.
      return `focus during pending save on: ${focus.active} (symbol focused: ${focus.symbolHasFocus})`;
    });
    await s.do("released save closes the dialog and persists the currency once", async () => {
      await gate.releaseAll();
      await gate.awaitSettlement();
      await modal.waitFor({ state: "hidden", timeout: 8000 });
      const saved = await waitForVaultData(
        ctx.config,
        (data) => data.customCurrencies.some((currency) => currency.label === label),
        8000,
        `persisted custom currency "${label}"`
      );
      const records = saved.data.customCurrencies.filter((currency) => currency.label === label);
      s.expect(records.length === 1, `currency must persist exactly once (got ${records.length})`);
      s.expect(records[0].amountMarker === marker, `marker should persist as "${marker}" (got ${records[0].amountMarker})`);
    });
    await s.do(
      "reopened editor is editable, holds saved values and establishes its own initial focus",
      async () => {
        const row = fixtures.currencyRow(settingsPage, `${label} ${marker}`);
        await row.first().waitFor({ state: "visible", timeout: 8000 });
        await row.first().click();
        const editor = settingsPage.locator(MODAL);
        await editor.waitFor({ state: "visible", timeout: 8000 });
        const labelInput = editor.locator('input[aria-label="Currency label"]');
        const symbolInput = editor.locator('input[aria-label="Symbol"]');
        s.expect(await labelInput.isEnabled(), "reopened editor Label must be editable after the settings update");
        s.expect(await symbolInput.isEnabled(), "reopened editor Symbol must be editable after the settings update");
        s.expect((await labelInput.inputValue()) === label, "reopened editor must hold the saved label");
        s.expect((await symbolInput.inputValue()) === marker, "reopened editor must hold the saved marker");
        await fixtures.expectInitialFocus(editor, "Currency label", "Reopened currency editor");
        await editor
          .locator(".subscription-calculator-modal-actions")
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        await editor.waitFor({ state: "hidden", timeout: 8000 });
      }
    );
  },
};
