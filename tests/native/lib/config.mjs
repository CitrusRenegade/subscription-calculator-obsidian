// Portable suite defaults. Resolve machine settings from local AGENTS.md and
// pass them explicitly through flags/environment; this helper does not parse it.
// No fallback vault: when the configured target is unavailable the run reports Blocked/ERROR.
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, "manifest.json"), "utf8"));

export const DEFAULTS = {
  pluginId: manifest.id,
  widthFraction: 0.72,
  heightFraction: 0.87,
  reportRoot: path.resolve(REPO_ROOT, "..", "subscription-calculator-smoke-runs"),
};

function pick(flag, env, fallback) {
  if (flag !== undefined && flag !== null && flag !== "") return flag;
  if (env) return env;
  return fallback;
}

/** Resolve CLI flags > environment > portable suite defaults. */
export function resolveConfig(flags = {}, env = globalThis.process?.env ?? {}) {
  const config = {
    vaultName: pick(flags.vaultName, env.SMOKE_NATIVE_VAULT_NAME),
    vaultPath: pick(flags.vaultPath, env.SMOKE_NATIVE_VAULT_PATH),
    pluginId: pick(flags.pluginId, env.SMOKE_NATIVE_PLUGIN_ID, DEFAULTS.pluginId),
    cdpEndpoint: pick(flags.cdpEndpoint, env.SMOKE_NATIVE_CDP_ENDPOINT),
    displayDeviceName: pick(flags.display, env.SMOKE_NATIVE_DISPLAY),
    widthFraction: Number(pick(flags.widthFraction, env.SMOKE_NATIVE_WIDTH_FRACTION, DEFAULTS.widthFraction)),
    heightFraction: Number(pick(flags.heightFraction, env.SMOKE_NATIVE_HEIGHT_FRACTION, DEFAULTS.heightFraction)),
    reportRoot: pick(flags.reportDir, env.SMOKE_NATIVE_REPORT_DIR, DEFAULTS.reportRoot),
    placeWindow: !(flags.skipPlace ?? flags["skip-place"]),
  };
  const required = [["vaultName", "--vault-name"], ["vaultPath", "--vault-path"], ["cdpEndpoint", "--cdp-endpoint"]];
  if (config.placeWindow) required.push(["displayDeviceName", "--display"]);
  const missing = required.filter(([key]) => typeof config[key] !== "string" || !config[key].trim());
  if (missing.length) {
    throw new Error(`Missing native smoke configuration: ${missing.map(([, flag]) => flag).join(", ")}. Read repository-local AGENTS.md and pass flags or SMOKE_NATIVE_* environment variables; no machine target is assumed.`);
  }
  return config;
}

/** Parse "--name value", "--name=value" and boolean "--name" flags; kebab-case names are normalized to camelCase. */
export function parseArgs(argv) {
  const flags = {};
  const camel = (name) => name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const [rawName, inline] = arg.slice(2).split("=", 2);
    const name = camel(rawName);
    if (inline !== undefined) {
      flags[name] = inline;
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      flags[name] = argv[++i];
    } else {
      flags[name] = true;
    }
  }
  return flags;
}
