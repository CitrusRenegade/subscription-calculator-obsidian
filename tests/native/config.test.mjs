import { describe, expect, it } from "vitest";
import { parseArgs, resolveConfig } from "./lib/config.mjs";

const flags = {
  vaultName: "Example Vault", vaultPath: "C:/example-vault",
  cdpEndpoint: "http://127.0.0.1:9000", display: "example-secondary-display",
};

describe("explicit native smoke target", () => {
  it("refuses to infer a machine target when configuration is absent", () => {
    expect(() => resolveConfig({}, {})).toThrow(/Missing native smoke configuration.*--vault-name.*--vault-path.*--cdp-endpoint.*--display/);
  });

  it("uses flags before environment without replacing the selected vault", () => {
    const config = resolveConfig(flags, { SMOKE_NATIVE_VAULT_PATH: "C:/other-vault" });
    expect(config.vaultName).toBe(flags.vaultName);
    expect(config.vaultPath).toBe(flags.vaultPath);
    expect(config.cdpEndpoint).toBe(flags.cdpEndpoint);
    expect(config.displayDeviceName).toBe(flags.display);
  });

  it("accepts an explicit environment target without a display when placement is skipped", () => {
    const config = resolveConfig({ skipPlace: true }, {
      SMOKE_NATIVE_VAULT_NAME: flags.vaultName,
      SMOKE_NATIVE_VAULT_PATH: flags.vaultPath,
      SMOKE_NATIVE_CDP_ENDPOINT: flags.cdpEndpoint,
    });
    expect(config.vaultPath).toBe(flags.vaultPath);
    expect(config.placeWindow).toBe(false);
    expect(config.displayDeviceName).toBeUndefined();
  });

  it("rejects a bare target flag instead of treating true as a vault name", () => {
    expect(() => resolveConfig({ ...flags, ...parseArgs(["--vault-name"]) }, {})).toThrow(/--vault-name/);
  });
});
