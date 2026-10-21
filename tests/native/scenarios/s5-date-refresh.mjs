// Scenario 5: returning to the view after a date change must refresh countdowns
// without writing data. Controlled test-time injection uses a minimal, reversible
// Date-only shim installed over CDP (the view reads the day via `new Date()` and the
// timers keep running normally); production code and the bundle stay untouched,
// and the shim is restored and verified in cleanup — repeat-safe across runs. The
// view re-render is triggered through real UI leaf switching and the plugin's own
// ribbon control, and the no-write claim
// is observed two ways: the save-gate call count and unchanged data.json bytes.
import { setTimeout as sleep } from "node:timers/promises";
import { installFixedDate, restoreRealDate } from "../lib/inject.mjs";
import { readVaultData } from "../lib/probes.mjs";

function localDateOnly(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function tomorrowOf(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

async function switchLeafAwayAndBack(page) {
  // Switch away by activating another real leaf in the main area. The click goes
  // to the leaf's view header, never the content center: main-area empty states
  // place tappable actions (e.g. the quick switcher) exactly at the center, and a
  // center click opens that dialog instead of just activating the leaf.
  const emptyHeader = page.locator(".mod-root .workspace-leaf-content[data-type='empty'] .view-header");
  if (await emptyHeader.isVisible({ timeout: 1500 }).catch(() => false)) {
    await emptyHeader.click();
  } else {
    const firstLeaf = page.locator(".mod-root .workspace-leaf-content").first();
    const header = firstLeaf.locator(".view-header");
    if (await header.isVisible().catch(() => false)) {
      await header.click();
    } else {
      await firstLeaf.click();
    }
  }
  // Return through the plugin's own visible ribbon control: the view sits in a
  // sidebar in this layout, where no view header is displayed, and the command
  // reuses and activates the existing leaf. Then assert the intended active leaf.
  await page.locator('.clickable-icon[aria-label="Open subscriptions"]').click();
  const activeIsView = await page.evaluate(() => {
    const active = document.querySelector(".workspace-leaf.mod-active");
    return !!active && !!active.querySelector(".workspace-leaf-content[data-type='subscription-calculator-view']");
  });
  if (!activeIsView) throw new Error("return did not reactivate the subscriptions view leaf");
}

export const scenario = {
  id: "s5-date-refresh",
  title: "Date change on return refreshes countdowns without spurious writes",
  async run(ctx, s) {
    const { page, fixtures, gate } = ctx;
    const now = new Date();
    const tomorrow = localDateOnly(tomorrowOf(now));
    const name = `SMOKE S5 ${ctx.run.id}`;
    await fixtures.ensureViewOpen();
    await fixtures.addSubscription({ name, price: "1.00", period: "monthly", startDate: tomorrow });
    const before = await readVaultData(ctx.config);
    await gate.install("pass");

    const countdown = () => fixtures.cardLocator(name).locator(".subscription-calculator-next-payment");
    await s.do("countdown shows tomorrow under the real clock", async () => {
      await countdown().waitFor({ state: "visible" });
      const text = (await countdown().textContent())?.trim();
      s.expect(text === "tomorrow", `expected "tomorrow" for a start date of ${tomorrow}, got "${text}"`);
    });
    await s.do("inject the controlled test date (reversible Date-only shim)", async () => {
      // Installed just past local midnight of the next day; the runner restores and
      // verifies the original Date identity in cleanup, before any other fixture work.
      ctx.dateInjectionUsed = true;
      const injected = tomorrowOf(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 1, 0));
      const installed = await installFixedDate(page, injected.getTime());
      if (!installed.ok) {
        ctx.dateInjectionUsed = false;
        s.block(`Date injection unavailable: ${installed.error}`);
      }
    });
    await s.do("switch away from the view and return (real controls)", () => switchLeafAwayAndBack(page));
    await s.do("countdown refreshed to today on the fresh render", async () => {
      for (let i = 0; i < 20; i++) {
        const text = (await countdown().textContent().catch(() => null))?.trim();
        if (text === "today") break;
        await sleep(150);
      }
      const text = (await countdown().textContent().catch(() => null))?.trim();
      s.expect(text === "today", `countdown should read "today" after the date change, got "${text}"`);
    });
    await s.do("date refresh performed no data write", async () => {
      const calls = await gate.calls();
      s.expect(calls === 0, `date refresh must not save (save-gate calls: ${calls})`);
      const after = await readVaultData(ctx.config);
      s.expect(after.hash === before.hash, "data.json bytes must be unchanged by the date refresh");
    });
    await ctx.screenshot("s5-refreshed-countdown");
    await s.do("restore the real Date and re-render", async () => {
      const restored = await restoreRealDate(page);
      s.expect(restored.ok, `Date restore failed: ${restored.error ?? "unknown error"}`);
      ctx.dateInjectionUsed = false;
      await switchLeafAwayAndBack(page);
      for (let i = 0; i < 20; i++) {
        const text = (await countdown().textContent().catch(() => null))?.trim();
        if (text === "tomorrow") break;
        await sleep(150);
      }
      const text = (await countdown().textContent().catch(() => null))?.trim();
      s.expect(text === "tomorrow", `countdown should return to "tomorrow" under the real Date, got "${text}"`);
    });
  },
};
