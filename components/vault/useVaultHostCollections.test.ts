import test from "node:test";
import assert from "node:assert/strict";

import type { Host } from "../../types.ts";
import { filterVaultHostsForDisplay } from "./useVaultHostCollections.tsx";

const host = (id: string, label: string, group = ""): Host => ({
  id,
  label,
  hostname: `${id}.example.com`,
  username: "root",
  port: 22,
  os: "linux",
  tags: [],
  createdAt: 1,
  group,
});

test("root host search can still show matches from any group", () => {
  const matchingHost = host("prod-db", "Prod DB", "Production");

  const result = filterVaultHostsForDisplay({
    filteredHosts: [matchingHost],
    searchTerm: "prod",
    selectedGroupPath: null,
    showOnlyUngroupedHostsInRoot: true,
  });

  assert.deepEqual(result.map((item) => item.id), ["prod-db"]);
});

test("selected group view does not show search matches from another group", () => {
  const matchingHostInOtherGroup = host("prod-db", "Prod DB", "Production");

  const result = filterVaultHostsForDisplay({
    filteredHosts: [matchingHostInOtherGroup],
    searchTerm: "prod",
    selectedGroupPath: "Staging",
    showOnlyUngroupedHostsInRoot: false,
  });

  assert.deepEqual(result, []);
});

test("selected General group includes ungrouped hosts while search is active", () => {
  const ungroupedHost = host("local", "Local");

  const result = filterVaultHostsForDisplay({
    filteredHosts: [ungroupedHost],
    searchTerm: "local",
    selectedGroupPath: "General",
    showOnlyUngroupedHostsInRoot: false,
  });

  assert.deepEqual(result.map((item) => item.id), ["local"]);
});
