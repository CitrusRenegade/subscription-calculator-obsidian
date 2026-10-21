// Scenario 2: save one card while another price editor holds a draft; the draft and
// focus survive the view refresh on a fresh node, then clicking away commits exactly
// once. Determinism comes from the suite-owned save gate (test-only runtime injection).
import { readVaultData, waitForVaultData } from "../lib/probes.mjs";

const PRICE_INPUT = "input.subscription-calculator-money-input";
const PRICE_DISPLAY = "button.subscription-calculator-money-display";
const oldNodeDetached = () => window.__smokeOldDraftNode && !window.__smokeOldDraftNode.isConnected;

export const scenario = {
  id: "s2-sibling-price-draft",
  title: "Sibling price draft and focus survive a card save; commits fire exactly once",
  async run(ctx, s) {
    const { page, fixtures, gate } = ctx;
    const nameA = `SMOKE S2 A ${ctx.run.id}`;
    const nameB = `SMOKE S2 B ${ctx.run.id}`;
    await fixtures.ensureViewOpen();
    const createdA = await fixtures.addSubscription({ name: nameA, price: "5.00" });
    const createdB = await fixtures.addSubscription({ name: nameB, price: "7.00" });
    const baseline = await readVaultData(ctx.config);
    const idA = createdA.id ?? baseline.data.subscriptions.find((item) => item.name === nameA).id;
    const idB = createdB.id ?? baseline.data.subscriptions.find((item) => item.name === nameB).id;

    await gate.install("hold");
    const cardA = () => fixtures.cardLocator(nameA);
    const cardB = () => fixtures.cardLocator(nameB);

    await s.do("card A price editor opens focused", async () => {
      await cardA().locator(PRICE_DISPLAY).click();
      const input = cardA().locator(PRICE_INPUT);
      await input.waitFor({ state: "visible" });
      s.expect(await input.evaluate((el) => document.activeElement === el), "price editor for A must take focus");
    });
    // Committing by clicking away is the same blur-commit path Enter drives; CDP
    // cannot deliver Enter keydowns to number inputs in this Chromium build (see
    // tests/README.md), and clicking the sibling is the next real user action anyway.
    await s.do("typing a new price into A and clicking B commits A once", async () => {
      await page.keyboard.type("13.5");
      await cardB().locator(PRICE_DISPLAY).click();
      await gate.waitForCalls(1, 6000);
      const inputB = cardB().locator(PRICE_INPUT);
      await inputB.waitFor({ state: "visible" });
      s.expect(await inputB.evaluate((el) => document.activeElement === el), "price editor for B must take focus");
      s.expect(await cardA().locator(PRICE_INPUT).isHidden(), "A editor must close when B opens");
    });
    await s.do("draft typed into B's open editor", async () => {
      await page.keyboard.type("123.45");
      s.expect((await cardB().locator(PRICE_INPUT).inputValue()) === "123.45", "B draft value must be 123.45");
    });
    await s.do("release the save and let the view refresh", async () => {
      // Registered before use so the page-global marker is removed even on failure.
      ctx.pageCleanup.push({
        name: "clear old-node marker",
        run: () => page.evaluate("(() => { delete window.__smokeOldDraftNode; })()"),
      });
      await cardB()
        .locator(PRICE_INPUT)
        .evaluate((el) => {
          window.__smokeOldDraftNode = el;
        });
      await gate.releaseAll();
      await page.waitForFunction(oldNodeDetached, null, { timeout: 8000 });
      const freshInput = cardB().locator(PRICE_INPUT);
      await freshInput.waitFor({ state: "visible", timeout: 8000 });
      s.expect((await freshInput.inputValue()) === "123.45", "B draft must survive the refresh");
      s.expect(await freshInput.evaluate((el) => document.activeElement === el), "B editor must be focused after refresh");
      s.expect(await freshInput.evaluate((el) => el !== window.__smokeOldDraftNode), "assertion must target the fresh node");
      s.expect(await cardB().locator(PRICE_DISPLAY).isHidden(), "B display must stay hidden while its editor is open");
      s.expect(await cardA().locator(PRICE_INPUT).isHidden(), "A editor must stay closed after its save");
    });
    await s.do("A's save persisted; B's draft did not", async () => {
      const after = await waitForVaultData(
        ctx.config,
        (current) => current.subscriptions.find((item) => item.id === idA)?.price.amountMinor === 1350,
        8000,
        "A's committed price 13.50"
      );
      const recordB = after.data.subscriptions.find((item) => item.id === idB);
      s.expect(recordB?.price.amountMinor === 700, `B draft must not persist while uncommitted (got ${recordB?.price.amountMinor})`);
    });
    await s.do("clicking away commits B's draft exactly once", async () => {
      await cardA().locator(".subscription-calculator-card-name").click();
      await gate.waitForCalls(2, 6000);
      const display = cardB().locator(PRICE_DISPLAY);
      await display.waitFor({ state: "visible", timeout: 8000 });
      s.expect(
        (await display.getAttribute("aria-label")).includes("123.45"),
        `B display should show the committed draft (got "${await display.getAttribute("aria-label")}")`
      );
      await waitForVaultData(
        ctx.config,
        (current) => current.subscriptions.find((item) => item.id === idB)?.price.amountMinor === 12345,
        8000,
        "B's committed draft 123.45"
      );
      const calls = await gate.calls();
      s.expect(calls === 2, `expected exactly two saves for the scenario, got ${calls}`);
      s.expect(await cardB().locator(PRICE_INPUT).isHidden(), "B editor must close after committing");
    });
    await ctx.screenshot("s2-final-view");
  },
};
