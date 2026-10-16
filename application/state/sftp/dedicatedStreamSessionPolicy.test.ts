import assert from "node:assert/strict";
import test from "node:test";

import {
  compressedUploadRequiresDedicatedSession,
  remoteEndpointRequiresPool,
  resolveDedicatedStreamEndpointIds,
  resolveUploadStreamTargetSftpId,
} from "../../../domain/sftpDedicatedStreamPolicy.ts";
import { runWithCompressedUploadSession } from "./compressedUploadSession.ts";

test("compressed folder uploads hold a dedicated session for the whole job", async () => {
  const calls: Array<[string, string]> = [];
  const lease = {
    sftpId: "dedicated-compressed",
    poolKey: "host-1",
    release: () => {},
    discard: () => {},
  };

  const result = await runWithCompressedUploadSession({
    enabled: true,
    hasDirectory: true,
    isLocal: false,
    hostId: "host-1",
    jobId: "compressed-job-1",
    prepSftpId: "browse-session",
    acquire: async (hostId, jobId) => {
      calls.push([hostId, jobId]);
      return lease;
    },
    shouldDiscard: () => false,
    run: async (sftpId) => sftpId,
  });

  assert.equal(result, "dedicated-compressed");
  assert.deepEqual(calls, [["host-1", "compressed-job-1"]]);
});

test("compressed upload refuses a page-owned fallback when a dedicated session is required", async () => {
  await assert.rejects(
    runWithCompressedUploadSession({
      enabled: true,
      hasDirectory: true,
      isLocal: false,
      hostId: "host-1",
      jobId: "compressed-job-2",
      prepSftpId: "browse-session",
      shouldDiscard: () => false,
      run: async (sftpId) => sftpId,
    }),
    /Dedicated transfer session unavailable/,
  );
});

test("compressed upload discards a failed dedicated session instead of releasing it", async () => {
  let discarded = 0;
  let released = 0;
  await assert.rejects(runWithCompressedUploadSession({
    enabled: true,
    hasDirectory: true,
    isLocal: false,
    hostId: "host-1",
    jobId: "compressed-job-3",
    prepSftpId: "browse-session",
    acquire: async () => ({
      sftpId: "dead-session",
      discard: () => { discarded += 1; },
      release: () => { released += 1; },
    }),
    shouldDiscard: () => true,
    run: async () => { throw new Error("session closed"); },
  }), /session closed/);
  assert.equal(discarded, 1);
  assert.equal(released, 0);
});

test("plain file upload keeps using its preparation session", async () => {
  let acquireCalls = 0;
  const result = await runWithCompressedUploadSession({
    enabled: true,
    hasDirectory: false,
    isLocal: false,
    hostId: "host-1",
    jobId: "plain-file",
    prepSftpId: "browse-session",
    acquire: async () => {
      acquireCalls += 1;
      throw new Error("must not acquire");
    },
    shouldDiscard: () => false,
    run: async (sftpId) => sftpId,
  });
  assert.equal(result, "browse-session");
  assert.equal(acquireCalls, 0);
  assert.equal(compressedUploadRequiresDedicatedSession({
    enabled: true,
    hasDirectory: false,
    isLocal: false,
    hostId: "host-1",
  }), false);
});

test("remote ends with host id require the transfer pool when available", () => {
  assert.equal(
    remoteEndpointRequiresPool({ isLocal: false, hostId: "h1", poolAvailable: true }),
    true,
  );
  assert.equal(
    remoteEndpointRequiresPool({ isLocal: true, hostId: "h1", poolAvailable: true }),
    false,
  );
  assert.equal(
    remoteEndpointRequiresPool({ isLocal: false, hostId: "h1", poolAvailable: false }),
    false,
  );
});

test("resolveDedicatedStreamEndpointIds refuses silent browse fallback for required ends", () => {
  const failed = resolveDedicatedStreamEndpointIds({
    sourceIsLocal: true,
    targetIsLocal: false,
    targetHostId: "h1",
    panelTargetSftpId: "browse-1",
    poolAvailable: true,
  });
  assert.equal(failed.error, "Dedicated target transfer session unavailable");
  assert.equal(failed.targetSftpId, undefined);

  const ok = resolveDedicatedStreamEndpointIds({
    sourceIsLocal: true,
    targetIsLocal: false,
    targetHostId: "h1",
    targetPoolSftpId: "pool-1",
    panelTargetSftpId: "browse-1",
    poolAvailable: true,
  });
  assert.equal(ok.error, undefined);
  assert.equal(ok.targetSftpId, "pool-1");
});

test("resolveUploadStreamTargetSftpId never substitutes prep when pool required", () => {
  assert.deepEqual(
    resolveUploadStreamTargetSftpId({
      requirePool: true,
      poolSftpId: null,
      prepSftpId: "browse",
    }),
    { error: "Dedicated transfer session unavailable" },
  );
  assert.deepEqual(
    resolveUploadStreamTargetSftpId({
      requirePool: true,
      poolSftpId: "pool",
      prepSftpId: "browse",
    }),
    { sftpId: "pool" },
  );
  assert.deepEqual(
    resolveUploadStreamTargetSftpId({
      requirePool: false,
      prepSftpId: "browse",
    }),
    { sftpId: "browse" },
  );
});
