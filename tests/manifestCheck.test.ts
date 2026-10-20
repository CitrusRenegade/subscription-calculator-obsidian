import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const temporaryDirectories: string[] = [];
const manifestCheckScript = fileURLToPath(
  new URL("../scripts/check-manifest.mjs", import.meta.url)
);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function runManifestCheck(manifest: Record<string, unknown>) {
  const directory = mkdtempSync(join(tmpdir(), "subscription-calculator-manifest-"));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  const result = spawnSync(process.execPath, [manifestCheckScript], { cwd: directory, encoding: "utf8" });
  return { result, output: `${result.stderr}${result.stdout}` };
}

const validManifest = {
  id: "subscription-calculator",
  name: "Subscription Calculator",
  author: "CitrusRenegade",
  version: "0.11.0",
  minAppVersion: "1.13.0",
  description: "Track recurring payments and summarize costs locally in the vault.",
};

describe("manifest structural check", () => {
  it("accepts the community submission shape", () => {
    const { result } = runManifestCheck(validManifest);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("manifest.json: OK");
  });

  it.each([
    [{ ...validManifest, id: "Bad Id" }, "id must be lowercase"],
    [{ ...validManifest, description: `${"word ".repeat(60)}.` }, "250 characters or fewer"],
    [{ ...validManifest, description: "Tracks recurring payments" }, "end with a period"],
    [{ ...validManifest, description: "This is a plugin for tracking payments." }, 'must not start with "This is a plugin"'],
    [{ ...validManifest, description: "Tracks payments \u{1F5C3}. No emoji." }, "must not contain emoji"],
    [{ ...validManifest, minAppVersion: "1.13" }, "minAppVersion must be numeric"],
    [{ ...validManifest, version: "0.11.0-beta.1" }, "version must be numeric"],
    [{ ...validManifest, isDesktopOnly: "true" }, "isDesktopOnly must be a boolean"],
    [{ ...validManifest, fundingUrl: "http://example.com/u" }, "fundingUrl must use https"],
  ])("rejects %# : %j", (manifest, message) => {
    const { result, output } = runManifestCheck(manifest);
    expect(result.status).not.toBe(0);
    expect(output).toContain(message);
  });
});
