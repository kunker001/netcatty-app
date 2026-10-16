"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  _canFailedHopRetryWithEncryptedDefaultKeys,
  _canRetryWithEncryptedDefaultKeys,
  _isStrictAgentAuthFailure,
} = require("./sshBridge.cjs");

test("strict agent failures skip encrypted default-key prompts", () => {
  const jumpHosts = [
    { hostname: "shared.example", useSshAgent: false },
    { hostname: "shared.example", useSshAgent: true, identitiesOnly: true },
  ];
  assert.equal(_isStrictAgentAuthFailure({ jumpHosts }, {
    isJumpHostAuthError: true,
    jumpHostIndex: 1,
    jumpHostHostname: "shared.example",
  }), true);
  assert.equal(_isStrictAgentAuthFailure({ jumpHosts }, {
    isJumpHostAuthError: true,
    jumpHostIndex: 0,
    jumpHostHostname: "shared.example",
  }), false);
  assert.equal(_isStrictAgentAuthFailure({ jumpHosts }, {
    isJumpHostAuthError: true,
    jumpHostHostname: "shared.example",
  }), false, "ambiguous legacy errors must not guess the failed hop");
});

test("encrypted default-key retry is limited to automatic or legacy hops", () => {
  assert.equal(_canRetryWithEncryptedDefaultKeys({ authMethod: "password" }), false);
  assert.equal(_canRetryWithEncryptedDefaultKeys({ authMethod: "key" }), false);
  assert.equal(_canRetryWithEncryptedDefaultKeys({ authMethod: "certificate" }), false);
  assert.equal(_canRetryWithEncryptedDefaultKeys({ authMethod: "auto" }), true);
  assert.equal(_canRetryWithEncryptedDefaultKeys({
    authMethod: "password",
    jumpHosts: [{ authMethod: "auto" }],
  }), true);
  assert.equal(_canRetryWithEncryptedDefaultKeys({
    authMethod: "password",
    jumpHosts: [{ authMethod: "password" }, { authMethod: "key" }],
  }), false);
  assert.equal(_canRetryWithEncryptedDefaultKeys({
    authMethod: "auto",
    _unlockedEncryptedKeys: [{ keyName: "id_work" }],
  }), false);
});

test("encrypted default-key prompts follow the hop that actually failed", () => {
  const automaticJumpExplicitTarget = {
    authMethod: "password",
    jumpHosts: [{ authMethod: "auto", hostname: "jump.example" }],
  };
  assert.equal(_canFailedHopRetryWithEncryptedDefaultKeys(
    automaticJumpExplicitTarget,
    { level: "client-authentication" },
  ), false);
  assert.equal(_canFailedHopRetryWithEncryptedDefaultKeys(
    automaticJumpExplicitTarget,
    { isJumpHostAuthError: true, jumpHostIndex: 0 },
  ), true);

  const automaticTargetExplicitJump = {
    authMethod: "auto",
    jumpHosts: [{ authMethod: "key", hostname: "jump.example" }],
  };
  assert.equal(_canFailedHopRetryWithEncryptedDefaultKeys(
    automaticTargetExplicitJump,
    { level: "client-authentication" },
  ), true);
  assert.equal(_canFailedHopRetryWithEncryptedDefaultKeys(
    automaticTargetExplicitJump,
    { isJumpHostAuthError: true, jumpHostIndex: 0 },
  ), false);
});
