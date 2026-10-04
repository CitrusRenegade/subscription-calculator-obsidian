import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const vitest = join(root, "node_modules/vitest/vitest.mjs");
const baseConfig = pathToFileURL(join(root, "vitest.config.mjs")).href;
const cases = [
  {
    name: "hidden-custom-days", source: "src/ui/AddSubscriptionModal.ts", tests: "tests/AddSubscriptionModal.test.ts",
    changes: [['this.billingPeriod !== "custom"', 'true'], ['this.billingPeriod === "custom" ? "" : "none"', '"none"']],
  },
  {
    name: "hidden-emoji", source: "src/ui/EditSubscriptionModal.ts", tests: "tests/EditSubscriptionModal.test.ts",
    changes: [['this.iconMode !== "emoji"', 'true'], ['this.iconMode === "emoji" ? "" : "none"', '"none"']],
  },
  {
    name: "disconnected-add-button", source: "src/ui/AddSubscriptionModal.ts", tests: "tests/AddSubscriptionModal.test.ts",
    changes: [['.onClick(() => void this.submit());', '.onClick(() => undefined);']],
  },
  {
    name: "stale-icon-result", source: "src/data/SubscriptionStore.ts", tests: "tests/iconReliability.test.ts",
    changes: [['this.iconRevisions.get(id) !== intent.revision ||', '']],
  },
  {
    name: "stale-shared-cache", source: "src/data/SubscriptionStore.ts", tests: "tests/iconReliability.test.ts",
    changes: [['? candidate : this.iconService.getReusableIcon(current)', '? candidate : candidate']],
  },
  {
    name: "missing-plugin-disposal", source: "src/main.ts", tests: "tests/mainLifecycle.test.ts",
    changes: [['this.register(() => this.store.dispose());', 'this.register(() => undefined);']],
  },
  {
    name: "lost-active-draft", source: "src/ui/SubscriptionsView.ts", tests: "tests/SubscriptionsView.integration.test.ts",
    changes: [['private captureFocusedControl(): () => void {', 'private captureFocusedControl(): () => void { return () => undefined;']],
  },
  {
    name: "missing-enter-commit", source: "src/ui/components/FormControls.ts", tests: "tests/FormControls.test.ts",
    changes: [['if (event.key === "Enter") {', 'if (false) {']],
  },
  {
    name: "leaked-view-listeners", source: "src/ui/SubscriptionsView.ts", tests: "tests/SubscriptionsView.test.ts",
    changes: [['this.cleanupDateEvents?.();', 'undefined;']],
  },
  {
    name: "missing-date-return", source: "src/ui/SubscriptionsView.ts", tests: "tests/SubscriptionsView.integration.test.ts",
    changes: [['document.addEventListener("visibilitychange", refreshDate);', 'undefined;']],
  },
];

const directory = mkdtempSync(join(tmpdir(), "subscription-test-regressions-"));
let failures = 0;
try {
  const baseline = spawnSync(process.execPath, [vitest, "run", "--reporter=json", ...new Set(cases.map(probe => probe.tests))], {
    cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024,
  });
  if (baseline.status !== 0 || baseline.error) {
    throw new Error(`Unmodified regression tests must pass first.\n${baseline.error?.message ?? baseline.stderr}\n${baseline.stdout}`);
  }
  for (const probe of cases) {
    const original = readFileSync(join(root, probe.source), "utf8");
    for (const [from] of probe.changes) {
      if (!original.includes(from)) throw new Error(`${probe.name}: mutation target changed; update the probe.`);
    }
    const config = join(directory, `${probe.name}.mjs`);
    writeFileSync(config, `import base from ${JSON.stringify(baseConfig)};
export default { ...base, plugins: [{ name: "regression-probe", enforce: "pre", transform(code, id) {
  if (!id.replaceAll("\\\\", "/").endsWith(${JSON.stringify(`/${probe.source}`)})) return;
  for (const [from, to] of ${JSON.stringify(probe.changes)}) {
    if (!code.includes(from)) throw new Error("Mutation target missing");
    code = code.replaceAll(from, to);
  }
  console.error("REGRESSION_PROBE_APPLIED:${probe.name}");
  return code;
} }] };
`);
    const result = spawnSync(process.execPath, [vitest, "run", "--config", config, "--reporter=json", probe.tests], {
      cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    });
    let report;
    try { report = JSON.parse(result.stdout); } catch { /* Diagnose a runner failure below. */ }
    const detected = result.status !== 0 && !result.error &&
      result.stderr.includes(`REGRESSION_PROBE_APPLIED:${probe.name}`) && report?.numFailedTests > 0;
    if (detected) console.log(`Detected: ${probe.name} (${report.numFailedTests} failed assertions/cases)`);
    else {
      failures++;
      console.error(`Not verified: ${probe.name}. Expected a test failure, not a runner error.`);
      console.error(result.error?.message ?? result.stderr);
      console.error(result.stdout);
    }
  }
} finally {
  // The only recursive deletion is our freshly created temporary directory.
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !directory.includes("subscription-test-regressions-")) {
    throw new Error("Unexpected regression probe directory");
  }
  rmSync(directory, { recursive: true, force: true });
}
if (failures) process.exitCode = 1;
