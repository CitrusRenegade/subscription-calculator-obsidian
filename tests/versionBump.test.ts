import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const temporaryDirectories: string[] = [];
const versionBumpScript = fileURLToPath(
  new URL("../version-bump.mjs", import.meta.url)
);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("version bump metadata", () => {
  it("ignores future compatibility checkpoints when updating an earlier release", () => {
    const directory = mkdtempSync(join(tmpdir(), "subscription-calculator-version-"));
    temporaryDirectories.push(directory);
    const versions = { "0.20.0": "1.14.0", "0.1.0": "1.5.0", "0.10.0": "1.13.0" };
    writeFileSync(join(directory, "package.json"), JSON.stringify({ version: "0.11.0" }));
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ version: "0.10.1", minAppVersion: "1.13.0" }));
    writeFileSync(join(directory, "versions.json"), JSON.stringify(versions));
    const result = spawnSync(process.execPath, [versionBumpScript], { cwd: directory, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(directory, "versions.json"), "utf8"))).toEqual(versions);
  });
  it.each(["0.11.0-beta.1", "broken", "0.11", "01.2.3"])(
    "rejects invalid plugin version %s without changing compatibility files",
    (version) => {
      const directory = mkdtempSync(join(tmpdir(), "subscription-calculator-version-"));
      temporaryDirectories.push(directory);
      const manifestText = JSON.stringify({ version: "0.10.1", minAppVersion: "1.13.0" });
      const versionsText = JSON.stringify({ "0.10.0": "1.13.0" });
      writeFileSync(join(directory, "package.json"), JSON.stringify({ version }));
      writeFileSync(join(directory, "manifest.json"), manifestText);
      writeFileSync(join(directory, "versions.json"), versionsText);
      const result = spawnSync(process.execPath, [versionBumpScript], { cwd: directory, encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(readFileSync(join(directory, "manifest.json"), "utf8")).toBe(manifestText);
      expect(readFileSync(join(directory, "versions.json"), "utf8")).toBe(versionsText);
    }
  );
  it("updates the manifest without adding a compatibility checkpoint", () => {
    const directory = mkdtempSync(join(tmpdir(), "subscription-calculator-version-"));
    temporaryDirectories.push(directory);
    const versions = {
      "0.1.0": "1.5.0",
    };
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ version: "0.9.9" })
    );
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ version: "0.9.8", minAppVersion: "1.5.0" })
    );
    writeFileSync(join(directory, "versions.json"), JSON.stringify(versions));

    const result = spawnSync(process.execPath, [versionBumpScript], {
      cwd: directory,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"))).toEqual({
      version: "0.9.9",
      minAppVersion: "1.5.0",
    });
    expect(JSON.parse(readFileSync(join(directory, "versions.json"), "utf8"))).toEqual(
      versions
    );
  });

  it("adds one compatibility checkpoint when the Obsidian minimum changes", () => {
    const directory = mkdtempSync(join(tmpdir(), "subscription-calculator-version-"));
    temporaryDirectories.push(directory);
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ version: "0.10.0" })
    );
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ version: "0.9.8", minAppVersion: "1.13.0" })
    );
    writeFileSync(
      join(directory, "versions.json"),
      JSON.stringify({ "0.1.0": "1.5.0" })
    );

    const result = spawnSync(process.execPath, [versionBumpScript], {
      cwd: directory,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(directory, "versions.json"), "utf8"))).toEqual({
      "0.1.0": "1.5.0",
      "0.10.0": "1.13.0",
    });
  });
});
