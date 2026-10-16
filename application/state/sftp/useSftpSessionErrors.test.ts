import assert from "node:assert/strict";
import test from "node:test";

import { canReconnectSftpPane } from "./useSftpSessionErrors.ts";

test("can reconnect when lastHost is a vault host", () => {
  assert.equal(
    canReconnectSftpPane({
      lastHost: { id: "h1", label: "box", hostname: "1.2.3.4" } as never,
      connection: null,
    }),
    true,
  );
});

test("can reconnect from connection.hostId even when lastHost is missing", () => {
  assert.equal(
    canReconnectSftpPane({
      lastHost: null,
      connection: {
        id: "c1",
        isLocal: false,
        hostId: "h1",
        hostLabel: "box",
        currentPath: "/",
        status: "connected",
      } as never,
    }),
    true,
  );
});

test("can reconnect for local even without lastHost", () => {
  assert.equal(
    canReconnectSftpPane({
      lastHost: null,
      connection: {
        id: "local",
        isLocal: true,
        currentPath: "/",
        status: "connected",
      } as never,
    }),
    true,
  );
});

test("cannot reconnect without any host identity", () => {
  assert.equal(
    canReconnectSftpPane({
      lastHost: null,
      connection: null,
    }),
    false,
  );
});
