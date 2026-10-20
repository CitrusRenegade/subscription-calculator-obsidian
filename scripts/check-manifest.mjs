import { readFileSync } from "node:fs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const manifest = readJson("manifest.json");

const problems = [];
function check(condition, problem) {
  if (!condition) problems.push(problem);
}

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

check(typeof manifest.id === "string" && /^[a-z0-9-]+$/.test(manifest.id),
  "id must be lowercase letters, digits and hyphens.");
check(typeof manifest.name === "string" && manifest.name.trim().length > 0,
  "name must be a non-empty string.");
check(typeof manifest.author === "string" && manifest.author.trim().length > 0,
  "author must be a non-empty string.");
check(typeof manifest.version === "string" && versionPattern.test(manifest.version),
  "version must be numeric x.y.z.");
check(typeof manifest.minAppVersion === "string" && versionPattern.test(manifest.minAppVersion),
  "minAppVersion must be numeric x.y.z.");

if (typeof manifest.description === "string") {
  check(manifest.description.trim().length > 0,
    "description must be a non-empty string.");
  check(manifest.description.length <= 250,
    `description must be 250 characters or fewer, got ${manifest.description.length}.`);
  check(manifest.description.endsWith("."),
    "description must end with a period.");
  check(!/^this is a plugin/i.test(manifest.description),
    'description must not start with "This is a plugin".');
  check(!/\p{Extended_Pictographic}/u.test(manifest.description),
    "description must not contain emoji.");
} else {
  problems.push("description must be a string.");
}

check(!("isDesktopOnly" in manifest) || typeof manifest.isDesktopOnly === "boolean",
  "isDesktopOnly must be a boolean.");
check(!("fundingUrl" in manifest) || /^https:\/\//.test(manifest.fundingUrl),
  "fundingUrl must use https.");

if (problems.length > 0) {
  for (const problem of problems) console.error(`manifest.json: ${problem}`);
  process.exit(1);
}
console.log("manifest.json: OK");
