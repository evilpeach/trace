import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "node:test";
import { checkVersions, setVersion } from "./release-version.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const files = ["package.json", "package-lock.json", "apps/trace/package.json", "packages/report-contract/package.json", "apps/trace/src-tauri/tauri.conf.json", "apps/trace/src-tauri/Cargo.toml", "apps/trace/src-tauri/Cargo.lock"];
let fixture;
beforeEach(() => {
  fixture = mkdtempSync(resolve(tmpdir(), "trace-version-test-"));
  for (const path of files) cpSync(resolve(repository, path), resolve(fixture, path), { recursive: true });
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

test("synchronizes all manifests and locks without changing dependencies", () => {
  const before = JSON.parse(readFileSync(resolve(fixture, "package-lock.json"), "utf8"));
  const cargoBefore = readFileSync(resolve(fixture, "apps/trace/src-tauri/Cargo.lock"), "utf8");
  assert.equal(setVersion("0.0.2", fixture), "0.0.2");
  assert.equal(checkVersions(fixture, "v0.0.2"), "0.0.2");
  const after = JSON.parse(readFileSync(resolve(fixture, "package-lock.json"), "utf8"));
  for (const [key, value] of Object.entries(before.packages)) {
    if (key.startsWith("node_modules/")) assert.deepEqual(after.packages[key], value);
  }
  assert.equal(readFileSync(resolve(fixture, "apps/trace/src-tauri/Cargo.lock"), "utf8"), cargoBefore.replace(/(\[\[package\]\]\nname = "trace"\nversion = ")[^"]+/, "$10.0.2"));
});

test("rejects invalid versions without modifying files", () => {
  const original = files.map((path) => readFileSync(resolve(fixture, path), "utf8"));
  for (const version of ["v0.0.2", "01.0.0", "0.0.2-beta", "0.0", "1.2.3\n", "1.2.3; echo bad"]) {
    assert.throws(() => setVersion(version, fixture), /stable MAJOR.MINOR.PATCH/);
  }
  assert.deepEqual(files.map((path) => readFileSync(resolve(fixture, path), "utf8")), original);
});

test("blocks a tag that does not match the application", () => {
  setVersion("0.0.2", fixture);
  assert.throws(() => checkVersions(fixture, "v0.0.3"), /Release tag must be v0.0.2/);
  assert.throws(() => checkVersions(fixture, "main"), /Release tag must be/);
});

test("detects version drift", () => {
  const path = resolve(fixture, "apps/trace/package.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.version = "9.9.9";
  writeFileSync(path, JSON.stringify(manifest));
  assert.throws(() => checkVersions(fixture), /apps\/trace\/package.json: expected/);
});
