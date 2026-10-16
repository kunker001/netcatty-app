import assert from "node:assert/strict";
import test from "node:test";
import { readTextFile } from "./readTextFile";

test("readTextFile decodes UTF-8 text without BOM", async () => {
  const file = new File(["hello"], "note.md", { type: "text/plain" });
  assert.equal(await readTextFile(file), "hello");
});

test("readTextFile strips UTF-8 BOM", async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("hello")]);
  const file = new File([bytes], "note.md", { type: "text/plain" });
  assert.equal(await readTextFile(file), "hello");
});

test("readTextFile decodes UTF-16 LE with BOM", async () => {
  const bytes = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
  const file = new File([bytes], "note.md", { type: "text/plain" });
  assert.equal(await readTextFile(file), "hi");
});

test("readTextFile decodes UTF-16 BE with BOM", async () => {
  const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]);
  const file = new File([bytes], "note.md", { type: "text/plain" });
  assert.equal(await readTextFile(file), "hi");
});

test("readTextFile uses the fallback encoding for non-UTF-8 text without a BOM", async () => {
  const bytes = new Uint8Array([
    0x5b, 0x42, 0x6f, 0x6f, 0x6b, 0x6d, 0x61, 0x72, 0x6b, 0x73, 0x5d, 0x0a,
    0xd6, 0xd0, 0xce, 0xc4, 0xb7, 0xfe, 0xce, 0xf1, 0xc6, 0xf7,
  ]);
  const file = new File([bytes], "MobaXterm.ini", { type: "text/plain" });

  assert.equal(
    await readTextFile(file, { fallbackEncoding: "gb18030" }),
    "[Bookmarks]\n中文服务器",
  );
});

test("readTextFile keeps valid UTF-8 when a fallback encoding is configured", async () => {
  const file = new File(["[Bookmarks]\n中文服务器"], "MobaXterm.ini", {
    type: "text/plain",
  });

  assert.equal(
    await readTextFile(file, { fallbackEncoding: "gb18030" }),
    "[Bookmarks]\n中文服务器",
  );
});

test("readTextFile honors an explicit encoding for ambiguous bytes", async () => {
  const file = new File([new Uint8Array([0xc2, 0xa1])], "MobaXterm.ini", {
    type: "text/plain",
  });

  assert.equal(await readTextFile(file, { encoding: "utf-8" }), "¡");
  assert.equal(await readTextFile(file, { encoding: "gb18030" }), "隆");
});
