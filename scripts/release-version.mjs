import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const manifests = ["package.json", "apps/trace/package.json", "packages/report-contract/package.json", "apps/trace/src-tauri/tauri.conf.json"];
const workspaceKeys = ["", "apps/trace", "packages/report-contract"];
const cargoFiles = [
  ["apps/trace/src-tauri/Cargo.toml", /(\[package\][\s\S]*?\nversion = ")([^"]+)(")/],
  ["apps/trace/src-tauri/Cargo.lock", /(\[\[package\]\]\nname = "trace"\nversion = ")([^"]+)(")/],
];

function validateVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Expected a stable MAJOR.MINOR.PATCH version, received: ${version}`);
  }
}

function read(root, path) {
  return readFileSync(resolve(root, path), "utf8");
}

function entries(root) {
  const values = manifests.map((path) => [path, JSON.parse(read(root, path)).version]);
  const lock = JSON.parse(read(root, "package-lock.json"));
  values.push(["package-lock.json", lock.version]);
  for (const key of workspaceKeys) values.push([`package-lock.json:${key || "root"}`, lock.packages[key].version]);
  for (const [path, pattern] of cargoFiles) {
    const match = read(root, path).match(pattern);
    if (!match) throw new Error(`Cannot find Trace's version in ${path}`);
    values.push([path, match[2]]);
  }
  return values;
}

export function checkVersions(root = repository, tag) {
  const values = entries(root);
  const expected = values[0][1];
  validateVersion(expected);
  for (const [path, value] of values) {
    if (value !== expected) throw new Error(`${path}: expected ${expected}, received ${value}`);
  }
  if (tag !== undefined && tag !== `v${expected}`) {
    throw new Error(`Release tag must be v${expected}, received: ${tag}`);
  }
  return expected;
}

export function setVersion(version, root = repository) {
  validateVersion(version);
  // Read and validate the complete inventory before changing any files.
  entries(root);
  const updates = manifests.map((path) => {
    const json = JSON.parse(read(root, path));
    json.version = version;
    return [path, `${JSON.stringify(json, null, 2)}\n`];
  });
  const lock = JSON.parse(read(root, "package-lock.json"));
  lock.version = version;
  for (const key of workspaceKeys) lock.packages[key].version = version;
  updates.push(["package-lock.json", `${JSON.stringify(lock, null, 2)}\n`]);
  for (const [path, pattern] of cargoFiles) {
    updates.push([path, read(root, path).replace(pattern, (_, before, _old, after) => `${before}${version}${after}`)]);
  }
  for (const [path, content] of updates) writeFileSync(resolve(root, path), content);
  return checkVersions(root);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--check" && args.length <= 2) {
      console.log(`Trace ${checkVersions(repository, args[1])}: versions match.`);
    } else if (args.length === 1) {
      console.log(`Trace version set to ${setVersion(args[0])}.`);
    } else {
      throw new Error("Usage: node scripts/release-version.mjs <version> | --check [vTAG]");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
