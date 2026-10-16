"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  detectSpamComment,
  extractDangerousFiles,
  extractZipFiles,
  isGitHubUserAttachment,
} = require("./spam-comment-filter.cjs");

test("flags the fake Netcatty patch spam pattern", () => {
  const result = detectSpamComment({
    authorAssociation: "NONE",
    userType: "User",
    body: "[netcatty_patch.zip](https://example.com/netcatty_patch.zip)\n\nMan, that terminal rendering bug is such a pain. It looks like the sftp module is tripping over the encoding when it tries to sync the current path. I found a quick patch that fixes the character mapping in the backend so those black boxes finally disappear.",
  });

  assert.equal(result.spam, true);
});

test("flags fake patch spam when the filename ends a sentence", () => {
  const result = detectSpamComment({
    authorAssociation: "NONE",
    userType: "User",
    body: "Download this patch.zip. It fixes the backend encoding so the terminal rendering black boxes disappear.",
  });

  assert.equal(result.spam, true);
  assert.deepEqual(result.dangerousFiles, ["patch.zip"]);
});

test("flags any zip from an outside user, including hash-named soft bait", () => {
  const result = detectSpamComment({
    authorAssociation: "NONE",
    userType: "User",
    body: "[63bf1862b52422e38b8cb170.zip](https://github.com/user-attachments/files/29784176/63bf1862b52422e38b8cb170.zip)\nI'd start with the docs inside",
  });

  assert.equal(result.spam, true);
  assert.ok(
    result.dangerousFiles.some((file) => file.includes("63bf1862b52422e38b8cb170.zip"))
  );
});

test("flags ordinary zip log attachments from outside users", () => {
  const result = detectSpamComment({
    authorAssociation: "FIRST_TIME_CONTRIBUTOR",
    userType: "User",
    body: "[debug-logs.zip](https://github.com/user-attachments/files/29784176/debug-logs.zip)\nI attached logs from a failed connection. The app hangs after I click connect, and the logs show the SSH handshake timing out.",
  });

  assert.equal(result.spam, true);
});

test("flags other dangerous archives from outside users", () => {
  const result = detectSpamComment({
    authorAssociation: "NONE",
    userType: "User",
    body: "See hotfix.dmg for the workaround.",
  });

  assert.equal(result.spam, true);
  assert.deepEqual(result.dangerousFiles, ["hotfix.dmg"]);
});

test("does not flag trusted maintainers even when sharing zip archives", () => {
  const result = detectSpamComment({
    authorAssociation: "OWNER",
    userType: "User",
    body: "Try this temporary netcatty_patch.zip while I prepare the signed release. It fixes the rendering issue.",
  });

  assert.equal(result.spam, false);
});

test("does not flag bot comments that mention zip files", () => {
  const result = detectSpamComment({
    authorAssociation: "NONE",
    userType: "Bot",
    body: "Uploaded build-artifacts.zip for CI.",
  });

  assert.equal(result.spam, false);
});

test("does not flag comments without downloadable archives", () => {
  const result = detectSpamComment({
    authorAssociation: "NONE",
    userType: "User",
    body: "I attached screenshots of the hang after connect. The SSH handshake times out.",
  });

  assert.equal(result.spam, false);
});

test("extracts risky file names from markdown links and plain text", () => {
  assert.deepEqual(
    extractDangerousFiles("[fix.zip](https://example.com/fix.zip) also hotfix.dmg."),
    ["fix.zip", "https://example.com/fix.zip", "hotfix.dmg"]
  );
  assert.deepEqual(extractZipFiles("[fix.zip](https://example.com/fix.zip) also hotfix.dmg."), [
    "fix.zip",
    "https://example.com/fix.zip",
  ]);
});

test("identifies GitHub user attachment URLs", () => {
  assert.equal(
    isGitHubUserAttachment("https://github.com/user-attachments/files/29784176/netcatty_fix.zip"),
    true
  );
  assert.equal(isGitHubUserAttachment("https://example.com/netcatty_fix.zip"), false);
});
