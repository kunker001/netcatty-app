import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_AUTO_IMPORT_SYSTEM_KNOWN_HOSTS,
  resolveAutoImportSystemKnownHosts,
  shouldAutoScanSystemKnownHosts,
} from "./systemKnownHostsAutoImport";

test("resolveAutoImportSystemKnownHosts defaults to enabled for compatibility", () => {
  assert.equal(DEFAULT_AUTO_IMPORT_SYSTEM_KNOWN_HOSTS, true);
  assert.equal(resolveAutoImportSystemKnownHosts(null), true);
  assert.equal(resolveAutoImportSystemKnownHosts(undefined), true);
});

test("resolveAutoImportSystemKnownHosts respects an explicit stored preference", () => {
  assert.equal(resolveAutoImportSystemKnownHosts(true), true);
  assert.equal(resolveAutoImportSystemKnownHosts(false), false);
});

test("shouldAutoScanSystemKnownHosts only runs once when auto-import is enabled", () => {
  assert.equal(
    shouldAutoScanSystemKnownHosts({ autoImportEnabled: true, alreadyScanned: false }),
    true,
  );
  assert.equal(
    shouldAutoScanSystemKnownHosts({ autoImportEnabled: true, alreadyScanned: true }),
    false,
  );
  assert.equal(
    shouldAutoScanSystemKnownHosts({ autoImportEnabled: false, alreadyScanned: false }),
    false,
  );
});
