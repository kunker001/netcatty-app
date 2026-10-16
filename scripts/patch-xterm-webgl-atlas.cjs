#!/usr/bin/env node
/* global process, console */
/**
 * Verify @xterm/addon-webgl carries the upstream glyph-atlas safety fixes.
 *
 * Netcatty previously backported these as local string patches. With
 * @xterm/addon-webgl >= 0.20.0-beta.291 they ship upstream:
 *
 * - xtermjs/xterm.js#6055 — shared atlas: clearTexture bumps _pageLayoutVersion
 * - xtermjs/xterm.js#5987 — no generateMipmap on atlas upload (LINEAR filters)
 * - xtermjs/xterm.js#6043 — _evictAllPages / maxAtlasPages capacity handling
 *
 * This script no longer mutates node_modules. It only fails closed when the
 * pinned package is missing any of the above, so a silent downgrade cannot
 * reintroduce garbled split-pane / mipmap / overflow bugs.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const TARGET_FILES = [
  "node_modules/@xterm/addon-webgl/lib/addon-webgl.mjs",
  "node_modules/@xterm/addon-webgl/lib/addon-webgl.js",
];

/** Upstream #6055: clearTexture bumps page layout version so shared atlases rebuild. */
function hasUpstreamSharedAtlasClearFix(source) {
  return (
    source.includes("_pageLayoutVersion") &&
    /clearTexture\(\)\{[^}]*_pageLayoutVersion\+\+/.test(source)
  );
}

/** Upstream #5987: atlas texture upload must not call generateMipmap. */
function hasUpstreamMipmapFix(source) {
  return !source.includes(".generateMipmap(");
}

/** Upstream #6043: capacity eviction when atlas pages overflow texture slots. */
function hasUpstreamCapacityFix(source) {
  return source.includes("_evictAllPages()") && source.includes("maxAtlasPages");
}

let webglVersion = "";
try {
  const packageJson = path.resolve(
    process.cwd(),
    "node_modules/@xterm/addon-webgl/package.json",
  );
  webglVersion = JSON.parse(fs.readFileSync(packageJson, "utf8")).version || "";
} catch {
  // Handled below when files are missing.
}

const results = { ok: 0, missing: 0 };

for (const file of TARGET_FILES) {
  const abs = path.resolve(process.cwd(), file);
  let source;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch {
    console.warn(`[patch-xterm-webgl-atlas] ERROR: not found: ${file}`);
    results.missing++;
    continue;
  }

  const checks = [
    {
      name: "shared-atlas clear (#6055)",
      ok: hasUpstreamSharedAtlasClearFix(source),
      hint: "need clearTexture() { ... _pageLayoutVersion++ }",
    },
    {
      name: "no atlas mipmaps (#5987)",
      ok: hasUpstreamMipmapFix(source),
      hint: "must not call gl.generateMipmap on atlas upload",
    },
    {
      name: "atlas capacity eviction (#6043)",
      ok: hasUpstreamCapacityFix(source),
      hint: "need _evictAllPages() and maxAtlasPages",
    },
  ];

  const failed = checks.filter((check) => !check.ok);
  if (failed.length === 0) {
    results.ok++;
    continue;
  }

  results.missing++;
  for (const check of failed) {
    console.warn(
      `[patch-xterm-webgl-atlas] ERROR: missing ${check.name} in ${file} ` +
        `(${check.hint}). Upgrade @xterm/addon-webgl ` +
        `(current: ${webglVersion || "unknown"}).`,
    );
  }
}

console.log(
  `[patch-xterm-webgl-atlas] verify version=${webglVersion || "unknown"} ` +
    `ok=${results.ok} missing=${results.missing}`,
);

if (results.missing > 0) process.exitCode = 1;
