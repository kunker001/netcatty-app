import assert from "node:assert/strict";
import test from "node:test";

import { isSshAgentNoneValue } from "./sshAgentSettings";

test("isSshAgentNoneValue recognizes OpenSSH none sentinel variants", () => {
  for (const value of ["none", " NONE ", '"none"', "'none'", ' "none" ']) {
    assert.equal(isSshAgentNoneValue(value), true, value);
  }
  for (const value of [undefined, "", "$SSH_AUTH_SOCK", "/tmp/none.sock"]) {
    assert.equal(isSshAgentNoneValue(value), false, String(value));
  }
});
