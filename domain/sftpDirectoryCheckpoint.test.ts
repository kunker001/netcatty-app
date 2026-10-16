import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  accountSftpDirectoryEntries,
  appendDirectoryCheckpointIdentity,
  appendDirectoryManifestIdentity,
  claimSftpDirectoryVisit,
  createDirectoryManifestAccumulator,
  createEmptyDirectoryResumeCheckpoint,
  createSftpDirectoryBranchAncestors,
  createSftpDirectoryTraversalBudget,
  EMPTY_DIRECTORY_MANIFEST_HASH,
  isValidDirectoryResumeCheckpoint,
  MAX_SFTP_FOLLOWED_SYMLINK_DEPTH,
  releaseSftpDirectoryVisit,
  shouldFollowSftpSymlinkDirectory,
} from "./sftpDirectoryCheckpoint";

test("versioned directory manifests detect changed and reordered entries", () => {
  const first = "a".repeat(64);
  const second = "b".repeat(64);
  const changed = "c".repeat(64);
  const build = (identities: string[]) => {
    const checkpoint = createEmptyDirectoryResumeCheckpoint();
    for (const identity of identities) {
      checkpoint.manifestHash = appendDirectoryCheckpointIdentity(checkpoint, identity);
      checkpoint.coveredEntries += 1;
    }
    return checkpoint;
  };

  const original = build([first, second]);
  const batched = createDirectoryManifestAccumulator(createEmptyDirectoryResumeCheckpoint());
  batched.append(first);
  batched.append(second);
  assert.equal(original.version, 2);
  assert.equal(original.manifestHash, batched.digest());
  assert.equal(original.manifestHash, build([first, second]).manifestHash);
  assert.notEqual(original.manifestHash, build([first, changed]).manifestHash);
  assert.notEqual(original.manifestHash, build([second, first]).manifestHash);
});

test("legacy chained manifests remain valid and append-compatible", () => {
  const legacy = {
    version: 1 as const,
    coveredEntries: 1,
    completedEntries: 1,
    manifestHash: appendDirectoryManifestIdentity(
      EMPTY_DIRECTORY_MANIFEST_HASH,
      "a".repeat(64),
    ),
  };
  assert.equal(isValidDirectoryResumeCheckpoint(legacy), true);
  assert.equal(
    legacy.manifestHash,
    createHash("sha256")
      .update(`${EMPTY_DIRECTORY_MANIFEST_HASH}:${"a".repeat(64)}`)
      .digest("hex"),
  );
  assert.equal(
    appendDirectoryCheckpointIdentity(legacy, "b".repeat(64)),
    appendDirectoryManifestIdentity(legacy.manifestHash, "b".repeat(64)),
  );
});

test("live and resumed directory transfers share the same symlink depth policy", () => {
  assert.equal(MAX_SFTP_FOLLOWED_SYMLINK_DEPTH, 32);
  assert.equal(shouldFollowSftpSymlinkDirectory(8), true);
  assert.equal(shouldFollowSftpSymlinkDirectory(31), true);
  assert.equal(shouldFollowSftpSymlinkDirectory(32), false);
});

test("remote directory traversal rejects ancestor cycles but allows sibling aliases", () => {
  const budget = createSftpDirectoryTraversalBudget({ maxDirectories: 3, maxEntries: 3 });
  const root = claimSftpDirectoryVisit(budget, "/srv/root");
  assert.ok(root);
  accountSftpDirectoryEntries(budget, 2);
  // Re-entering the same canonical path on the current branch is a cycle.
  assert.equal(claimSftpDirectoryVisit(budget, "/srv/root"), null);
  // Distinct symlink aliases to one target must both be traversed.
  const aliasA = claimSftpDirectoryVisit(budget, "/srv/shared");
  assert.ok(aliasA);
  releaseSftpDirectoryVisit(budget, aliasA);
  const aliasB = claimSftpDirectoryVisit(budget, "/srv/shared");
  assert.ok(aliasB);
  releaseSftpDirectoryVisit(budget, aliasB);
  assert.throws(() => accountSftpDirectoryEntries(budget, 2), /entry limit/i);
  assert.throws(() => claimSftpDirectoryVisit(budget, "/srv/third"), /directory limit/i);
  releaseSftpDirectoryVisit(budget, root);
  assert.equal(budget.activeCanonicalDirectories.size, 0);
});

test("parallel sibling branches may both claim the same canonical alias", () => {
  const budget = createSftpDirectoryTraversalBudget({ maxDirectories: 8, maxEntries: 8 });
  const rootAncestors = createSftpDirectoryBranchAncestors();
  const root = claimSftpDirectoryVisit(budget, "/srv/root", rootAncestors);
  assert.ok(root);
  const branchA = createSftpDirectoryBranchAncestors(rootAncestors);
  const branchB = createSftpDirectoryBranchAncestors(rootAncestors);
  const aliasA = claimSftpDirectoryVisit(budget, "/srv/shared", branchA);
  const aliasB = claimSftpDirectoryVisit(budget, "/srv/shared", branchB);
  assert.ok(aliasA);
  assert.ok(aliasB);
  assert.equal(claimSftpDirectoryVisit(budget, "/srv/root", branchA), null);
  assert.equal(claimSftpDirectoryVisit(budget, "/srv/root", branchB), null);
  releaseSftpDirectoryVisit(budget, aliasA, branchA);
  releaseSftpDirectoryVisit(budget, aliasB, branchB);
  releaseSftpDirectoryVisit(budget, root, rootAncestors);
});

test("remote directory traversal releases sibling visits without retaining history", () => {
  const budget = createSftpDirectoryTraversalBudget({ maxDirectories: 50_000 });
  const root = claimSftpDirectoryVisit(budget, "/srv/root");
  assert.ok(root);
  for (let index = 1; index < 50_000; index += 1) {
    const sibling = claimSftpDirectoryVisit(budget, `/srv/root/alias-${index}`);
    assert.ok(sibling);
    releaseSftpDirectoryVisit(budget, sibling);
  }
  assert.equal(budget.activeCanonicalDirectories.size, 1);
  releaseSftpDirectoryVisit(budget, root);
  assert.equal(budget.activeCanonicalDirectories.size, 0);
});
