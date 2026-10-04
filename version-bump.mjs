import { readFileSync, writeFileSync } from "node:fs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function validateVersion(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Expected numeric x.y.z version, got ${String(value)}.`);
  }
  if (!value.split(".").every((part) => Number.isSafeInteger(Number(part)))) {
    throw new Error(`Version components must be safe integers: ${value}.`);
  }
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function getLatestMinimumAppVersion(versions, targetVersion) {
  const latestVersion = Object.keys(versions)
    .filter((version) => compareVersions(version, targetVersion) <= 0)
    .sort(compareVersions)
    .at(-1);
  return latestVersion ? versions[latestVersion] : undefined;
}

const packageJson = readJson("package.json");
const manifest = readJson("manifest.json");
const versions = readJson("versions.json");

validateVersion(packageJson.version);
validateVersion(manifest.minAppVersion);
for (const [pluginVersion, minimumAppVersion] of Object.entries(versions)) {
  validateVersion(pluginVersion);
  validateVersion(minimumAppVersion);
}

manifest.version = packageJson.version;
if (getLatestMinimumAppVersion(versions, packageJson.version) !== manifest.minAppVersion) {
  versions[packageJson.version] = manifest.minAppVersion;
  writeJson("versions.json", versions);
}

writeJson("manifest.json", manifest);
