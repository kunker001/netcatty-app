import test from "node:test";
import assert from "node:assert/strict";

import { EditorTabStore, type EditorTab } from "./editorTabStore.ts";
import { createEditorTabSaveService } from "./editorTabSave.ts";
import {
  isBrowseSessionInteractive,
  shouldParkBrowseSessions,
  takeBrowseSessionsForClose,
} from "./sftp/browseSessionLifecycle.ts";

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makeTab = (overrides: Partial<EditorTab> = {}): EditorTab => ({
  id: "edt_1",
  kind: "editor",
  sessionId: "conn_1",
  sftpTabId: "pane_1",
  hostId: "host_1",
  remotePath: "/tmp/file.txt",
  fileName: "file.txt",
  languageId: "plaintext",
  content: "v1",
  baselineContent: "old",
  wordWrap: false,
  viewState: null,
  savingState: "idle",
  saveError: null,
  ...overrides,
});

test("editor tab save service joins duplicate saves for the same content", async () => {
  const store = new EditorTabStore();
  store._debugInsert(makeTab());
  const pending = deferred();
  const writes: string[] = [];
  const service = createEditorTabSaveService({
    store,
    write: async (_sessionId, _hostId, _remotePath, content) => {
      writes.push(content);
      await pending.promise;
      return "conn_1";
    },
  });

  const first = service.saveTab("edt_1");
  const second = service.saveTab("edt_1", "v1");

  assert.deepEqual(writes, ["v1"]);
  pending.resolve();

  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(writes, ["v1"]);
  assert.equal(store.getTab("edt_1")?.baselineContent, "v1");
  assert.equal(store.getTab("edt_1")?.savingState, "idle");
});

test("editor tab save service queues newer tab content after an in-flight save", async () => {
  const store = new EditorTabStore();
  store._debugInsert(makeTab());
  const firstSave = deferred();
  const secondSave = deferred();
  const writes: string[] = [];
  const service = createEditorTabSaveService({
    store,
    write: async (_sessionId, _hostId, _remotePath, content) => {
      writes.push(content);
      await (content === "v1" ? firstSave.promise : secondSave.promise);
      return "conn_1";
    },
  });

  const first = service.saveTab("edt_1");
  store.updateContent("edt_1", "v2", null);
  const second = service.saveTab("edt_1");

  assert.deepEqual(writes, ["v1"]);
  firstSave.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(writes, ["v1", "v2"]);
  secondSave.resolve();

  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(store.getTab("edt_1")?.baselineContent, "v2");
  assert.equal(store.getTab("edt_1")?.content, "v2");
});

test("promoted side-panel editor saves while hidden and releases its session after close", async () => {
  const store = new EditorTabStore();
  const tabId = store.promoteFromModal({
    sessionId: "conn_1",
    sftpTabId: "pane_1",
    hostId: "host_1",
    remotePath: "/tmp/script.sh",
    fileName: "script.sh",
    languageId: "shell",
    content: "echo changed",
    baselineContent: "echo original",
    wordWrap: false,
    viewState: null,
  });
  const browseSessions = new Map([["conn_1", "sftp_1"]]);
  const ownedSessionIds = new Set(["conn_1"]);
  const ownedSftpTabIds = new Set(["pane_1"]);
  const applyHiddenLifecycle = () => {
    const interactive = isBrowseSessionInteractive({
      surfaceVisible: false,
      hasOwnedEditorTab: store.hasOwnedEditorForSftpOwner({
        sessionIds: ownedSessionIds,
        sftpTabIds: ownedSftpTabIds,
      }),
    });
    if (shouldParkBrowseSessions({ interactive, browseParked: false })) {
      takeBrowseSessionsForClose(browseSessions);
    }
  };

  applyHiddenLifecycle();
  assert.equal(browseSessions.get("conn_1"), "sftp_1");

  const writes: string[] = [];
  const service = createEditorTabSaveService({
    store,
    write: async (connectionId, _hostId, _remotePath, content) => {
      assert.equal(browseSessions.has(connectionId), true);
      writes.push(content);
      return connectionId;
    },
  });
  assert.equal(await service.saveTab(tabId), true);
  assert.deepEqual(writes, ["echo changed"]);

  store.close(tabId);
  applyHiddenLifecycle();
  assert.equal(browseSessions.size, 0);
});

test("hidden panel stays interactive while browse reconnects before session remap", () => {
  const store = new EditorTabStore();
  store.promoteFromModal({
    sessionId: "conn_old",
    sftpTabId: "pane_1",
    hostId: "host_1",
    remotePath: "/tmp/script.sh",
    fileName: "script.sh",
    languageId: "shell",
    content: "echo changed",
    baselineContent: "echo original",
    wordWrap: false,
    viewState: null,
  });
  const browseSessions = new Map([["conn_new", "sftp_1"]]);

  const interactive = isBrowseSessionInteractive({
    surfaceVisible: false,
    hasOwnedEditorTab: store.hasOwnedEditorForSftpOwner({
      sessionIds: new Set(["conn_new"]),
      sftpTabIds: new Set(["pane_1"]),
    }),
  });
  assert.equal(interactive, true);
  assert.equal(
    shouldParkBrowseSessions({ interactive, browseParked: false }),
    false,
  );
  assert.equal(browseSessions.get("conn_new"), "sftp_1");
});

test("editor tab save remaps stale session ids returned by the SFTP writer", async () => {
  const store = new EditorTabStore();
  store._debugInsert(makeTab({ sessionId: "conn_old", sftpTabId: "pane_1" }));
  const seenConnectionIds: string[] = [];
  const service = createEditorTabSaveService({
    store,
    write: async (connectionId, _hostId, _remotePath, content, _encoding, sftpTabId) => {
      seenConnectionIds.push(connectionId);
      assert.equal(sftpTabId, "pane_1");
      if (content === "next") {
        assert.equal(connectionId, "conn_old");
        store.remapSessionId("conn_old", "conn_new");
        return "conn_new";
      }
      assert.equal(connectionId, "conn_new");
      assert.equal(content, "next2");
      return "conn_new";
    },
  });

  assert.equal(await service.saveTab("edt_1", "next"), true);
  assert.equal(store.getTab("edt_1")?.sessionId, "conn_new");

  store.updateContent("edt_1", "next2", null);
  assert.equal(await service.saveTab("edt_1"), true);
  assert.deepEqual(seenConnectionIds, ["conn_old", "conn_new"]);
});

test("closing an SFTP pane prompts for dirty editors after reconnect id churn", async () => {
  const store = new EditorTabStore();
  store._debugInsert(makeTab({
    sessionId: "conn_old",
    sftpTabId: "pane_1",
    content: "dirty",
    baselineContent: "clean",
  }));
  let prompted = false;
  const ok = await store.confirmCloseByOwner(
    { sessionId: "conn_new", sftpTabId: "pane_1" },
    async () => {
      prompted = true;
      return "discard";
    },
  );
  assert.equal(prompted, true);
  assert.equal(ok, true);
  assert.equal(store.getTabs().length, 0);
});
