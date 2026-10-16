import assert from "node:assert/strict";
import test from "node:test";

import { releaseSftpTabConnection } from "./useSftpState";

test("closing an SFTP tab releases its backend handle and connection metadata", async () => {
  const sftpSessions = new Map([["connection-1", "sftp-1"]]);
  const connectionCacheKeys = new Map([["connection-1", "endpoint-1"]]);
  const cleared: string[] = [];
  const closed: string[] = [];

  await releaseSftpTabConnection({
    connectionId: "connection-1",
    isLocal: false,
    sftpSessions,
    connectionCacheKeys,
    clearCacheForConnection: (id) => { cleared.push(id); },
    closeSftp: async (id) => { closed.push(id); },
  });

  assert.deepEqual(closed, ["sftp-1"]);
  assert.deepEqual(cleared, ["connection-1"]);
  assert.equal(sftpSessions.size, 0);
  assert.equal(connectionCacheKeys.size, 0);
});
