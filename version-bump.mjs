import { readFileSync, writeFileSync } from "node:fs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const packageJson = readJson("package.json");
const manifest = readJson("manifest.json");
const versions = readJson("versions.json");

manifest.version = packageJson.version;
versions[packageJson.version] = manifest.minAppVersion;

writeJson("manifest.json", manifest);
writeJson("versions.json", versions);

