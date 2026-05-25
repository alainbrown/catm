// Generates the PNG icon set from public/favicon.svg.
//
// - icon-192.png, icon-512.png        — standard "any" purpose
// - icon-maskable-512.png             — same art on a solid background with
//                                       ~20% safe-zone padding (the maskable
//                                       spec reserves the outer 10% per side)
// - apple-touch-icon.png (180×180)    — iOS Add-to-Home-Screen
//
// Run via `npm run icons`. Commit the outputs.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");
const extensionIconsDir = resolve(here, "..", "extension", "icons");

const svg = await readFile(resolve(publicDir, "favicon.svg"));

// Brand background for the maskable + apple-touch variants. Matches the
// gradient stop colour of the mark — keeps it on-brand on iOS where Safari
// otherwise composites onto white.
const BG = { r: 91, g: 108, b: 255, alpha: 1 };

async function plain(size, filename) {
  await sharp(svg, { density: 512 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(resolve(publicDir, filename));
}

async function extensionIcon(size) {
  await sharp(svg, { density: 512 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(resolve(extensionIconsDir, `icon-${size}.png`));
}

async function maskable(size, filename, background) {
  // Inner art fills 60% of the canvas — leaves a 20% margin on each side,
  // comfortably inside the maskable safe zone (innermost 80% diameter).
  const inner = Math.round(size * 0.6);
  const art = await sharp(svg, { density: 512 })
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const offset = Math.round((size - inner) / 2);
  await sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: art, top: offset, left: offset }])
    .png()
    .toFile(resolve(publicDir, filename));
}

await Promise.all([
  plain(192, "icon-192.png"),
  plain(512, "icon-512.png"),
  maskable(512, "icon-maskable-512.png", BG),
  maskable(180, "apple-touch-icon.png", BG),
  // Chrome MV3 extension icons — sizes match extension/manifest.json.
  extensionIcon(48),
  extensionIcon(128),
  extensionIcon(512),
]);

// Also write a tiny build manifest so we can sanity-check sizes from CI.
const sizes = await Promise.all(
  ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"].map(
    async (name) => {
      const buf = await readFile(resolve(publicDir, name));
      return [name, buf.length];
    },
  ),
);
await writeFile(
  resolve(publicDir, ".icons.json"),
  `${JSON.stringify(Object.fromEntries(sizes), null, 2)}\n`,
);
console.log("icons:", Object.fromEntries(sizes));
