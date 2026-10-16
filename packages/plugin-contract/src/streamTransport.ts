import type {
  JsonValue,
  RpcErrorObject,
  StreamChunkData,
  StreamFrame,
} from "./generated/plugin-contract.js";
import {
  PLUGIN_RPC_ERROR_CODES,
  PLUGIN_STREAM_MAX_CHUNK_BYTES,
  PLUGIN_STREAM_MAX_CREDIT_BYTES,
  PLUGIN_STREAM_MAX_ID_LENGTH,
  PLUGIN_STREAM_MAX_WINDOW_BYTES,
  PLUGIN_STREAM_MIN_WINDOW_BYTES,
  PLUGIN_WIRE_MAX_SAFE_INTEGER,
} from "./generated/plugin-contract-limits.js";
import { assertJsonValue, serializeJsonValue } from "./jsonValue.js";

export {
  PLUGIN_STREAM_MAX_CHUNK_BYTES,
  PLUGIN_STREAM_MAX_CREDIT_BYTES,
  PLUGIN_STREAM_MAX_FRAME_JSON_BYTES,
  PLUGIN_STREAM_MAX_ID_LENGTH,
  PLUGIN_STREAM_MAX_WINDOW_BYTES,
  PLUGIN_STREAM_MIN_WINDOW_BYTES,
} from "./generated/plugin-contract-limits.js";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUE = new Map(
  [...BASE64_ALPHABET].map((character, index) => [character, index] as const),
);

export interface MessagePortStreamEnvelope {
  readonly frame: StreamFrame;
  readonly transfer?: ArrayBuffer;
}

const PLUGIN_STREAM_MAX_BASE64_CHARACTERS = 4 * Math.ceil(PLUGIN_STREAM_MAX_CHUNK_BYTES / 3);
const RPC_ERROR_CODES = new Set<number>(PLUGIN_RPC_ERROR_CODES);

export type MaterializedStreamChunk =
  | { readonly encoding: "json"; readonly value: JsonValue }
  | { readonly encoding: "binary"; readonly bytes: Uint8Array };

const jsonEncoder = new TextEncoder();
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;

function materializeArrayBuffer(value: unknown): Uint8Array {
  if (!arrayBufferByteLength) {
    throw new TypeError("ArrayBuffer byteLength getter is unavailable");
  }
  try {
    arrayBufferByteLength.call(value);
    return new Uint8Array(value as ArrayBuffer);
  } catch {
    throw new TypeError("Transfer stream chunks require a real, attached ArrayBuffer");
  }
}

function serializedJsonByteLength(value: JsonValue): number {
  const serialized = serializeJsonValue(value);
  return jsonEncoder.encode(serialized).byteLength;
}

function assertChunkByteLength(byteLength: number): void {
  if (!Number.isInteger(byteLength)
    || byteLength < 0
    || byteLength > PLUGIN_STREAM_MAX_CHUNK_BYTES) {
    throw new RangeError(
      `Stream chunk byteLength must be an integer between 0 and ${PLUGIN_STREAM_MAX_CHUNK_BYTES}`,
    );
  }
}

type JsonRecord = Record<string, JsonValue>;

function readJsonRecord(value: unknown, label: string): JsonRecord {
  assertJsonValue(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain JSON object`);
  }
  const record: JsonRecord = Object.create(null) as JsonRecord;
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${label} must contain data properties only`);
    }
    record[key] = descriptor.value as JsonValue;
  }
  return record;
}

function assertExactKeys(
  record: JsonRecord,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actualKeys = Object.keys(record);
  if (actualKeys.length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(record, key))) {
    throw new TypeError(`${label} has missing or unsupported properties`);
  }
}

function assertBoundedString(
  value: JsonValue | undefined,
  minimum: number,
  maximum: number,
  label: string,
): asserts value is string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  const length = [...value].length;
  if (length < minimum || length > maximum) {
    throw new RangeError(`${label} must contain between ${minimum} and ${maximum} characters`);
  }
}

function parseRpcErrorObject(value: unknown): RpcErrorObject {
  const error = readJsonRecord(value, "Stream error");
  const expectedKeys = Object.hasOwn(error, "data")
    ? ["code", "message", "data"]
    : ["code", "message"];
  assertExactKeys(error, expectedKeys, "Stream error");
  if (typeof error.code !== "number"
    || !Number.isInteger(error.code)
    || !RPC_ERROR_CODES.has(error.code)) {
    throw new RangeError("Stream error code is not a supported RPC error code");
  }
  assertBoundedString(error.message, 1, 2048, "Stream error message");
  return Object.hasOwn(error, "data")
    ? {
        code: error.code as RpcErrorObject["code"],
        message: error.message,
        data: error.data ?? null,
      }
    : { code: error.code as RpcErrorObject["code"], message: error.message };
}

function parseStreamChunkDataShape(value: unknown): StreamChunkData {
  const data = readJsonRecord(value, "Stream chunk data");
  if (data.encoding === "json") {
    assertExactKeys(data, ["encoding", "value", "byteLength"], "JSON stream chunk data");
    if (typeof data.byteLength !== "number") {
      throw new TypeError("Stream chunk byteLength must be a number");
    }
    assertChunkByteLength(data.byteLength);
    return { encoding: "json", value: data.value ?? null, byteLength: data.byteLength };
  } else if (data.encoding === "base64") {
    assertExactKeys(data, ["encoding", "value", "byteLength"], "Base64 stream chunk data");
    if (typeof data.value !== "string") {
      throw new TypeError("Base64 stream chunk value must be a string");
    }
    if (typeof data.byteLength !== "number") {
      throw new TypeError("Stream chunk byteLength must be a number");
    }
    assertChunkByteLength(data.byteLength);
    return { encoding: "base64", value: data.value, byteLength: data.byteLength };
  } else if (data.encoding === "transfer") {
    assertExactKeys(data, ["encoding", "byteLength"], "Transfer stream chunk data");
    if (typeof data.byteLength !== "number") {
      throw new TypeError("Stream chunk byteLength must be a number");
    }
    assertChunkByteLength(data.byteLength);
    return { encoding: "transfer", byteLength: data.byteLength };
  } else {
    throw new TypeError("Unsupported stream chunk encoding");
  }
}

function assertInlineStreamChunkBytes(data: StreamChunkData): void {
  if (data.encoding === "json") {
    const byteLength = serializedJsonByteLength(data.value);
    if (byteLength !== data.byteLength) {
      throw new Error(
        `Stream JSON byteLength mismatch: declared ${data.byteLength}, encoded ${byteLength}`,
      );
    }
  } else if (data.encoding === "base64") {
    decodeValidatedBase64(data.value, data.byteLength);
  }
}

function parseStreamChunkData(value: unknown): StreamChunkData {
  const data = parseStreamChunkDataShape(value);
  assertInlineStreamChunkBytes(data);
  return data;
}

export function assertStreamChunkData(value: unknown): asserts value is StreamChunkData {
  parseStreamChunkData(value);
}

function assertStreamSequence(kind: StreamFrame["kind"], sequence: number): void {
  const minimum = kind === "open" || kind === "windowUpdate" ? 0 : 1;
  if (!Number.isSafeInteger(sequence)
    || sequence < minimum
    || sequence > PLUGIN_WIRE_MAX_SAFE_INTEGER
    || (kind === "open" && sequence !== 0)) {
    const expected = kind === "open"
      ? "exactly 0"
      : `a safe integer between ${minimum} and ${PLUGIN_WIRE_MAX_SAFE_INTEGER}`;
    throw new RangeError(`Stream ${kind} sequence must be ${expected}`);
  }
}

function assertStreamWindowBytes(windowBytes: number): void {
  if (!Number.isInteger(windowBytes)
    || windowBytes < PLUGIN_STREAM_MIN_WINDOW_BYTES
    || windowBytes > PLUGIN_STREAM_MAX_WINDOW_BYTES) {
    throw new RangeError(
      `Stream open windowBytes must be an integer between ${PLUGIN_STREAM_MIN_WINDOW_BYTES} and ${PLUGIN_STREAM_MAX_WINDOW_BYTES}`,
    );
  }
}

function assertStreamCreditBytes(creditBytes: number): void {
  if (!Number.isInteger(creditBytes)
    || creditBytes < 1
    || creditBytes > PLUGIN_STREAM_MAX_CREDIT_BYTES) {
    throw new RangeError(
      `Stream windowUpdate creditBytes must be an integer between 1 and ${PLUGIN_STREAM_MAX_CREDIT_BYTES}`,
    );
  }
}

function parseStreamFrame(value: unknown): StreamFrame {
  const frame = readJsonRecord(value, "Stream frame");
  assertBoundedString(frame.streamId, 1, PLUGIN_STREAM_MAX_ID_LENGTH, "Stream frame streamId");
  if (typeof frame.kind !== "string") {
    throw new TypeError("Stream frame kind must be a string");
  }
  if (typeof frame.sequence !== "number") {
    throw new TypeError("Stream frame sequence must be a number");
  }
  switch (frame.kind) {
    case "open": {
      assertExactKeys(frame, ["streamId", "sequence", "kind", "windowBytes"], "Open stream frame");
      if (typeof frame.windowBytes !== "number") {
        throw new TypeError("Stream open windowBytes must be a number");
      }
      assertStreamSequence(frame.kind, frame.sequence);
      assertStreamWindowBytes(frame.windowBytes);
      return {
        streamId: frame.streamId,
        sequence: 0,
        kind: "open",
        windowBytes: frame.windowBytes,
      };
    }
    case "chunk": {
      assertExactKeys(frame, ["streamId", "sequence", "kind", "data"], "Chunk stream frame");
      assertStreamSequence(frame.kind, frame.sequence);
      return {
        streamId: frame.streamId,
        sequence: frame.sequence,
        kind: "chunk",
        data: parseStreamChunkData(frame.data),
      };
    }
    case "end":
    case "cancel": {
      assertExactKeys(frame, ["streamId", "sequence", "kind"], `${frame.kind} stream frame`);
      assertStreamSequence(frame.kind, frame.sequence);
      return { streamId: frame.streamId, sequence: frame.sequence, kind: frame.kind };
    }
    case "error": {
      assertExactKeys(frame, ["streamId", "sequence", "kind", "error"], "Error stream frame");
      assertStreamSequence(frame.kind, frame.sequence);
      return {
        streamId: frame.streamId,
        sequence: frame.sequence,
        kind: "error",
        error: parseRpcErrorObject(frame.error),
      };
    }
    case "windowUpdate": {
      assertExactKeys(
        frame,
        ["streamId", "sequence", "kind", "creditBytes"],
        "Window-update stream frame",
      );
      if (typeof frame.creditBytes !== "number") {
        throw new TypeError("Stream windowUpdate creditBytes must be a number");
      }
      assertStreamSequence(frame.kind, frame.sequence);
      assertStreamCreditBytes(frame.creditBytes);
      return {
        streamId: frame.streamId,
        sequence: frame.sequence,
        kind: "windowUpdate",
        creditBytes: frame.creditBytes,
      };
    }
    default:
      throw new TypeError(`Unsupported stream frame kind: ${frame.kind}`);
  }
}

export function assertStreamFrame(value: unknown): asserts value is StreamFrame {
  parseStreamFrame(value);
}

function encodeBase64(bytes: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 3) {
    const first = bytes[offset];
    const hasSecond = offset + 1 < bytes.byteLength;
    const hasThird = offset + 2 < bytes.byteLength;
    const second = hasSecond ? bytes[offset + 1] : 0;
    const third = hasThird ? bytes[offset + 2] : 0;
    output += BASE64_ALPHABET[first >> 2];
    output += BASE64_ALPHABET[((first & 0x03) << 4) | (second >> 4)];
    output += hasSecond
      ? BASE64_ALPHABET[((second & 0x0f) << 2) | (third >> 6)]
      : "=";
    output += hasThird ? BASE64_ALPHABET[third & 0x3f] : "=";
  }
  return output;
}

function decodeBase64(value: string): Uint8Array {
  if (value.length > PLUGIN_STREAM_MAX_BASE64_CHARACTERS) {
    throw new RangeError(
      `Stream base64 data exceeds ${PLUGIN_STREAM_MAX_BASE64_CHARACTERS} characters`,
    );
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Stream base64 data is not canonical RFC 4648 base64");
  }
  if (value.length === 0) return new Uint8Array(0);
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const output = new Uint8Array((value.length / 4) * 3 - padding);
  let outputOffset = 0;
  for (let offset = 0; offset < value.length; offset += 4) {
    const first = BASE64_VALUE.get(value[offset]) ?? 0;
    const second = BASE64_VALUE.get(value[offset + 1]) ?? 0;
    const third = BASE64_VALUE.get(value[offset + 2]) ?? 0;
    const fourth = BASE64_VALUE.get(value[offset + 3]) ?? 0;
    if (outputOffset < output.byteLength) output[outputOffset++] = (first << 2) | (second >> 4);
    if (outputOffset < output.byteLength) output[outputOffset++] = (second << 4) | (third >> 2);
    if (outputOffset < output.byteLength) output[outputOffset++] = (third << 6) | fourth;
  }
  if (encodeBase64(output) !== value) {
    throw new Error("Stream base64 data is not canonical RFC 4648 base64");
  }
  return output;
}

function decodeValidatedBase64(value: string, declaredByteLength: number): Uint8Array {
  const bytes = decodeBase64(value);
  if (bytes.byteLength !== declaredByteLength) {
    throw new Error(
      `Stream base64 byteLength mismatch: declared ${declaredByteLength}, decoded ${bytes.byteLength}`,
    );
  }
  return bytes;
}

export function createBase64StreamChunk(bytes: Uint8Array): StreamChunkData {
  assertChunkByteLength(bytes.byteLength);
  return {
    encoding: "base64",
    value: encodeBase64(bytes),
    byteLength: bytes.byteLength,
  };
}

export function createJsonStreamChunk(value: JsonValue): StreamChunkData {
  const byteLength = serializedJsonByteLength(value);
  assertChunkByteLength(byteLength);
  return {
    encoding: "json",
    value,
    byteLength,
  };
}

function materializeValidatedStreamChunk(
  data: StreamChunkData,
  transfer?: ArrayBuffer,
): MaterializedStreamChunk {
  if (data.encoding === "json") {
    if (transfer !== undefined) {
      throw new Error("JSON stream chunks must not include a transferable buffer");
    }
    assertInlineStreamChunkBytes(data);
    return { encoding: "json", value: data.value };
  }
  if (data.encoding === "base64") {
    if (transfer !== undefined) {
      throw new Error("Base64 stream chunks must not include a transferable buffer");
    }
    const bytes = decodeValidatedBase64(data.value, data.byteLength);
    return { encoding: "binary", bytes };
  }
  if (transfer === undefined) {
    throw new Error("Transfer stream chunks require an ArrayBuffer in the message envelope");
  }
  const bytes = materializeArrayBuffer(transfer);
  if (bytes.byteLength !== data.byteLength) {
    throw new Error(
      `Stream transfer byteLength mismatch: declared ${data.byteLength}, received ${bytes.byteLength}`,
    );
  }
  return { encoding: "binary", bytes };
}

export function materializeStreamChunk(
  data: unknown,
  transfer?: ArrayBuffer,
): MaterializedStreamChunk {
  return materializeValidatedStreamChunk(parseStreamChunkDataShape(data), transfer);
}

export function createMessagePortStreamEnvelope(
  frame: unknown,
  transfer?: ArrayBuffer,
): MessagePortStreamEnvelope {
  const validatedFrame = parseStreamFrame(frame);
  if (validatedFrame.kind === "chunk") {
    if (validatedFrame.data.encoding === "transfer") {
      materializeValidatedStreamChunk(validatedFrame.data, transfer);
    } else if (transfer !== undefined) {
      throw new Error("Only transfer-encoded chunk frames may include an ArrayBuffer");
    }
  } else if (transfer !== undefined) {
    throw new Error("Only transfer-encoded chunk frames may include an ArrayBuffer");
  }
  return transfer === undefined
    ? { frame: validatedFrame }
    : { frame: validatedFrame, transfer };
}
