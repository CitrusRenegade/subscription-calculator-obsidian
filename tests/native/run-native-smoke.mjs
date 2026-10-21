#!/usr/bin/env node
// Opt-in native smoke suite for the Subscription Calculator plugin.
// Runs the bounded desktop scenarios against the configured test vault through the
// devkit live-guide flow: CDP attach, exact vault/plugin validation, native window
// placement on the configured secondary display, real locator/keyboard interactions.
// Entirely separate from `npm run check`; never builds or rewrites the artifact.
//
// There is no outer racing watchdog: every scenario is awaited completely before
// cleanup runs (each step is bounded by Playwright timeouts), so a scenario can
// never race its own cleanup.
//
// Exit codes: 0 success · 1 failure (>=1 Failed) · 2 incomplete (Blocked/cleanup) · 3 harness error.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT, resolveConfig, parseArgs } from "./lib/config.mjs";
import { connectSmoke, loadPlaywright } from "./lib/connect.mjs";
import { SaveGate, restoreRealDate } from "./lib/inject.mjs";
import { Fixtures } from "./lib/fixtures.mjs";
import { getReadinessProblems } from "./lib/readiness.mjs";
import { ScenarioBlocked, scenarioStatusOf, Steps } from "./lib/steps.mjs";
import {
  getNativeWindowHandle,
  placeTestWindow,
  readArtifact,
  readGitRevision,
  readObsidianApiVersion,
  readVaultData,
  waitForRenders,
} from "./lib/probes.mjs";
import { exitCodeFor, formatReport, overallVerdict } from "./lib/report.mjs";
import { scenario as s1 } from "./scenarios/s1-icon-drafts.mjs";
import { scenario as s2 } from "./scenarios/s2-sibling-price-draft.mjs";
import { scenario as s3 } from "./scenarios/s3-currency-save-focus.mjs";
import { scenario as s4 } from "./scenarios/s4-reload-persistence.mjs";
import { scenario as s5 } from "./scenarios/s5-date-refresh.mjs";
import { scenario as s6 } from "./scenarios/s6-summary-geometry.mjs";
import { demoBlocked, demoFailure } from "./scenarios/demo.mjs";

const proc = globalThis.process;
const ALL_SCENARIOS = [s1, s2, s3, s4, s5, s6];

const out = (message) => proc.stdout.write(`${message}\n`);
const err = (message) => proc.stderr.write(`${message}\n`);

/** Discover the Claude-cache devkit helper; other installs pass --placement-helper. */
async function resolvePlacementHelper(flag) {
  if (flag) return flag;
  const cacheRoot = path.join(os.homedir(), ".claude", "plugins", "cache", "zzz-awesome-agents", "obsidian-plugin-devkit");
  try {
    const versions = (await readdir(cacheRoot)).sort().reverse();
    for (const version of versions) {
      const scriptsDir = path.join(cacheRoot, version, "skills", "obsidian-workflow-core", "scripts");
      const names = await readdir(scriptsDir).catch(() => []);
      if (names.includes("set-test-window.ps1")) return path.join(scriptsDir, "set-test-window.ps1");
    }
  } catch {
    return null;
  }
  return null;
}

/** Cleanup-grade: close plugin dialogs a failed scenario may have left open. */
async function closeLeftoverDialogs(page) {
  for (let i = 0; i < 5; i++) {
    const modal = page.locator(".modal .subscription-calculator-modal");
    if (!(await modal.isVisible().catch(() => false))) return true;
    const confirm = page.locator(".subscription-calculator-discard-actions");
    if (await confirm.isVisible().catch(() => false)) {
      const discard = confirm.getByRole("button", { name: /^Discard changes$/ }).first();
      const cancel = confirm.getByRole("button", { name: /^(Cancel|Keep editing)$/ }).first();
      if (await discard.isVisible().catch(() => false)) {
        await discard.click().catch(() => undefined);
      } else if (await cancel.isVisible().catch(() => false)) {
        await cancel.click().catch(() => undefined);
      } else {
        await page.keyboard.press("Escape").catch(() => undefined);
      }
    } else {
      await page.keyboard.press("Escape").catch(() => undefined);
    }
    await sleep(350);
  }
  return !(await page.locator(".modal .subscription-calculator-modal").isVisible().catch(() => false));
}

/** Obsidian version from the CDP /json/version user agent (no navigator probes). */
async function obsidianVersionFromCdp(endpoint) {
  try {
    const info = await (await fetch(`${endpoint}/json/version`)).json();
    return info["User-Agent"]?.match(/obsidian[/]([\d.]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const flags = parseArgs(proc.argv.slice(2));
  if (flags.list) {
    for (const scenario of ALL_SCENARIOS) out(scenario.id);
    out("demo-injected-failure\ndemo-unmet-focus");
    return;
  }
  let config;
  try { config = resolveConfig(flags); }
  catch (error) {
    err(error.message);
    proc.exitCode = 3;
    return;
  }
  config.repoRoot = REPO_ROOT;
  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportDir = path.join(config.reportRoot, runId);
  const evidenceDir = path.join(reportDir, "evidence");
  await mkdir(evidenceDir, { recursive: true });

  const selectedIds = flags.scenario ? String(flags.scenario).split(",") : ALL_SCENARIOS.map((scenario) => scenario.id);
  const selected = ALL_SCENARIOS.filter((scenario) => selectedIds.includes(scenario.id));
  const missing = selectedIds.filter((id) => !selected.some((scenario) => scenario.id === id));
  if (missing.length) {
    err(`Unknown scenario(s): ${missing.join(", ")}. Use --list for available ids.`);
    proc.exitCode = 3;
    return;
  }
  if (flags.demoFailure) selected.push(demoFailure);
  if (flags.demoBlocked) selected.push(demoBlocked);

  const run = {
    id: runId,
    config,
    versions: {},
    revision: {},
    artifact: { installed: {}, matchesRepoBuild: false },
    window: { line: "not placed (--skipPlace)" },
    readiness: { line: "not checked" },
    cleanup: null,
    notes: [],
  };
  const sections = [];
  let disconnect = null;
  let page = null;
  let harnessError = null;

  try {
    const connection = await connectSmoke({
      endpoint: config.cdpEndpoint,
      vaultPath: config.vaultPath,
      pluginId: config.pluginId,
      playwrightModule: loadPlaywright(REPO_ROOT),
    });
    page = connection.page;
    disconnect = connection.disconnect;
    page.setDefaultTimeout(6000);

    const artifact = await readArtifact(config);
    run.artifact = artifact;
    run.versions = {
      app: await obsidianVersionFromCdp(config.cdpEndpoint),
      api: await readObsidianApiVersion(page),
      plugin: artifact.vaultManifest.version,
    };
    run.revision = await readGitRevision(REPO_ROOT);

    if (!artifact.matchesRepoBuild) {
      run.notes.push(
        "Vault install does not byte-match the repository build; results describe the vault artifact recorded above."
      );
    }

    let placementEstablished = false;
    if (config.placeWindow) {
      const helper = await resolvePlacementHelper(flags.placementHelper);
      if (!helper) {
        run.window.line = "BLOCKED: devkit placement helper not found (set --placement-helper)";
        run.notes.push("Window placement unavailable; scenarios report Blocked when preconditions are not met.");
      } else {
        try {
          const placed = await placeTestWindow(page, config, helper);
          const native = await getNativeWindowHandle(page);
          placementEstablished = true;
          run.window.line =
            `DISPLAY placement ok (handle ${placed.handle}); native helper verified edges and foreground; ` +
            `native state visible=${native.visible}, minimized=${native.minimized}, focused=${native.focused}`;
        } catch (error) {
          run.window.line = `BLOCKED: ${error.message}`;
          run.notes.push("Window placement failed; scenarios report Blocked when preconditions are not met.");
        }
      }
    }

    const readiness = await waitForRenders(page);
    run.readiness.line = readiness.visible && readiness.rafAlive
      ? "visible and painting (two distinct animation frames)"
      : `NOT READY: visibility=${readiness.visible}, rafAlive=${readiness.rafAlive}`;

    const gate = new SaveGate(page, (message) => run.notes.push(`[gate] ${message}`));
    const fixtures = new Fixtures(page, config);
    const ctx = {
      page,
      config,
      run,
      gate,
      fixtures,
      dateInjectionUsed: false,
      evidence: [],
      /** Registered per-scenario page-state cleanups; always run, success or failure. */
      pageCleanup: [],
      screenshot: async (name) => {
        const file = `${name}.png`;
        const target = path.join(evidenceDir, file);
        await page.screenshot({ path: target });
        const relative = path.join("evidence", file);
        ctx.evidence.push(relative);
        return relative;
      },
    };

    for (const scenario of selected) {
      out(`[smoke] ${scenario.id}: start`);
      const steps = new Steps();
      const section = {
        id: scenario.id,
        title: scenario.title,
        status: "Passed",
        reason: null,
        steps: steps.entries,
        evidence: [],
        cleanup: null,
      };
      sections.push(section);
      ctx.evidence = [];
      ctx.pageCleanup = [];
      try {
        // Preconditions gate every renderer scenario before its first step.
        // Native foreground is diagnostic only; scenario assertions verify the
        // specific DOM input focus they need. Nothing is activated to force focus.
        const native = await getNativeWindowHandle(page);
        const readinessNow = await waitForRenders(page);
        const problems = getReadinessProblems({
          native,
          renderer: readinessNow,
          placement: { requested: config.placeWindow, established: placementEstablished },
        });
        if (problems.length) {
          throw new ScenarioBlocked(`environment preconditions unmet: ${problems.join("; ")}`);
        }
        section.preconditions =
          `native visible=${native.visible}, minimized=${native.minimized}, focused=${native.focused} (diagnostic); renderer painting`;
        await scenario.run(ctx, steps);
        section.evidence = [...ctx.evidence];
      } catch (error) {
        section.status = scenarioStatusOf(error);
        section.reason = error.message;
        section.evidence = [...ctx.evidence];
      } finally {
        // The scenario promise has fully settled here; cleanup cannot overlap it.
        const problems = [];
        try {
          await gate.setMode("pass");
          await gate.releaseAll();
          await gate.awaitSettlement();
          await gate.uninstall();
        } catch (error) {
          problems.push(`save gate cleanup: ${error.message}`);
        }
        if (ctx.dateInjectionUsed) {
          const restore = await restoreRealDate(page);
          if (!restore.ok) {
            problems.push(`Date injection restore failed: ${restore.error}`);
          }
          ctx.dateInjectionUsed = false;
        }
        for (const cleanup of ctx.pageCleanup.splice(0)) {
          try {
            await cleanup.run();
          } catch (error) {
            problems.push(`${cleanup.name}: ${error.message}`);
          }
        }
        if (!(await closeLeftoverDialogs(page).catch(() => false))) {
          problems.push("a plugin dialog stayed open after the scenario");
        }
        section.cleanup = await fixtures.restore().catch((error) => ({ complete: false, problems: [error.message] }));
        try {
          const residue = await readVaultData(config);
          const straySubs = residue.data.subscriptions.filter((item) => item.name.startsWith("SMOKE ")).length;
          const strayCurrencies = residue.data.customCurrencies.filter((item) => item.label.startsWith("SMOKE")).length;
          if (straySubs || strayCurrencies) {
            problems.push(`fixture residue in vault: ${straySubs} subscription(s), ${strayCurrencies} custom currency/ies`);
          }
        } catch {
          problems.push("could not verify fixture residue in data.json");
        }
        if (problems.length) {
          section.cleanup = {
            complete: (section.cleanup?.complete ?? true) && problems.length === 0,
            problems: [...(section.cleanup?.problems ?? []), ...problems],
          };
        }
        out(`[smoke] ${scenario.id}: ${section.status} (cleanup ${section.cleanup.complete ? "ok" : "incomplete"})`);
      }
    }

    const cleanupProblems = sections.flatMap((section) => section.cleanup?.problems ?? []);
    run.cleanup = { complete: cleanupProblems.length === 0, problems: cleanupProblems };
    run.verdict = overallVerdict(sections, run.cleanup);
  } catch (error) {
    harnessError = error;
    run.verdict = "ERROR";
    run.notes.push(`Harness error: ${error.message}`);
  } finally {
    if (disconnect) await disconnect();
  }

  const report = formatReport(run, sections);
  const reportPath = path.join(reportDir, "report.md");
  await writeFile(reportPath, report, "utf8");

  out("\n=== Native smoke summary ===");
  for (const section of sections) {
    out(`${section.status.padEnd(8)} ${section.id} — ${section.title}`);
  }
  out(`Verdict: ${run.verdict}${harnessError ? ` (harness error: ${harnessError.message})` : ""}`);
  out(`Report: ${reportPath}`);
  proc.exitCode = harnessError ? 3 : exitCodeFor(run.verdict);
}

await main();
