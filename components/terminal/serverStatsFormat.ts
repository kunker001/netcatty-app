import {
  aggregateMountedDiskUsage,
  type MountedDiskUsage,
} from "../../domain/systemDiskUsage";

interface TerminalDiskStats {
  diskUsed: number | null;
  diskTotal: number | null;
  diskPercent: number | null;
  disks: readonly MountedDiskUsage[];
}

export interface TerminalDiskSummary {
  used: number | null;
  total: number | null;
  percent: number | null;
}

export function formatDiskCapacityGb(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** Capacity units, ascending from the GiB the collectors report in. */
const DISK_CAPACITY_UNITS = ["G", "T", "P"] as const;

/** Pick the largest unit that keeps a GiB value at or above 1. */
export function resolveDiskCapacityUnit(valueGb: number): { unit: string; divisor: number } {
  let divisor = 1;
  let index = 0;
  while (
    Math.abs(valueGb) / divisor >= 1024
    && index < DISK_CAPACITY_UNITS.length - 1
  ) {
    divisor *= 1024;
    index += 1;
  }
  return { unit: DISK_CAPACITY_UNITS[index], divisor };
}

/**
 * Render a used/total pair, both reported in GiB.
 *
 * Each side is scaled independently so a mostly-empty multi-terabyte pool keeps
 * its used figure — `136.37G/6.93T` rather than the `0.13/6.93T` a total-driven
 * unit would produce, or the unreadable `136.37/7096.47G` of a fixed one. When
 * both land in the same unit the suffix is written once, keeping the familiar
 * `71.12/878.15G` shape for ordinary disks.
 */
export function formatDiskCapacityRange(usedGb: number, totalGb: number): string {
  const used = resolveDiskCapacityUnit(usedGb);
  const total = resolveDiskCapacityUnit(totalGb);
  const usedText = formatDiskCapacityGb(usedGb / used.divisor);
  const totalText = formatDiskCapacityGb(totalGb / total.divisor);
  return used.unit === total.unit
    ? `${usedText}/${totalText}${total.unit}`
    : `${usedText}${used.unit}/${totalText}${total.unit}`;
}

export function resolveTerminalDiskSummary(
  stats: TerminalDiskStats,
): TerminalDiskSummary {
  const mountedUsage = aggregateMountedDiskUsage(stats.disks);
  if (mountedUsage) {
    return {
      used: mountedUsage.used,
      total: mountedUsage.total,
      percent: Math.round(mountedUsage.percent),
    };
  }

  return {
    used: stats.diskUsed,
    total: stats.diskTotal,
    percent: stats.diskPercent,
  };
}
