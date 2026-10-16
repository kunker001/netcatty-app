import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { drainUploadConflictResolvers } from "./useSftpExternalOperations";
import { UploadController } from "../../../lib/uploadService";

test("external upload cancellation is keyed by transfer task id", () => {
  const ops = readFileSync(new URL("./useSftpExternalOperations.ts", import.meta.url), "utf8");
  assert.match(ops, /registerExternalUploadController/);
  assert.match(ops, /const cancelExternalUpload = useCallback\(async \(taskId\?: string\)/);
  assert.match(ops, /bindUploadControllerCallbacks/);
  assert.doesNotMatch(ops, /for \(const controller of controllers\) void controller\.cancel\(\)/);

  const queue = readFileSync(
    new URL("../../../components/sftp/SftpTransferQueue.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(queue, /cancelExternalUpload\(task\.id\)/);
  assert.match(queue, /sftpTransferCenterStore\.cancel\(task\.id\)/);
});

test("upload conflict cancel is scoped to owning controller", () => {
  const ops = readFileSync(new URL("./useSftpExternalOperations.ts", import.meta.url), "utf8");
  assert.match(ops, /uploadConflictOwnersRef/);
  assert.match(ops, /cancelPendingUploadConflicts = useCallback\(\(controller\?: UploadController\)/);
});

test("upload conflict cleanup resolves every pending prompt on unmount", () => {
  const first = new UploadController();
  const second = new UploadController();
  const resolved: string[] = [];
  const resolvers = new Map([
    ["first", { resolve: (action: string) => resolved.push(`first:${action}`), setDefault() {} }],
    ["second", { resolve: (action: string) => resolved.push(`second:${action}`), setDefault() {} }],
  ]) as Parameters<typeof drainUploadConflictResolvers>[0];
  const owners = new Map([["first", first], ["second", second]]);

  assert.deepEqual(drainUploadConflictResolvers(resolvers, owners), ["first", "second"]);
  assert.deepEqual(resolved, ["first:stop", "second:stop"]);
  assert.equal(resolvers.size, 0);
  assert.equal(owners.size, 0);
});

test("all four external folder upload entry points keep compression and conflict handling wired together", () => {
  const source = readFileSync(new URL("./useSftpExternalOperations.ts", import.meta.url), "utf8");
  const entryPoints = [
    "uploadExternalFiles",
    "uploadExternalFileList",
    "uploadExternalFolderPath",
    "uploadExternalEntries",
  ];

  for (let index = 0; index < entryPoints.length; index += 1) {
    const start = source.indexOf(`const ${entryPoints[index]} = useCallback`);
    const nextName = entryPoints[index + 1];
    const end = nextName ? source.indexOf(`const ${nextName} = useCallback`, start + 1) : source.length;
    assert.ok(start >= 0, `${entryPoints[index]} must remain present`);
    const section = source.slice(start, end >= 0 ? end : source.length);
    assert.match(section, /runWithCompressedUploadSession\(\{/);
    assert.match(section, /enabled: useCompressedUpload/);
    assert.match(section, /resolveConflict: createUploadConflictResolver\(controller\)/);
  }
});
