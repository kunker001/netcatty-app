import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("gpu tab keeps loading while accelerator query is pending", () => {
  const source = readFileSync(new URL("./GpuManagerTab.tsx", import.meta.url), "utf8");
  assert.match(source, /setGpuListPending\(true\)/);
  assert.match(source, /if \(result\.pending\)/);
  assert.match(source, /isRefreshActive = loading \|\| gpuListPending/);
  assert.match(source, /if \(!data\)/);
  assert.doesNotMatch(
    source,
    /if \(result\.pending\) return null;\s*\n\s*if \(!result\.success\)/,
  );
});

test("gpu tab still renders compute processes when device list is empty", () => {
  const source = readFileSync(new URL("./GpuManagerTab.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!devices\.length && !processes\.length\)/);
  assert.match(source, /processes\.map\(\(process\) =>/);
});

test("gpu tab passes null utilization to ResourceBar instead of zero", () => {
  const source = readFileSync(new URL("./GpuManagerTab.tsx", import.meta.url), "utf8");
  assert.match(source, /value=\{util\}/);
  assert.match(source, /value=\{memPct\}/);
  assert.doesNotMatch(source, /value=\{util \?\? 0\}/);
  assert.doesNotMatch(source, /value=\{memPct \?\? 0\}/);
});

test("gpu tab keeps a compact sparkline history like overview/nvtop charts", () => {
  const source = readFileSync(new URL("./GpuManagerTab.tsx", import.meta.url), "utf8");
  assert.match(source, /HISTORY_LIMIT/);
  assert.match(source, /GpuSparkline/);
  assert.match(source, /historyByDevice/);
  assert.match(source, /setHistoryByDevice/);
  // Sparklines sit under the resource bars, not in a side column.
  assert.doesNotMatch(source, /grid-cols-\[minmax\(0,1fr\)_72px\]/);
  assert.match(source, /grid grid-cols-2 gap-x-3/);
});

test("gpu device card uses vendor vector badges", () => {
  const source = readFileSync(new URL("./GpuManagerTab.tsx", import.meta.url), "utf8");
  const badgeSource = readFileSync(new URL("./GpuVendorBadge.tsx", import.meta.url), "utf8");
  assert.match(source, /GpuVendorBadge/);
  assert.match(source, /vendor=\{device\.vendor\}/);
  // Process rows share the same display helper (no deleted vendorLabel).
  assert.match(source, /vendorDisplayLabel\(process\.vendor/);
  assert.doesNotMatch(source, /vendorLabel\(/);
  assert.match(badgeSource, /NVIDIA_PATH/);
  assert.match(badgeSource, /HUAWEI_PATH/);
  assert.match(badgeSource, /vendor === 'nvidia'/);
  assert.match(badgeSource, /vendor === 'ascend'/);
});

test("resource bar animates width and uses load-aware tones", () => {
  const source = readFileSync(new URL("./ResourceBar.tsx", import.meta.url), "utf8");
  assert.match(source, /transition-\[width,background-color\]/);
  assert.match(source, /bg-amber-500/);
  assert.match(source, /bg-destructive/);
});
