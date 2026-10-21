// Suite-owned CDP connector with the devkit live-guide semantics: exact vault path,
// unique window match, loaded plugin, bounded discovery, detach-only disconnect.
import path from "node:path";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

function normalizedPath(value) {
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(value);
  if (!windows && !path.isAbsolute(value)) throw new Error("Vault path must be absolute");
  return windows
    ? path.win32.normalize(value).replace(/[\\/]+$/, "").toLowerCase()
    : path.normalize(value).replace(/\/+$/, "") || "/";
}

async function bounded(promise, timeoutMs, description) {
  const timeout = sleep(timeoutMs).then(() => {
    throw new Error(`${description} timed out after ${timeoutMs}ms`);
  });
  timeout.catch(() => undefined); // no unhandled rejection when the main promise wins
  return Promise.race([promise, timeout]);
}

// Page-side probe: identify the vault and plugin state of each open target.
// Real function objects are used for every page probe (Playwright serializes and
// invokes them, including arguments); the observed `app` warnings are inherent to
// test probes and documented in tests/README.md.
const targetState = (pluginId) => {
  if (typeof app === "undefined" || !app.vault?.adapter?.basePath) return null;
  return {
    vaultPath: app.vault.adapter.basePath,
    pluginLoaded: !!app.plugins?.plugins?.[pluginId],
  };
};

/**
 * Attach to a running Obsidian without closing its windows on disconnect.
 * playwrightModule is the loaded `playwright` module from project dependencies.
 */
export async function connectSmoke({ endpoint, vaultPath, pluginId, playwrightModule, discoveryTimeoutMs = 10000 }) {
  if (!endpoint || !pluginId) throw new Error("CDP endpoint and plugin ID are required");
  if (!playwrightModule?.chromium?.connectOverCDP) throw new Error("A loaded Playwright module is required");
  const target = normalizedPath(vaultPath);

  let browser;
  try {
    browser = await playwrightModule.chromium.connectOverCDP(endpoint, { timeout: 10000 });
  } catch (cause) {
    throw new Error(`Cannot connect to Obsidian at ${endpoint}: ${cause.message}`, { cause });
  }
  const disconnect = () =>
    bounded(Promise.resolve().then(() => browser.close()), 5000, "CDP disconnect").catch(() => undefined);

  try {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const inspected = await bounded(
      Promise.all(
        pages.map(async (page) => {
          try {
            const state = await page.evaluate(targetState, pluginId);
            return { page, state };
          } catch (cause) {
            if (page.isClosed?.()) return null;
            throw new Error(`Cannot inspect an open CDP target: ${cause.message}; vault selection is unverified`, { cause });
          }
        })
      ),
      discoveryTimeoutMs,
      "CDP target discovery (vault selection is unverified)"
    );
    const matches = inspected.filter(
      (result) => result?.state?.vaultPath && normalizedPath(result.state.vaultPath) === target
    );
    if (!matches.length) throw new Error(`No window for configured vault: ${vaultPath}`);
    if (matches.length !== 1) {
      throw new Error(`Multiple windows for configured vault: ${vaultPath}; select a unique main vault window first`);
    }
    if (!matches[0].state.pluginLoaded) throw new Error(`Plugin ${pluginId} is not loaded in ${vaultPath}`);
    return { browser, page: matches[0].page, disconnect };
  } catch (error) {
    await disconnect();
    throw error;
  }
}

/** Load the project's own playwright dependency; no hidden installs or mock fallbacks. */
export function loadPlaywright(projectRoot) {
  const require = createRequire(path.join(projectRoot, "package.json"));
  return require(require.resolve("playwright", { paths: [projectRoot] }));
}
