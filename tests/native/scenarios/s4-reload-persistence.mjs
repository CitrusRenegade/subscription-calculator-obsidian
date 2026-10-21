// Scenario 4: reload the plugin through the project's documented CLI path and verify
// suite-owned saved values persist while registered behavior is not duplicated.
// The reload re-reads the SAME on-disk artifact; it never builds or rewrites code.
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { readVaultData, waitForVaultData } from "../lib/probes.mjs";

// Counts only: the live plugin instance is never returned across page.evaluate
// (a returned object arrives as a fresh serialization clone, so comparing values
// from two evaluate calls would make identity checks vacuous). Identity is
// compared in the renderer against the window marker via pluginReplaced().
const REGISTRATION_STATE = `(() => {
    return {
      commands: Object.keys(app.commands.commands).filter((id) => id.startsWith('subscription-calculator:')).sort(),
      ribbonIcons: document.querySelectorAll('.workspace-ribbon .clickable-icon[aria-label="Open subscriptions"]').length,
      settingsTabs: (app.setting?.pluginTabs ?? []).filter((tab) => tab.id === 'subscription-calculator').length,
      viewLeaves: app.workspace.getLeavesOfType('subscription-calculator-view').length,
      floatingPanels: document.querySelectorAll('.subscription-calculator-summary-floating').length,
    };
  })()
`;

const pluginReplaced = () => {
  const plugin = app.plugins.plugins["subscription-calculator"];
  return !!plugin && plugin !== window.__smokePluginRef;
};

export const scenario = {
  id: "s4-reload-persistence",
  title: "Plugin reload persists suite-owned data without duplicate registration",
  async run(ctx, s) {
    const { page, fixtures } = ctx;
    const name = `SMOKE S4 ${ctx.run.id}`;
    await fixtures.ensureViewOpen();
    await fixtures.addSubscription({ name, price: "2.25" });
    // Suite-owned settings fixture: proves a settings value (not only subscriptions)
    // survives the reload; runner cleanup flips it back afterwards.
    await s.do("suite-owned settings change before reload", () =>
      fixtures.setToggleSetting("Confirm before delete", "confirmBeforeDelete", false)
    );
    if (fixtures.settingsPage && !fixtures.settingsPage.isClosed()) await fixtures.closeSettings();

    const baseline = await s.do("capture registration baseline", () => page.evaluate(REGISTRATION_STATE));
    ctx.pageCleanup.push({
      name: "clear plugin-instance marker",
      run: () => page.evaluate("(() => { delete window.__smokePluginRef; })()"),
    });
    await page.evaluate("(() => { window.__smokePluginRef = app.plugins.plugins['subscription-calculator']; })()");
    const persisted = await waitForVaultData(
      ctx.config,
      (data) => data.subscriptions.some((item) => item.name === name),
      8000,
      "fixture persisted before reload"
    );
    const fixtureId = persisted.data.subscriptions.find((item) => item.name === name).id;

    await s.do("CLI resolves the configured vault before reload", () => {
      const info = spawnSync("obsidian", [`vault=${ctx.config.vaultName}`, "vault", "info=path"], {
        encoding: "utf8",
        timeout: 15000,
        windowsHide: true,
      });
      if (info.status !== 0) {
        s.block(`obsidian CLI vault info failed (exit ${info.status}): ${info.stderr.trim() || "no output"}`);
      }
      const resolved = path.resolve(info.stdout.trim());
      const configured = path.resolve(ctx.config.vaultPath);
      if (resolved.toLowerCase() !== configured.toLowerCase()) {
        s.block(`CLI resolved a different vault path: ${resolved}`);
      }
      return { resolved };
    });
    await s.do("plugin reload command completes", () => {
      const reload = spawnSync("obsidian", [`vault=${ctx.config.vaultName}`, "plugin:reload", `id=${ctx.config.pluginId}`], {
        encoding: "utf8",
        timeout: 30000,
        windowsHide: true,
      });
      if (reload.status !== 0) {
        s.block(`plugin:reload failed (exit ${reload.status}): ${reload.stderr.trim() || reload.stdout.trim() || "no output"}`);
      }
      return { stdout: reload.stdout.trim() };
    });
    await s.do("a new plugin instance is loaded", async () => {
      for (let i = 0; i < 60; i++) {
        if (await page.evaluate(pluginReplaced).catch(() => false)) return;
        await sleep(500);
      }
      s.expect(false, "plugin instance was not replaced after reload within 30s");
    });
    await s.do("view returns ready after reload", async () => {
      for (let i = 0; i < 40; i++) {
        if (await page.locator(".subscription-calculator-add-card").isVisible({ timeout: 500 }).catch(() => false)) return;
        await sleep(500);
      }
      s.expect(false, "subscriptions view did not become ready after reload within 20s");
    });
    await s.do("registered behavior is not duplicated", async () => {
      const after = await page.evaluate(REGISTRATION_STATE);
      s.expect(
        JSON.stringify(after.commands) === JSON.stringify(baseline.commands) && baseline.commands.length > 0,
        `command set changed: ${JSON.stringify(baseline.commands)} -> ${JSON.stringify(after.commands)}`
      );
      s.expect(after.ribbonIcons === 1, `ribbon icons after reload: ${after.ribbonIcons} (baseline ${baseline.ribbonIcons})`);
      s.expect(after.settingsTabs === 1, `settings tabs after reload: ${after.settingsTabs}`);
      s.expect(after.viewLeaves === baseline.viewLeaves, `view leaves changed: ${baseline.viewLeaves} -> ${after.viewLeaves}`);
      s.expect(after.floatingPanels <= 1, `floating summary panels after reload: ${after.floatingPanels}`);
      s.expect(await page.evaluate(pluginReplaced), "plugin instance identity must differ after reload (renderer-side marker comparison)");
    });
    await s.do("suite-owned data survived the reload", async () => {
      await waitForVaultData(
        ctx.config,
        (data) => data.subscriptions.some((item) => item.id === fixtureId && item.name === name),
        8000,
        "fixture after reload"
      );
      const card = fixtures.cardLocator(name);
      await card.waitFor({ state: "visible", timeout: 8000 });
      const after = await readVaultData(ctx.config);
      s.expect(
        after.data.subscriptions.length === persisted.data.subscriptions.length,
        `subscription count changed across reload: ${persisted.data.subscriptions.length} -> ${after.data.subscriptions.length}`
      );
    });
    await s.do("suite-owned settings value survived the reload", async () => {
      const after = await readVaultData(ctx.config);
      s.expect(
        after.data.settings.confirmBeforeDelete === false,
        `confirmBeforeDelete should stay false after reload (got ${after.data.settings.confirmBeforeDelete})`
      );
      const settingsPage = await fixtures.openSettings();
      await fixtures.openPluginTab(settingsPage);
      // Obsidian mirrors toggle state on the container's is-enabled class; the
      // checkbox input's checked property is never synced in this build, so
      // isChecked() would read false regardless of the real value.
      const toggleOn = await fixtures
        .namedSettingRow(settingsPage, "Confirm before delete")
        .locator(".checkbox-container")
        .evaluate((el) => el.classList.contains("is-enabled"));
      s.expect(toggleOn === false, "settings UI must show the persisted value after reload");
      await fixtures.closeSettings();
    });
    await ctx.screenshot("s4-after-reload");
  },
};
