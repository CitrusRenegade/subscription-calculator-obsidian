import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("../", import.meta.url));
describe("reload target configuration", () => {
  for (const vaultPath of ["", "relative-vault"]) {
    it(`refuses reload with unsafe target path ${vaultPath || "(missing)"} before invoking CLI`, () => {
      const result = spawnSync(process.execPath, ["esbuild.config.mjs", "--reload-only"], {
        cwd: repository,
        env: { ...process.env, OBSIDIAN_CLI: process.execPath, OBSIDIAN_DEV_VAULT: "fixture-vault", OBSIDIAN_DEV_VAULT_PATH: vaultPath },
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("OBSIDIAN_DEV_VAULT");
      expect(result.stdout).not.toContain("[reload]");
    });
  }
});
