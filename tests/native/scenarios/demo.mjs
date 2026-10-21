// Acceptance demonstrations, opt-in via runner flags. Both exercise the real dialogs
// and the same assertions the production scenarios use — they are not report-status
// self-tests:
//  - demo-injected-failure: injects a bounded test-only UI defect (the conditional
//    emoji field stays hidden after a real mode switch) and shows the standard
//    assertion detect it as Failed. The injection is restored via page cleanup.
//  - demo-unmet-focus: moves focus away from the freshly opened dialog and runs the
//    genuine initial-focus precondition, which must report Blocked.
// Neither creates fixtures; leftover dialogs are closed by the runner's cleanup.

const MODAL = ".modal .subscription-calculator-modal";
const INJECT_DEFECT = `(() => {
    const field = document.querySelector('.modal .subscription-calculator-emoji-field');
    if (!field) return { ok: false, error: 'emoji field not found' };
    field.style.setProperty('display', 'none', 'important');
    return { ok: true };
  })()
`;

export const demoFailure = {
  id: "demo-injected-failure",
  title: "Demonstration: an injected UI defect is detected as Failed",
  async run(ctx, s) {
    const { page, fixtures } = ctx;
    await fixtures.ensureViewOpen();
    await page.locator(".subscription-calculator-add-card").click();
    const modal = page.locator(MODAL);
    await modal.waitFor({ state: "visible" });
    await s.do("Add dialog establishes initial focus on Name", () =>
      fixtures.expectInitialFocus(modal, "Name", "Add dialog")
    );
    await s.do("switch to Emoji mode through the real dropdown", async () => {
      await modal.locator('select[aria-label="Icon"]').selectOption("emoji");
    });
    await s.do("inject a bounded test-only UI defect: emoji field stays hidden", async () => {
      const injected = await page.evaluate(INJECT_DEFECT);
      if (!injected.ok) throw new Error(`injection failed: ${injected.error}`);
      // Registered before the assertion: the defect must be undone even on failure.
      ctx.pageCleanup.push({
        name: "remove injected emoji-field defect",
        run: () =>
          page.evaluate(`(() => {
              const field = document.querySelector('.modal .subscription-calculator-emoji-field');
              field?.style.removeProperty('display');
            })()
          `),
      });
    });
    await s.do("the production assertion detects the defect and reports Failed", async () => {
      // Same assertion s1 runs after a real mode switch.
      s.expect(
        await modal.locator(".subscription-calculator-emoji-field").isVisible(),
        "emoji field must be visible in Emoji mode (injected defect detected)"
      );
    });
  },
};

export const demoBlocked = {
  id: "demo-unmet-focus",
  title: "Demonstration: an unmet focus precondition reports Blocked",
  async run(ctx, s) {
    const { page, fixtures } = ctx;
    await fixtures.ensureViewOpen();
    await page.locator(".subscription-calculator-add-card").click();
    const modal = page.locator(MODAL);
    await modal.waitFor({ state: "visible" });
    await s.do("move focus away from the freshly opened dialog", async () => {
      // Real click on a non-input area; the dialog no longer holds initial focus.
      await page.locator(".modal-title").click();
    });
    await s.do("the genuine initial-focus precondition fails and reports Blocked", () =>
      fixtures.expectInitialFocus(modal, "Name", "Add dialog")
    );
  },
};
