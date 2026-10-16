"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseSystemctlListUnits,
  parseServiceList,
  sanitizeUnitName,
} = require("./serviceOps.cjs");

test("sanitizeUnitName rejects shell metacharacters", () => {
  assert.equal(sanitizeUnitName("nginx.service"), "nginx.service");
  assert.equal(sanitizeUnitName("user@1000.service"), "user@1000.service");
  assert.equal(sanitizeUnitName("evil;rm -rf /"), null);
  assert.equal(sanitizeUnitName(""), null);
});

test("parseSystemctlListUnits reads plain list-units rows", () => {
  const sample = `
  nginx.service                loaded active   running A high performance web server
● broken.service               loaded failed   failed  Broken unit
  cron.service                 loaded inactive dead    Regular background program processing daemon
`;
  const units = parseSystemctlListUnits(sample, "system");
  assert.equal(units.length, 3);
  assert.equal(units[0].name, "nginx.service");
  assert.equal(units[0].activeState, "active");
  assert.equal(units[1].name, "broken.service");
  assert.equal(units[1].activeState, "failed");
  assert.equal(units[2].activeState, "inactive");
});

test("parseSystemctlListUnits keeps units with an empty description", () => {
  const sample = `
● broken.service loaded failed failed
  quiet.service  loaded active  running
`;
  const units = parseSystemctlListUnits(sample, "system");
  assert.equal(units.length, 2);
  assert.equal(units.find((u) => u.name === "broken.service")?.description, "");
  assert.equal(units.find((u) => u.name === "quiet.service")?.activeState, "active");
});

test("parseServiceList merges system and user scopes and sorts failed first", () => {
  const stdout = `
__NC_SERVICES_BEGIN__
__NC_SYSTEM__
broken.service loaded failed failed Broken
nginx.service loaded active running Nginx
__NC_USER__
podman.service loaded active running Podman
nginx.service loaded active running User nginx
__NC_SERVICES_END__
`;
  const units = parseServiceList(stdout);
  assert.equal(units[0].name, "broken.service");
  assert.equal(units.find((u) => u.name === "nginx.service")?.scope, "system");
  assert.equal(units.find((u) => u.name === "podman.service")?.scope, "user");
});
