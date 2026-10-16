import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  PLUGIN_JSON_MAX_DEPTH,
  PLUGIN_JSON_MAX_NODES,
  assertJsonValue,
  serializeJsonValue,
} from "./jsonValue.ts";
import {
  PLUGIN_STREAM_MAX_CHUNK_BYTES,
  PLUGIN_STREAM_MAX_CREDIT_BYTES,
  PLUGIN_STREAM_MAX_ID_LENGTH,
  PLUGIN_STREAM_MAX_WINDOW_BYTES,
  PLUGIN_STREAM_MIN_WINDOW_BYTES,
  assertStreamChunkData,
  assertStreamFrame,
  createBase64StreamChunk,
  createJsonStreamChunk,
  createMessagePortStreamEnvelope,
  materializeStreamChunk,
} from "./streamTransport.ts";
import { PLUGIN_WIRE_MAX_SAFE_INTEGER } from "./generated/plugin-contract-limits.ts";

test("validated JSON serialization matches standard JSON bytes for plain values", () => {
  const values = [
    null,
    true,
    false,
    0,
    -0,
    1.25,
    1e30,
    "quotes \" slashes \\ controls \n unicode 你好",
    [],
    [null, true, 3, "value", { nested: [1, 2, 3] }],
    { first: 1, second: "two", third: false },
    { 10: "ten", 2: "two", tail: "last" },
  ];
  for (const value of values) {
    assert.equal(serializeJsonValue(value), JSON.stringify(value));
  }
});

test("JSON validation rejects excessive structural depth and node counts", () => {
  let deepValue: unknown = null;
  for (let depth = 0; depth <= PLUGIN_JSON_MAX_DEPTH; depth += 1) {
    deepValue = [deepValue];
  }
  assert.throws(
    () => assertJsonValue(deepValue),
    new RegExp(`must not exceed ${PLUGIN_JSON_MAX_DEPTH} levels`),
  );

  const wideValue = Array.from({ length: PLUGIN_JSON_MAX_NODES }, () => null);
  assert.throws(
    () => assertJsonValue(wideValue),
    new RegExp(`must not contain more than ${PLUGIN_JSON_MAX_NODES} nodes`),
  );
});

test("JSON stream chunks use verified UTF-8 byte accounting", () => {
  const chunk = createJsonStreamChunk({ text: "你好" });
  assert.equal(chunk.encoding, "json");
  assert.equal(chunk.byteLength, new TextEncoder().encode('{"text":"你好"}').byteLength);
  assert.deepEqual(materializeStreamChunk(chunk), {
    encoding: "json",
    value: { text: "你好" },
  });
  assert.throws(
    () => materializeStreamChunk({ ...chunk, byteLength: chunk.byteLength + 1 }),
    /JSON byteLength mismatch/,
  );
  assert.throws(
    () => createJsonStreamChunk({ value: Number.NaN } as never),
    /JSON numbers must be finite/,
  );
  assert.throws(
    () => createJsonStreamChunk({ value: undefined } as never),
    /Unsupported JSON value type/,
  );
  const sparse = new Array(2) as never;
  assert.throws(() => createJsonStreamChunk(sparse), /JSON arrays must be dense/);
  const accessor = {} as Record<string, unknown>;
  Object.defineProperty(accessor, "value", { enumerable: true, get: () => "unsafe" });
  assert.throws(
    () => createJsonStreamChunk(accessor as never),
    /must not contain accessor properties/,
  );
  class CustomJsonValue {
    readonly value = "validated";

    toJSON() {
      return { value: "different" };
    }
  }
  assert.throws(
    () => createJsonStreamChunk(new CustomJsonValue() as never),
    /plain records/,
  );

  const arrayWithInheritedToJson = ["validated"];
  Object.setPrototypeOf(arrayWithInheritedToJson, {
    toJSON: () => ["different"],
  });
  const inheritedToJsonChunk = createJsonStreamChunk(arrayWithInheritedToJson);
  assert.equal(inheritedToJsonChunk.byteLength, new TextEncoder().encode('["validated"]').byteLength);

  const nullPrototypeValue = Object.assign(Object.create(null), { value: "validated" });
  assert.deepEqual(createJsonStreamChunk(nullPrototypeValue), {
    encoding: "json",
    value: nullPrototypeValue,
    byteLength: new TextEncoder().encode('{"value":"validated"}').byteLength,
  });
});

test("base64 stream chunks round-trip bytes and reject length or encoding ambiguity", () => {
  const bytes = new Uint8Array([0, 1, 2, 127, 128, 253, 254, 255]);
  const chunk = createBase64StreamChunk(bytes);
  const materialized = materializeStreamChunk(chunk);
  assert.equal(materialized.encoding, "binary");
  assert.deepEqual(materialized.bytes, bytes);

  assert.throws(
    () => materializeStreamChunk({ ...chunk, byteLength: bytes.byteLength + 1 }),
    /byteLength mismatch/,
  );
  assert.throws(
    () => materializeStreamChunk({ encoding: "base64", value: "not-base64", byteLength: 1 }),
    /canonical RFC 4648 base64/,
  );
  assert.throws(
    () => materializeStreamChunk({ encoding: "base64", value: "AB==", byteLength: 1 }),
    /canonical RFC 4648 base64/,
  );
  assert.throws(
    () => materializeStreamChunk({
      encoding: "base64",
      value: "",
      byteLength: PLUGIN_STREAM_MAX_CHUNK_BYTES + 1,
    }),
    /byteLength must be an integer between/,
  );

  for (let length = 0; length <= 257; length += 1) {
    const sample = Uint8Array.from(
      { length },
      (_, index) => (length * 17 + index * 31) & 0xff,
    );
    const roundTrip = materializeStreamChunk(createBase64StreamChunk(sample));
    assert.equal(roundTrip.encoding, "binary");
    assert.deepEqual(roundTrip.bytes, sample, `base64 length ${length}`);
  }
});

test("stream chunk assertions validate inline bytes before accepting frames", () => {
  const jsonChunk = createJsonStreamChunk({ text: "你好" });
  const base64Chunk = createBase64StreamChunk(new Uint8Array([0, 1, 2, 255]));
  assert.doesNotThrow(() => assertStreamChunkData(jsonChunk));
  assert.doesNotThrow(() => assertStreamChunkData(base64Chunk));
  assert.doesNotThrow(() => assertStreamChunkData({ encoding: "transfer", byteLength: 4 }));

  const invalidInlineChunks: readonly [unknown, RegExp][] = [
    [{ ...jsonChunk, byteLength: jsonChunk.byteLength + 1 }, /JSON byteLength mismatch/],
    [{ ...base64Chunk, byteLength: base64Chunk.byteLength + 1 }, /base64 byteLength mismatch/],
    [
      { encoding: "base64", value: "not-base64", byteLength: 1 },
      /canonical RFC 4648 base64/,
    ],
    [{ encoding: "base64", value: "AB==", byteLength: 1 }, /canonical RFC 4648 base64/],
  ];
  for (const [data, expectedError] of invalidInlineChunks) {
    assert.throws(() => assertStreamChunkData(data), expectedError);
    assert.throws(
      () => assertStreamFrame({ streamId: "stream-1", sequence: 1, kind: "chunk", data }),
      expectedError,
    );
  }
});

test("MessagePort stream envelopes carry and validate the transferred ArrayBuffer", () => {
  const transfer = new Uint8Array([1, 2, 3, 4]).buffer;
  const frame = {
    streamId: "stream-1",
    sequence: 1,
    kind: "chunk" as const,
    data: { encoding: "transfer" as const, byteLength: 4 },
  };
  const envelope = createMessagePortStreamEnvelope(frame, transfer);
  assert.equal(envelope.transfer, transfer);
  const materialized = materializeStreamChunk(frame.data, envelope.transfer);
  assert.equal(materialized.encoding, "binary");
  assert.deepEqual(materialized.bytes, new Uint8Array([1, 2, 3, 4]));

  const crossRealmTransfer = runInNewContext("new ArrayBuffer(4)") as ArrayBuffer;
  assert.equal(crossRealmTransfer instanceof ArrayBuffer, false);
  const crossRealmMaterialized = materializeStreamChunk(frame.data, crossRealmTransfer);
  assert.equal(crossRealmMaterialized.encoding, "binary");
  assert.equal(crossRealmMaterialized.bytes.byteLength, 4);

  assert.throws(
    () => createMessagePortStreamEnvelope(frame),
    /require an ArrayBuffer/,
  );
  assert.throws(
    () => createMessagePortStreamEnvelope(frame, { byteLength: 4 } as never),
    /require a real, attached ArrayBuffer/,
  );
  assert.throws(
    () => createMessagePortStreamEnvelope(
      frame,
      {
        byteLength: 4,
        [Symbol.toStringTag]: "ArrayBuffer",
      } as never,
    ),
    /require a real, attached ArrayBuffer/,
  );
  const detached = new ArrayBuffer(4);
  structuredClone(detached, { transfer: [detached] });
  assert.throws(
    () => createMessagePortStreamEnvelope(
      { ...frame, data: { ...frame.data, byteLength: 0 } },
      detached,
    ),
    /require a real, attached ArrayBuffer/,
  );
  assert.throws(
    () => materializeStreamChunk(
      { encoding: "bogus", byteLength: 4 } as never,
      transfer,
    ),
    /Unsupported stream chunk encoding/,
  );
  assert.throws(
    () => createMessagePortStreamEnvelope(
      { streamId: "stream-1", sequence: 0, kind: "open", windowBytes: 65_536 },
      transfer,
    ),
    /Only transfer-encoded chunk frames/,
  );
  assert.deepEqual(createMessagePortStreamEnvelope({
    streamId: "stream-1",
    sequence: PLUGIN_WIRE_MAX_SAFE_INTEGER,
    kind: "windowUpdate",
    creditBytes: 4096,
  }), {
    frame: {
      streamId: "stream-1",
      sequence: PLUGIN_WIRE_MAX_SAFE_INTEGER,
      kind: "windowUpdate",
      creditBytes: 4096,
    },
  });
  assert.throws(
    () => createMessagePortStreamEnvelope({
      streamId: "stream-1",
      sequence: PLUGIN_WIRE_MAX_SAFE_INTEGER + 1,
      kind: "windowUpdate",
      creditBytes: 4096,
    }),
    /sequence must be a safe integer/,
  );
  assert.doesNotThrow(() => createMessagePortStreamEnvelope({
    streamId: "stream-1",
    sequence: 0,
    kind: "open",
    windowBytes: PLUGIN_STREAM_MIN_WINDOW_BYTES,
  }));
  assert.doesNotThrow(() => createMessagePortStreamEnvelope({
    streamId: "stream-1",
    sequence: 0,
    kind: "open",
    windowBytes: PLUGIN_STREAM_MAX_WINDOW_BYTES,
  }));
  for (const windowBytes of [
    0,
    PLUGIN_STREAM_MIN_WINDOW_BYTES - 1,
    PLUGIN_STREAM_MAX_WINDOW_BYTES + 1,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.throws(
      () => createMessagePortStreamEnvelope({
        streamId: "stream-1",
        sequence: 0,
        kind: "open",
        windowBytes,
      }),
      /windowBytes must be an integer between|JSON numbers must be finite/,
    );
  }
  assert.doesNotThrow(() => createMessagePortStreamEnvelope({
    streamId: "stream-1",
    sequence: 0,
    kind: "windowUpdate",
    creditBytes: PLUGIN_STREAM_MAX_CREDIT_BYTES,
  }));
  for (const creditBytes of [
    0,
    PLUGIN_STREAM_MAX_CREDIT_BYTES + 1,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.throws(
      () => createMessagePortStreamEnvelope({
        streamId: "stream-1",
        sequence: 0,
        kind: "windowUpdate",
        creditBytes,
      }),
      /creditBytes must be an integer between|JSON numbers must be finite/,
    );
  }
});

test("MessagePort stream envelopes reject frames outside the complete wire schema", () => {
  const validError = {
    streamId: "stream-1",
    sequence: 1,
    kind: "error",
    error: { code: -32001, message: "cancelled", data: { retryable: false } },
  };
  assert.doesNotThrow(() => assertStreamFrame(validError));
  assert.doesNotThrow(() => createMessagePortStreamEnvelope(validError));

  const invalidFrames: readonly [unknown, RegExp][] = [
    [null, /plain JSON object/],
    [[], /plain JSON object/],
    [{ streamId: "", sequence: 1, kind: "end" }, /between 1 and/],
    [
      { streamId: "x".repeat(PLUGIN_STREAM_MAX_ID_LENGTH + 1), sequence: 1, kind: "end" },
      /between 1 and/,
    ],
    [{ streamId: "stream-1", sequence: 1, kind: "bogus" }, /Unsupported stream frame kind/],
    [{ streamId: "stream-1", sequence: 0, kind: "open" }, /missing or unsupported/],
    [
      { streamId: "stream-1", sequence: 0, kind: "open", windowBytes: 4096, extra: true },
      /missing or unsupported/,
    ],
    [{ streamId: "stream-1", sequence: 1, kind: "chunk", data: null }, /plain JSON object/],
    [
      {
        streamId: "stream-1",
        sequence: 1,
        kind: "chunk",
        data: { encoding: "bogus", byteLength: 0 },
      },
      /Unsupported stream chunk encoding/,
    ],
    [
      {
        streamId: "stream-1",
        sequence: 1,
        kind: "chunk",
        data: { encoding: "transfer", byteLength: 0, value: "extra" },
      },
      /missing or unsupported/,
    ],
    [{ streamId: "stream-1", sequence: 1, kind: "end", data: null }, /missing or unsupported/],
    [
      {
        streamId: "stream-1",
        sequence: 1,
        kind: "error",
        error: { code: -1, message: "bad" },
      },
      /supported RPC error code/,
    ],
    [
      {
        streamId: "stream-1",
        sequence: 1,
        kind: "error",
        error: { code: -32001, message: "", data: null },
      },
      /between 1 and/,
    ],
    [
      {
        streamId: "stream-1",
        sequence: 1,
        kind: "error",
        error: { code: -32001, message: "bad", extra: true },
      },
      /missing or unsupported/,
    ],
    [{ streamId: "stream-1", sequence: 0, kind: "cancel" }, /sequence must be a safe integer/],
    [
      {
        streamId: "stream-1",
        sequence: 0,
        kind: "windowUpdate",
        creditBytes: 1,
        extra: true,
      },
      /missing or unsupported/,
    ],
  ];
  for (const [frame, expectedError] of invalidFrames) {
    assert.throws(() => createMessagePortStreamEnvelope(frame), expectedError);
  }

  let getterRead = false;
  const accessorFrame = { streamId: "stream-1", sequence: 1 } as Record<string, unknown>;
  Object.defineProperty(accessorFrame, "kind", {
    enumerable: true,
    get: () => {
      getterRead = true;
      return "end";
    },
  });
  assert.throws(
    () => createMessagePortStreamEnvelope(accessorFrame),
    /accessor properties/,
  );
  assert.equal(getterRead, false);
});
