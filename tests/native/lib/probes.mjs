// Read-only observation helpers: renderer readiness, DOM state, vault persistence
// and artifact identity. evaluate() is used for preparation/state inspection only;
// tested user actions go through Playwright locators and keyboard in scenarios.
//
// All page probes are real callback functions (this Playwright build does not
// auto-invoke string expressions with arguments). The observed `app` warnings are
// inherent to test probes and documented in tests/README.md.
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Two distinct animation frames prove the renderer is painting (not frozen/hidden). */
const readinessProbe = () =>
  new Promise((resolve) => {
    if (document.visibilityState !== "visible") {
      resolve({ visible: false, rafAlive: false });
      return;
    }
    const start = performance.now();
    let first = null;
    requestAnimationFrame(function frame(value) {
      if (first === null) {
        first = value;
        requestAnimationFrame(frame);
        return;
      }
      resolve({ visible: true, rafAlive: value !== first, elapsedMs: Math.round(performance.now() - start) });
    });
    setTimeout(() => resolve({ visible: true, rafAlive: false, elapsedMs: Math.round(performance.now() - start) }), 1500);
  });

export async function readReadiness(page) {
  return page.evaluate(readinessProbe);
}

/** Renderer and workspace state used by scenario preconditions. */
const rendererState = () => ({
  visibility: document.visibilityState,
  hasFocus: document.hasFocus(),
  activeElement: document.activeElement
    ? {
        tag: document.activeElement.tagName,
        ariaLabel: document.activeElement.getAttribute("aria-label"),
        modal: !!document.activeElement.closest(".modal"),
      }
    : null,
  view: (() => {
    const leaf = app.workspace.getLeavesOfType("subscription-calculator-view")[0];
    const el = leaf?.view?.contentEl;
    return { open: !!el?.isConnected };
  })(),
});

export async function readRendererState(page) {
  return page.evaluate(rendererState);
}

export async function waitForRenders(page, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const readiness = await readReadiness(page);
    if (readiness.visible && readiness.rafAlive) return readiness;
    if (Date.now() > deadline) return readiness;
    await sleep(150);
  }
}

// --- Vault persistence observation (external, read-only) ---

export function vaultDataJsonPath(config) {
  return path.join(config.vaultPath, ".obsidian", "plugins", config.pluginId, "data.json");
}

export async function readVaultData(config) {
  const raw = await readFile(vaultDataJsonPath(config), "utf8");
  return { raw, hash: sha256(raw), data: JSON.parse(raw) };
}

export async function dataJsonMtime(config) {
  return (await stat(vaultDataJsonPath(config))).mtimeMs;
}

/** Bounded poll until the persisted file reflects `predicate`, else throw. */
export async function waitForVaultData(config, predicate, timeoutMs = 8000, describe = "expected data") {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const last = await readVaultData(config);
    if (predicate(last.data)) return last;
    if (Date.now() > deadline) {
      throw new Error(`persisted data.json did not show ${describe} within ${timeoutMs}ms`);
    }
    await sleep(150);
  }
}

// --- Artifact identity ---

export async function readArtifact(config) {
  const pluginDir = path.join(config.vaultPath, ".obsidian", "plugins", config.pluginId);
  const names = ["main.js", "manifest.json", "styles.css"];
  const installed = {};
  for (const name of names) {
    try {
      installed[name] = sha256(await readFile(path.join(pluginDir, name)));
    } catch {
      installed[name] = null;
    }
  }
  const repo = {};
  for (const name of names) {
    try {
      repo[name] = sha256(await readFile(path.join(config.repoRoot, name)));
    } catch {
      repo[name] = null;
    }
  }
  const vaultManifest = JSON.parse(await readFile(path.join(pluginDir, "manifest.json"), "utf8"));
  return {
    pluginDir,
    installed,
    repo,
    matchesRepoBuild: names.every((name) => installed[name] !== null && installed[name] === repo[name]),
    vaultManifest,
  };
}

export async function readGitRevision(repoRoot) {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  return {
    revision: head.status === 0 ? head.stdout.trim() : null,
    dirtyFiles: status.status === 0 ? status.stdout.trim().split("\n").filter(Boolean).length : null,
  };
}

// --- Native window state and placement ---

// The renderer's electron bridge (`require('electron').remote`) is the only documented
// way to obtain the verified page's native HWND and focus state from inside Obsidian,
// as prescribed by the installed devkit live guide. The bridge exists only in the page
// runtime, so this one probe stays an explicitly self-invoked source string; the
// 4/8-byte HWND buffer is decoded little-endian per that guide.
const WINDOW_STATE_SOURCE = `(() => {
    const remote = require('electron').remote;
    const win = remote.getCurrentWindow();
    const buffer = win.getNativeWindowHandle();
    let value = 0n;
    for (let i = buffer.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(buffer[i]);
    return {
      handle: value.toString(),
      visible: win.isVisible(),
      minimized: win.isMinimized(),
      focused: win.isFocused(),
    };
  })()`;

export async function getNativeWindowHandle(page) {
  return page.evaluate(WINDOW_STATE_SOURCE);
}

/** Native window truth used by preconditions; never activates the window. */
export async function readNativeWindowState(page) {
  return page.evaluate(WINDOW_STATE_SOURCE);
}

// The renderer's module registry (`require('obsidian')`) is the supported way to
// read the exported `apiVersion` inside Obsidian; like the electron bridge it only
// exists in the page runtime, so this one probe stays an explicitly self-invoked
// source string. Returns null when the module API is unavailable.
const API_VERSION_SOURCE = `(() => {
    try {
      const version = require('obsidian').apiVersion;
      return typeof version === 'string' ? version : null;
    } catch (error) {
      return null;
    }
  })()`;

export async function readObsidianApiVersion(page) {
  return page.evaluate(API_VERSION_SOURCE);
}

/**
 * Place the test window on the configured secondary display without activation.
 * Uses the installed devkit helper; fails honestly when pwsh or the display is
 * unavailable instead of falling back to another display.
 */
export async function placeTestWindow(page, config, helperPath) {
  const { handle } = await getNativeWindowHandle(page);
  const result = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      helperPath,
      "-WindowHandle",
      handle,
      "-DisplayDeviceName",
      config.displayDeviceName,
      "-WidthFraction",
      String(config.widthFraction),
      "-HeightFraction",
      String(config.heightFraction),
    ],
    { encoding: "utf8", timeout: 30000 }
  );
  if (result.status !== 0) {
    throw new Error(`window placement failed: ${result.stderr.trim() || `pwsh exit ${result.status}`}`);
  }
  return { handle, native: result.stdout };
}
