"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createThemeContributionNativeImage,
  resolveApplicationMenuIconReference,
} = require("./themeContributionIcon.cjs");

test("native application menus render declared host-owned theme icons", () => {
  const urls = [];
  const image = { isEmpty: () => false };
  const nativeImage = {
    createFromDataURL(url) { urls.push(url); return image; },
  };
  assert.equal(createThemeContributionNativeImage(nativeImage, { kind: "theme", name: "terminal" }, true), image);
  const svg = Buffer.from(urls[0].split(",")[1], "base64").toString("utf8");
  assert.match(svg, /stroke="white"/);
  assert.match(svg, /<rect/);
});

test("application menus inherit command icons unless the menu overrides them", () => {
  const commandIcon = { kind: "theme", name: "play" };
  const menuIcon = { kind: "theme", name: "terminal" };
  const commands = new Map([["com.example.run", { icon: commandIcon }]]);
  assert.equal(resolveApplicationMenuIconReference({ command: "com.example.run" }, commands), commandIcon);
  assert.equal(resolveApplicationMenuIconReference({ command: "com.example.run", icon: menuIcon }, commands), menuIcon);
});
