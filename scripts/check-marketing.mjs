#!/usr/bin/env node
// Verify relative href/src in marketing/*.html resolve to real files.

import { access, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const marketing = resolve(repoRoot, "marketing");

const htmls = await collectHtml(marketing);
const broken = [];
for (const file of htmls) {
  const html = await readFile(file, "utf8");
  for (const ref of extractRefs(html)) {
    if (isExternal(ref)) continue;
    const cleaned = ref.split("#")[0].split("?")[0];
    if (!cleaned) continue;
    const target = resolve(dirname(file), cleaned);
    try {
      await access(target);
    } catch {
      broken.push({ file, ref, target });
    }
  }
}
if (broken.length > 0) {
  const lines = broken.map(
    (b) =>
      `  ${b.file.replace(`${marketing}/`, "")} → ${b.ref} (resolved to ${b.target}, not found)`,
  );
  throw new Error(`broken asset references in marketing/:\n${lines.join("\n")}`);
}

console.log(`marketing/ ok (${htmls.length} HTML files, all refs resolve)`);

async function collectHtml(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) out.push(...(await collectHtml(full)));
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
}

function extractRefs(html) {
  const refs = [];
  for (const m of html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)) refs.push(m[1]);
  for (const m of html.matchAll(/(?:href|src)\s*=\s*'([^']+)'/g)) refs.push(m[1]);
  return refs;
}

function isExternal(ref) {
  return (
    ref.startsWith("http://") ||
    ref.startsWith("https://") ||
    ref.startsWith("//") ||
    ref.startsWith("mailto:") ||
    ref.startsWith("tel:") ||
    ref.startsWith("data:") ||
    ref.startsWith("#")
  );
}
