// Scenario 6: narrow/wide view geometry with the floating yearly summary at the
// bottom position: visibility invariant against the static summary sentinel, no
// summary text under the status bar, controls stay usable, and reserved space tracks the
// real panel height. Measurements are renderer evidence; screenshots are recorded
// for human review and are not a blanket pass for every theme.
import { setTimeout as sleep } from "node:timers/promises";
import { readVaultData } from "../lib/probes.mjs";

const geometryProbe = (position) => {
    const view = document.querySelector('.view-content.subscription-calculator-view');
    const panel = document.querySelector('.subscription-calculator-summary-floating');
    if (!view || !panel) return null;
    const staticSummary = view.querySelector('.subscription-calculator-summary:not(.subscription-calculator-summary-floating)');
    const sentinel = staticSummary?.querySelector('.subscription-calculator-summary-values');
    const statusBar = document.querySelector('.status-bar');
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
    };
    const viewRect = rect(view);
    const sentinelRect = sentinel ? rect(sentinel) : null;
    const measurable = sentinelRect !== null && sentinelRect.height > 0 && viewRect.bottom > viewRect.top;
    const expectedVisible = !measurable
      ? false
      : position === 'bottom'
        ? sentinelRect.top > viewRect.bottom
        : sentinelRect.bottom <= viewRect.top;
    return {
      panelVisible: panel.classList.contains('is-visible'),
      expectedVisible,
      panel: rect(panel),
      contentBottom: Math.max(...Array.from(panel.children).map((element) => rect(element).bottom)),
      view: viewRect,
      sentinel: sentinelRect,
      statusBar: statusBar ? rect(statusBar) : null,
      inset: panel.style.getPropertyValue('--subscription-calculator-status-bar-inset') || '0',
      sheetHeight: parseFloat(view.style.getPropertyValue('--subscription-calculator-sheet-height')) || 0,
      viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
  };
};

/** Click the toolbar's Show disabled toggle and wait for the persisted flip. */
async function waitForShowDisabled(config, expected, description) {
  const deadline = Date.now() + 8000;
  let current = await readVaultData(config);
  while (current.data.settings.showDisabled !== expected && Date.now() < deadline) {
    await sleep(150);
    current = await readVaultData(config);
  }
  return current.data.settings.showDisabled === expected;
}

async function cycleShowDisabled(ctx, s) {
  const { page, config, fixtures } = ctx;
  const button = page.locator('.subscription-calculator-toolbar button[data-focus-key="show-disabled"]');
  const original = (await readVaultData(config)).data.settings.showDisabled;
  // Bookkeeping first so a mid-cycle failure still restores via the view toolbar.
  fixtures.settingChanges.push({
    name: "Show disabled (view toolbar)",
    key: "showDisabled",
    from: original,
    to: !original,
    restoreVia: "view-toolbar",
  });
  await s.do("Show disabled control responds", async () => {
    await button.click();
    s.expect(await waitForShowDisabled(config, !original, "flip"), "Show disabled click must flip the persisted setting");
  });
  await s.do("Show disabled control restores its previous state", async () => {
    await button.click();
    s.expect(await waitForShowDisabled(config, original, "restore"), "second click must restore the persisted setting");
    fixtures.settingChanges.pop();
  });
}

async function measureAndAssert(ctx, s, label, position, visible = true) {
  const { page } = ctx;
  await s.do(`${label}: floating summary visibility invariant`, async () => {
    await sleep(400); // let the rAF-driven layout update settle after any resize
    const geometry = await page.evaluate(geometryProbe, position);
    s.expect(geometry !== null, "subscriptions view and floating summary must both exist");
    s.expect(geometry.view.left >= 0 && geometry.view.right <= geometry.viewport.w + 1,
      `view must fit in the viewport: ${JSON.stringify(geometry.view)}, viewport=${geometry.viewport.w}`);
    s.expect(geometry.expectedVisible === visible,
      `fixture must exercise a ${visible ? "visible" : "hidden"} floating panel; sentinel=${JSON.stringify(geometry.sentinel)}`);
    s.expect(geometry.panelVisible === visible, `floating panel must be ${visible ? "visible" : "hidden"}`);
    s.expect(
      geometry.panelVisible === geometry.expectedVisible,
      `panel visible=${geometry.panelVisible} but sentinel geometry expects ${geometry.expectedVisible} ` +
        `(sentinel=${JSON.stringify(geometry.sentinel)}, viewBottom=${geometry.view.bottom})`
    );
    if (geometry.panelVisible && geometry.statusBar &&
        geometry.panel.left < geometry.statusBar.right && geometry.panel.right > geometry.statusBar.left) {
      s.expect(
        geometry.contentBottom <= geometry.statusBar.top + 1.5,
        `summary content bottom (${geometry.contentBottom.toFixed(1)}) overlaps the status bar (top ${geometry.statusBar.top.toFixed(1)}); inset="${geometry.inset}"`
      );
    }
    if (geometry.panelVisible) {
      const slack = geometry.sheetHeight - geometry.panel.height;
      s.expect(
        slack >= -2 && slack <= 8,
        `reserved bottom space should track the panel height (sheet=${geometry.sheetHeight.toFixed(1)}px, panel=${geometry.panel.height.toFixed(1)}px)`
      );
      return `view width ${(geometry.view.right - geometry.view.left).toFixed(1)}px, panel ${geometry.panel.height.toFixed(1)}px, sheet ${geometry.sheetHeight.toFixed(1)}px, content bottom ${geometry.contentBottom.toFixed(1)}px, status top ${geometry.statusBar?.top.toFixed(1) ?? "absent"}px, inset ${geometry.inset}`;
    }
    return "panel hidden as required while the static summary is on screen";
  });
}

async function scrollView(page, bottom) {
  const view = page.locator('.view-content.subscription-calculator-view');
  await view.hover({ position: { x: 20, y: 20 } });
  await page.mouse.wheel(0, bottom ? 100000 : -100000);
  for (let attempt = 0; attempt < 30; attempt++) {
    const reached = await view.evaluate((element, end) => end
      ? element.scrollHeight - element.clientHeight - element.scrollTop < 2
      : element.scrollTop < 2, bottom);
    if (reached) return;
    await sleep(100);
  }
  throw new Error(`view did not scroll to ${bottom ? "bottom" : "top"}`);
}

async function checkBothStates(ctx, s, label) {
  await scrollView(ctx.page, false);
  await measureAndAssert(ctx, s, `${label}: visible panel`, "bottom");
  await ctx.screenshot(label.startsWith("wide") ? "s6-wide" : "s6-narrow-320");
  await scrollView(ctx.page, true);
  await measureAndAssert(ctx, s, `${label}: hidden panel`, "bottom", false);
  await scrollView(ctx.page, false);
}

async function resizeSidebar(page, width) {
  const sidebar = page.locator('.workspace-split.mod-right-split');
  // Controlled layout setup, like viewport emulation: production observers and
  // layout run normally. This scenario tests plugin geometry, not host resizing.
  await sidebar.evaluate((element, value) => { element.style.width = `${value}px`; }, width);
  for (let attempt = 0; attempt < 30; attempt++) {
    const current = await sidebar.boundingBox();
    if (current && Math.abs(current.width - width) <= 2) return;
    await sleep(100);
  }
  throw new Error(`sidebar did not resize to ${width}px`);
}

export const scenario = {
  id: "s6-summary-geometry",
  title: "Narrow/wide geometry: floating summary, status bar, controls, bottom space",
  async run(ctx, s) {
    const { page, fixtures } = ctx;
    await fixtures.ensureViewOpen();
    const baseline = await readVaultData(ctx.config);
    const position = baseline.data.settings.floatingYearlyTotal ? "bottom" : "top";
    if (position === "top") {
      await fixtures.setToggleSetting("Total position", "floatingYearlyTotal", true);
      // The settings window must not stay open during the geometry measurements.
      if (fixtures.settingsPage && !fixtures.settingsPage.isClosed()) await fixtures.closeSettings();
    }
    const sidebar = page.locator('.workspace-split.mod-right-split');
    const originalSidebar = await sidebar.boundingBox();
    s.expect(originalSidebar !== null, "configured right sidebar must be visible");
    // Resize the actual view with controlled layout setup. Shrinking the whole app
    // below its minimum width can clip the sidebar and gives false narrow evidence.
    ctx.pageCleanup.push({
      name: "restore sidebar width",
      run: () => resizeSidebar(page, originalSidebar.width),
    });
    await s.do("resize the actual sidebar to wide (600px)", () => resizeSidebar(page, 600));

    await s.do("create bounded suite fixtures until the static total is below the native view", async () => {
      await scrollView(page, false);
      for (let count = 0; count <= 24; count++) {
        await sleep(100);
        const geometry = await page.evaluate(geometryProbe, "bottom");
        if (geometry?.expectedVisible) return `${count} suite-owned subscriptions added`;
        s.expect(count < 24, "24 fixture cards must move the static total below the view; visible geometry coverage is required");
        await fixtures.addSubscription({ name: `SMOKE S6 ${ctx.run.id} ${count + 1}`, price: "1.00" });
      }
    });

    await s.do("controls usable at wide width", () => cycleShowDisabled(ctx, s));
    await checkBothStates(ctx, s, "wide (600px sidebar)");

    await s.do("resize the actual sidebar to narrow (320px)", () => resizeSidebar(page, 320));
    await s.do("controls usable at narrow width", () => cycleShowDisabled(ctx, s));
    await checkBothStates(ctx, s, "narrow (320px sidebar)");

    await s.do("restore the original sidebar width", () => resizeSidebar(page, originalSidebar.width));
  },
};
