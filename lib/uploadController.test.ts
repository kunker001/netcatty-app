import assert from "node:assert/strict";
import test from "node:test";

import { UploadController } from "./uploadController";

test("cancelling an upload aborts an active pathless-file staging job", async () => {
  const calls: string[] = [];
  const controller = new UploadController();
  controller.setBridge({
    mkdirSftp: async () => {},
    cancelStagedUploadFile: async (transferId) => { calls.push(`stage:${transferId}`); },
    cancelTransfer: async (transferId) => { calls.push(`transfer:${transferId}`); },
  });
  controller.addActiveTransfer("upload-1");
  await controller.cancel();
  assert.deepEqual(calls, ["stage:upload-1", "transfer:upload-1"]);
});
