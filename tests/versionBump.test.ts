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

/** Run version-bump.mjs in a fresh temp project; each case keeps its own directory. */
function runVersionBump(files: { package: string; manifest: object; versions: object }) {
  const directory = mkdtempSync(join(tmpdir(), "subscription-calculator-version-"));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, "package.json"), JSON.stringify({ version: files.package }));
  const manifestText = JSON.stringify(files.manifest);
  writeFileSync(join(directory, "manifest.json"), manifestText);
  const versionsText = JSON.stringify(files.versions);
  writeFileSync(join(directory, "versions.json"), versionsText);
  const result = spawnSync(process.execPath, [versionBumpScript], { cwd: directory, encoding: "utf8" });
  return {
    result,
    manifestText,
    versionsText,
    read: (file: string) => readFileSync(join(directory, file), "utf8"),
  };
}

describe("version bump metadata", () => {
  it("ignores future compatibility checkpoints when updating an earlier release", () => {
    const versions = { "0.20.0": "1.14.0", "0.1.0": "1.5.0", "0.10.0": "1.13.0" };
    const { result, read } = runVersionBump({
      package: "0.11.0",
      manifest: { version: "0.10.1", minAppVersion: "1.13.0" },
      versions,
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(read("versions.json"))).toEqual(versions);
  });

  it.each(["0.11.0-beta.1", "broken", "0.11", "01.2.3"])(
    "rejects invalid plugin version %s without changing compatibility files",
    (version) => {
      const { result, manifestText, versionsText, read } = runVersionBump({
        package: version,
        manifest: { version: "0.10.1", minAppVersion: "1.13.0" },
        versions: { "0.10.0": "1.13.0" },
      });
      expect(result.status).not.toBe(0);
      expect(read("manifest.json")).toBe(manifestText);
      expect(read("versions.json")).toBe(versionsText);
    }
  );

  it("updates the manifest without adding a compatibility checkpoint", () => {
    const versions = { "0.1.0": "1.5.0" };
    const { result, read } = runVersionBump({
      package: "0.9.9",
      manifest: { version: "0.9.8", minAppVersion: "1.5.0" },
      versions,
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(read("manifest.json"))).toEqual({
      version: "0.9.9",
      minAppVersion: "1.5.0",
    });
    expect(JSON.parse(read("versions.json"))).toEqual(versions);
  });

  it("adds one compatibility checkpoint when the Obsidian minimum changes", () => {
    const { result, read } = runVersionBump({
      package: "0.10.0",
      manifest: { version: "0.9.8", minAppVersion: "1.13.0" },
      versions: { "0.1.0": "1.5.0" },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(read("versions.json"))).toEqual({
      "0.1.0": "1.5.0",
      "0.10.0": "1.13.0",
    });
  });
});
