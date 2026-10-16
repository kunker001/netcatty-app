import test from "node:test";
import assert from "node:assert/strict";

import {
  formatDiskCapacityGb,
  formatDiskCapacityRange,
  resolveTerminalDiskSummary,
} from "./serverStatsFormat.ts";

test("disk capacity uses at most two decimal places", () => {
  assert.equal(formatDiskCapacityGb(5.964138), "5.96");
  assert.equal(formatDiskCapacityGb(28.893616), "28.89");
  assert.equal(formatDiskCapacityGb(0.005907), "0.01");
  assert.equal(formatDiskCapacityGb(10), "10");
  assert.equal(formatDiskCapacityGb(10.5), "10.5");
});

test("disk capacity stays in G below a terabyte", () => {
  assert.equal(formatDiskCapacityRange(71.12, 878.15), "71.12/878.15G");
  assert.equal(formatDiskCapacityRange(0.01, 0.5), "0.01/0.5G");
  // 1023 GiB is still the largest value rendered in G.
  assert.equal(formatDiskCapacityRange(1, 1023), "1/1023G");
});

test("disk capacity switches to T once a value reaches a terabyte", () => {
  // Both sides in terabytes: one shared suffix.
  assert.equal(formatDiskCapacityRange(8807.55, 118736.4), "8.6/115.95T");
  assert.equal(formatDiskCapacityRange(2048, 4096), "2/4T");
});

test("disk capacity keeps the used figure when the sides differ in scale", () => {
  // A total-driven unit would render these as 0.13/6.93T and 0/6.93T,
  // discarding how much is actually in use.
  assert.equal(formatDiskCapacityRange(136.37, 7096.47), "136.37G/6.93T");
  assert.equal(formatDiskCapacityRange(3.25, 7096.47), "3.25G/6.93T");
  assert.equal(formatDiskCapacityRange(1, 1024), "1G/1T");
});

test("disk capacity switches to P for petabyte-scale pools", () => {
  assert.equal(formatDiskCapacityRange(1_048_576, 2_097_152), "1/2P");
  assert.equal(formatDiskCapacityRange(512, 2_097_152), "512G/2P");
});

test("terminal disk summary totals every mounted filesystem", () => {
  const summary = resolveTerminalDiskSummary({
    diskUsed: 9.285,
    diskTotal: 899.763855,
    diskPercent: 2,
    disks: [
      { capacityKey: "/dev/sdb4", mountPoint: "/", used: 9.285, total: 899.763855 },
      { capacityKey: "/dev/sdb2", mountPoint: "/boot", used: 0.070892, total: 0.89909 },
      { capacityKey: "/dev/sdb1", mountPoint: "/boot/efi", used: 0.008568, total: 0.474628 },
      { capacityKey: "/dev/sda1", mountPoint: "/var", used: 215.84272, total: 1862.105923 },
    ],
  });

  assert.equal(summary.used === null ? null : formatDiskCapacityGb(summary.used), "225.21");
  assert.equal(summary.total === null ? null : formatDiskCapacityGb(summary.total), "2763.24");
  assert.equal(summary.percent, 8);
});

test("terminal disk summary preserves legacy root-only stats as a fallback", () => {
  assert.deepEqual(
    resolveTerminalDiskSummary({
      diskUsed: 12,
      diskTotal: 100,
      diskPercent: 12,
      disks: [],
    }),
    { used: 12, total: 100, percent: 12 },
  );
});
