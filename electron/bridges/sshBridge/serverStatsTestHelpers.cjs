"use strict";

function selectServerStatsFixtureOutput(command, stdout) {
  const parts = String(stdout || "").split("|");
  const diskPart = parts.find((part) => part.startsWith("DISKS:")) || "DISKS:";
  const baseOutput = parts.filter((part) => !part.startsWith("DISKS:")).join("|");
  if (command.includes('echo "DISKS:$disks"')) return diskPart;
  if (command.includes("NC_LATENCY_MARK") && !baseOutput.includes("NC_LATENCY_MARK")) {
    return `NC_LATENCY_MARK|${baseOutput}`;
  }
  return baseOutput;
}

module.exports = { selectServerStatsFixtureOutput };
