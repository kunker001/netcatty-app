"use strict";

const schema = require("./generated/plugin-contract.schema.json");
const { assertTerminalInterceptorFrameSchema } = require("./contractValidator.cjs");

const limits = schema.$defs.TerminalInterceptorLimits.const;
const TERMINAL_INTERCEPTOR_MAX_CHUNK_BYTES = limits.maxChunkBytes;
const TERMINAL_INTERCEPTOR_MAX_WINDOW_BYTES = limits.maxWindowBytes;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;

function copyOwnDataRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const copy = {};
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`${label} must contain data properties only`);
    }
    copy[key] = descriptor.value;
  }
  return copy;
}

function transferredByteLength(value) {
  if (!arrayBufferByteLength) throw new TypeError("ArrayBuffer byteLength getter is unavailable");
  try {
    const byteLength = arrayBufferByteLength.call(value);
    // The intrinsic getter reports zero for a detached zero-length buffer as
    // well as for a valid empty buffer. Constructing a view distinguishes the
    // two and also works for ArrayBuffers created in another realm.
    new Uint8Array(value);
    return byteLength;
  } catch {
    throw new TypeError("Terminal interceptor transfer requires a real, attached ArrayBuffer");
  }
}

function createTerminalInterceptorEnvelope(frameValue, transfer) {
  const frame = copyOwnDataRecord(frameValue, "Terminal interceptor frame");
  assertTerminalInterceptorFrameSchema(frame);
  const requiresTransfer = frame.type === "netcatty:terminal-interceptor:chunk"
    || (frame.type === "netcatty:terminal-interceptor:result" && frame.status === "ok");
  if (!requiresTransfer) {
    if (transfer !== undefined) {
      throw new TypeError("This terminal interceptor frame must not include a transferred buffer");
    }
    return Object.freeze({ frame: Object.freeze(frame) });
  }
  if (transfer === undefined) {
    throw new TypeError("This terminal interceptor frame requires a transferred ArrayBuffer");
  }
  const byteLength = transferredByteLength(transfer);
  if (byteLength !== frame.byteLength) {
    throw new RangeError(
      `Terminal interceptor byteLength mismatch: declared ${frame.byteLength}, received ${byteLength}`,
    );
  }
  return Object.freeze({ frame: Object.freeze(frame), transfer });
}

module.exports = {
  TERMINAL_INTERCEPTOR_MAX_CHUNK_BYTES,
  TERMINAL_INTERCEPTOR_MAX_WINDOW_BYTES,
  createTerminalInterceptorEnvelope,
};
