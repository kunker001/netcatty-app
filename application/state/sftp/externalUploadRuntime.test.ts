import test from "node:test";
import assert from "node:assert/strict";

import { UploadController } from "../../../lib/uploadService";
import {
  cancelExternalUploadRuntime,
  getExternalUploadController,
  registerExternalUploadController,
  resetExternalUploadRuntimeForTests,
  unregisterExternalUploadController,
} from "./externalUploadRuntime";

test("external upload controls survive their originating panel unmount", async (t) => {
  resetExternalUploadRuntimeForTests();
  t.after(resetExternalUploadRuntimeForTests);

  const cancelled: string[] = [];
  const controller = new UploadController();
  controller.setBridge({
    mkdirSftp: async () => {},
    cancelTransfer: async (transferId) => {
      cancelled.push(transferId);
    },
  });
  controller.addActiveTransfer("child-1");

  registerExternalUploadController("folder-1", controller);
  registerExternalUploadController("child-1", controller);

  // A React panel unmount does not unregister process-level upload controls.
  assert.equal(getExternalUploadController("folder-1"), controller);
  await cancelExternalUploadRuntime("folder-1");
  assert.equal(controller.isCancelled(), true);
  assert.deepEqual(cancelled, ["child-1"]);

  unregisterExternalUploadController(controller);
  assert.equal(getExternalUploadController("folder-1"), undefined);
  assert.equal(getExternalUploadController("child-1"), undefined);
});
