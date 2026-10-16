"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  createSftpTransferSessionLeaseStore,
} = require("./sftpTransferSessionLease.cjs");

describe("sftpTransferSessionLease", () => {
  it("acquires and releases per transfer id", () => {
    const store = createSftpTransferSessionLeaseStore();
    assert.equal(store.acquire("sftp-a", "t1"), true);
    assert.equal(store.acquire("sftp-a", "t2"), true);
    assert.equal(store.acquire("sftp-a", "t1"), false); // already held
    assert.equal(store.getLeaseCount("sftp-a"), 2);
    assert.equal(store.isHeld("sftp-a"), true);

    assert.deepEqual(store.release("sftp-a", "t1"), {
      released: true,
      shouldHardClose: false,
      remaining: 1,
    });
    assert.deepEqual(store.release("sftp-a", "t2"), {
      released: true,
      shouldHardClose: false,
      remaining: 0,
    });
    assert.equal(store.isHeld("sftp-a"), false);
  });

  it("defers hard close while transfers hold the session", () => {
    const store = createSftpTransferSessionLeaseStore();
    store.acquire("sftp-a", "t1");
    assert.equal(store.markSoftClosed("sftp-a"), true);
    assert.equal(store.isSoftClosed("sftp-a"), true);

    assert.deepEqual(store.release("sftp-a", "t1"), {
      released: true,
      shouldHardClose: true,
      remaining: 0,
    });
    assert.equal(store.isSoftClosed("sftp-a"), false);
  });

  it("does not soft-close an unheld session", () => {
    const store = createSftpTransferSessionLeaseStore();
    assert.equal(store.markSoftClosed("sftp-a"), false);
    assert.equal(store.isSoftClosed("sftp-a"), false);
  });

  it("keeps soft-close sticky across re-acquire so last release hard-closes", () => {
    const store = createSftpTransferSessionLeaseStore();
    store.acquire("sftp-a", "t1");
    store.markSoftClosed("sftp-a");
    // New transfer joins after panel soft-close — must not cancel teardown.
    store.acquire("sftp-a", "t2");
    assert.equal(store.isSoftClosed("sftp-a"), true);
    assert.deepEqual(store.release("sftp-a", "t1"), {
      released: true,
      shouldHardClose: false,
      remaining: 1,
    });
    assert.equal(store.isSoftClosed("sftp-a"), true);
    assert.deepEqual(store.release("sftp-a", "t2"), {
      released: true,
      shouldHardClose: true,
      remaining: 0,
    });
    assert.equal(store.isSoftClosed("sftp-a"), false);
  });

  it("lets the next directory child cancel an uncommitted hard close", () => {
    const store = createSftpTransferSessionLeaseStore();
    store.acquire("sftp-a", "child-1");
    store.markSoftClosed("sftp-a");
    const firstRelease = store.release("sftp-a", "child-1");
    const firstCloseToken = store.getPendingHardCloseToken("sftp-a");
    assert.equal(firstRelease.shouldHardClose, true);
    assert.equal(Number.isSafeInteger(firstCloseToken), true);

    assert.equal(store.acquire("sftp-a", "child-2"), true);
    assert.equal(store.commitHardClose("sftp-a", firstCloseToken), false);
    assert.equal(store.isHeld("sftp-a"), true);

    const secondRelease = store.release("sftp-a", "child-2");
    assert.equal(secondRelease.shouldHardClose, true);
    assert.notEqual(store.getPendingHardCloseToken("sftp-a"), firstCloseToken);
  });

  it("refuses new leases after hard close commits", () => {
    const store = createSftpTransferSessionLeaseStore();
    store.acquire("sftp-a", "child-1");
    store.markSoftClosed("sftp-a");
    store.release("sftp-a", "child-1");
    const closeToken = store.getPendingHardCloseToken("sftp-a");

    assert.equal(store.commitHardClose("sftp-a", closeToken), true);
    assert.equal(store.isHardCloseCommitted("sftp-a"), true);
    assert.equal(store.acquire("sftp-a", "child-2"), false);
    assert.equal(store.isHeld("sftp-a"), false);

    store.clear("sftp-a");
    assert.equal(store.isHardCloseCommitted("sftp-a"), false);
  });

  it("tracks multiple sessions independently", () => {
    const store = createSftpTransferSessionLeaseStore();
    store.acquire("sftp-a", "t1");
    store.acquire("sftp-b", "t1");
    store.markSoftClosed("sftp-a");
    assert.deepEqual(store.release("sftp-b", "t1"), {
      released: true,
      shouldHardClose: false,
      remaining: 0,
    });
    assert.deepEqual(store.release("sftp-a", "t1"), {
      released: true,
      shouldHardClose: true,
      remaining: 0,
    });
  });
});
