#!/usr/bin/env node
// Keep extension/manifest.json's version in lockstep with package.json.
//
// package.json is the single source of truth for the version. The manifest
// stays committed but is derived from it — bump in package.json only.
//
//   node scripts/sync-version.mjs           # write package.json version → manifest
//   node scripts/sync-version.mjs --check   # fail (exit 1) if they differ; write nothing
//
// `prebuild` runs the writing mode so every `npm run build` stamps the manifest.
// `check:version` runs --check so CI can refuse to ship on drift.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = resolve(repoRoot, "package.json");
const manifestPath = resolve(repoRoot, "extension/manifest.json");

const checkOnly = process.argv.includes("--check");

const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
const manifestRaw = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestRaw);

const wantVersion = pkg.version;
if (!wantVersion) {
  throw new Error(`package.json has no version field`);
}

if (checkOnly) {
  if (manifest.version !== wantVersion) {
    console.error(
      `version drift: package.json is ${wantVersion} but extension/manifest.json is ${manifest.version}.\n` +
        `Run \`node scripts/sync-version.mjs\` (or \`npm run build\`) to resync.`,
    );
    process.exit(1);
  }
  console.log(`version ok (${wantVersion}) — package.json and manifest in sync`);
} else {
  if (manifest.version === wantVersion) {
    console.log(`manifest version already ${wantVersion} — nothing to do`);
  } else {
    // Preserve formatting: swap only the version string in-place so the
    // committed manifest diff is minimal and key order is untouched.
    const updated = manifestRaw.replace(
      /("version"\s*:\s*)"[^"]*"/,
      `$1"${wantVersion}"`,
    );
    if (updated === manifestRaw || JSON.parse(updated).version !== wantVersion) {
      throw new Error(`failed to rewrite version in extension/manifest.json`);
    }
    await writeFile(manifestPath, updated);
    console.log(
      `synced extension/manifest.json version ${manifest.version} → ${wantVersion}`,
    );
  }
}
