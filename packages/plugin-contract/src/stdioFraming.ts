import type {
  JsonValue,
  RpcMessage,
  StreamFrame,
} from "./generated/plugin-contract.js";
import {
  assertJsonValue,
  serializeJsonValueWithPropertyObserver,
} from "./jsonValue.js";

export const COMPANION_STDIO_MAX_HEADER_BYTES = 8 * 1024;
export const COMPANION_STDIO_MAX_CONTENT_BYTES = 16 * 1024 * 1024;

const HEADER_SEPARATOR = new Uint8Array([13, 10, 13, 10]);
const ABSOLUTE_MAX_HEADER_BYTES = 64 * 1024;
const BYTE_QUEUE_SLAB_BYTES = 64 * 1024;
const encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

interface ByteQueueChunk {
  readonly bytes: Uint8Array;
  length: number;
}

class ByteQueue {
  readonly #chunks: ByteQueueChunk[] = [];
  #headIndex = 0;
  #headOffset = 0;
  #byteLength = 0;

  get byteLength(): number {
    return this.#byteLength;
  }

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    let inputOffset = 0;
    while (inputOffset < chunk.byteLength) {
      let tail = this.#chunks.at(-1);
      if (!tail || tail.length === tail.bytes.byteLength) {
        const remaining = chunk.byteLength - inputOffset;
        const capacity = remaining >= BYTE_QUEUE_SLAB_BYTES
          ? remaining
          : BYTE_QUEUE_SLAB_BYTES;
        tail = { bytes: new Uint8Array(capacity), length: 0 };
        this.#chunks.push(tail);
      }
      const take = Math.min(
        tail.bytes.byteLength - tail.length,
        chunk.byteLength - inputOffset,
      );
      tail.bytes.set(chunk.subarray(inputOffset, inputOffset + take), tail.length);
      tail.length += take;
      inputOffset += take;
      this.#byteLength += take;
    }
  }

  indexOf(needle: Uint8Array, limit: number): number {
    let matched = 0;
    let index = 0;
    for (let chunkIndex = this.#headIndex; chunkIndex < this.#chunks.length; chunkIndex += 1) {
      const chunk = this.#chunks[chunkIndex];
      const start = chunkIndex === this.#headIndex ? this.#headOffset : 0;
      for (let offset = start; offset < chunk.length; offset += 1) {
        if (index >= limit) return -1;
        const byte = chunk.bytes[offset];
        if (byte === needle[matched]) {
          matched += 1;
          if (matched === needle.byteLength) return index - needle.byteLength + 1;
        } else {
          matched = byte === needle[0] ? 1 : 0;
        }
        index += 1;
      }
    }
    return -1;
  }

  consume(byteLength: number): Uint8Array {
    if (byteLength < 0 || byteLength > this.#byteLength) {
      throw new RangeError(`Cannot consume ${byteLength} bytes from ${this.#byteLength}`);
    }
    const output = new Uint8Array(byteLength);
    let outputOffset = 0;
    let remaining = byteLength;
    while (remaining > 0) {
      const head = this.#chunks[this.#headIndex];
      const available = head.length - this.#headOffset;
      const take = Math.min(available, remaining);
      output.set(
        head.bytes.subarray(this.#headOffset, this.#headOffset + take),
        outputOffset,
      );
      outputOffset += take;
      remaining -= take;
      this.#headOffset += take;
      this.#byteLength -= take;
      if (this.#headOffset === head.length) {
        this.#headIndex += 1;
        this.#headOffset = 0;
      }
    }
    if (this.#byteLength === 0) {
      this.#chunks.length = 0;
      this.#headIndex = 0;
    } else if (this.#headIndex >= 1_024 && this.#headIndex * 2 >= this.#chunks.length) {
      this.#chunks.splice(0, this.#headIndex);
      this.#headIndex = 0;
    }
    return output;
  }
}

function decodeAscii(bytes: Uint8Array): string {
  for (const byte of bytes) {
    if (byte > 0x7f) throw new Error("Companion stdio headers must contain ASCII only");
  }
  return utf8Decoder.decode(bytes);
}

function parseContentLength(headerBytes: Uint8Array, maxContentBytes: number): number {
  const values = new Map<string, string>();
  for (const line of decodeAscii(headerBytes).split("\r\n")) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line);
    if (!match) throw new Error(`Malformed companion stdio header: ${line}`);
    const name = match[1].toLowerCase();
    const value = match[2].trim();
    if (values.has(name)) throw new Error(`Duplicate companion stdio header: ${name}`);
    if (name !== "content-length" && name !== "content-type") {
      throw new Error(`Unsupported companion stdio header: ${name}`);
    }
    values.set(name, value);
  }

  const rawLength = values.get("content-length");
  if (!rawLength || !/^(0|[1-9]\d*)$/.test(rawLength)) {
    throw new Error("Companion stdio frame requires one decimal Content-Length header");
  }
  const contentLength = Number(rawLength);
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw new Error("Companion stdio Content-Length must be a positive safe integer");
  }
  if (contentLength > maxContentBytes) {
    throw new Error(`Companion stdio frame exceeds ${maxContentBytes} bytes`);
  }

  const contentType = values.get("content-type")?.toLowerCase();
  if (contentType !== undefined
    && contentType !== "application/json"
    && contentType !== "application/json; charset=utf-8") {
    throw new Error(`Unsupported companion stdio Content-Type: ${contentType}`);
  }
  return contentLength;
}

export function encodeContentLengthFrame(
  value: JsonValue | RpcMessage | StreamFrame,
): Uint8Array {
  let rootKind: JsonValue | undefined;
  let rootDataEncoding: JsonValue | undefined;
  const serialized = serializeJsonValueWithPropertyObserver(value, (observation) => {
    if (observation.depth === 0 && observation.key === "kind") {
      rootKind = observation.value;
    } else if (observation.depth === 1
      && observation.parentKey === "data"
      && observation.key === "encoding") {
      rootDataEncoding = observation.value;
    }
  });
  if (rootKind === "chunk" && rootDataEncoding === "transfer") {
    throw new Error("Transfer stream chunks cannot be encoded over companion stdio");
  }
  const content = encoder.encode(serialized);
  if (content.byteLength === 0 || content.byteLength > COMPANION_STDIO_MAX_CONTENT_BYTES) {
    throw new Error(
      `Companion stdio content must be between 1 and ${COMPANION_STDIO_MAX_CONTENT_BYTES} bytes`,
    );
  }
  const header = encoder.encode(
    `Content-Length: ${content.byteLength}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n`,
  );
  const frame = new Uint8Array(header.byteLength + content.byteLength);
  frame.set(header, 0);
  frame.set(content, header.byteLength);
  return frame;
}

export interface ContentLengthFrameDecoderOptions {
  readonly maxHeaderBytes?: number;
  readonly maxContentBytes?: number;
}

export class ContentLengthFrameDecoder {
  readonly #queue = new ByteQueue();
  readonly #maxHeaderBytes: number;
  readonly #maxContentBytes: number;
  #expectedContentBytes: number | undefined;

  constructor(options: ContentLengthFrameDecoderOptions = {}) {
    this.#maxHeaderBytes = options.maxHeaderBytes ?? COMPANION_STDIO_MAX_HEADER_BYTES;
    this.#maxContentBytes = options.maxContentBytes ?? COMPANION_STDIO_MAX_CONTENT_BYTES;
    if (!Number.isInteger(this.#maxHeaderBytes)
      || this.#maxHeaderBytes < 32
      || this.#maxHeaderBytes > ABSOLUTE_MAX_HEADER_BYTES) {
      throw new RangeError(
        `maxHeaderBytes must be an integer between 32 and ${ABSOLUTE_MAX_HEADER_BYTES}`,
      );
    }
    if (!Number.isInteger(this.#maxContentBytes)
      || this.#maxContentBytes < 1
      || this.#maxContentBytes > COMPANION_STDIO_MAX_CONTENT_BYTES) {
      throw new RangeError(
        `maxContentBytes must be an integer between 1 and ${COMPANION_STDIO_MAX_CONTENT_BYTES}`,
      );
    }
  }

  push(chunk: Uint8Array | string): JsonValue[] {
    this.#queue.push(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
    const messages: JsonValue[] = [];
    while (true) {
      if (this.#expectedContentBytes === undefined) {
        const separatorIndex = this.#queue.indexOf(
          HEADER_SEPARATOR,
          this.#maxHeaderBytes + HEADER_SEPARATOR.byteLength,
        );
        if (separatorIndex === -1) {
          const maximumIncompleteHeaderBytes = this.#maxHeaderBytes
            + HEADER_SEPARATOR.byteLength
            - 1;
          if (this.#queue.byteLength > maximumIncompleteHeaderBytes) {
            throw new Error(`Companion stdio header exceeds ${this.#maxHeaderBytes} bytes`);
          }
          return messages;
        }
        if (separatorIndex > this.#maxHeaderBytes) {
          throw new Error(`Companion stdio header exceeds ${this.#maxHeaderBytes} bytes`);
        }
        const header = this.#queue.consume(separatorIndex + HEADER_SEPARATOR.byteLength)
          .subarray(0, separatorIndex);
        this.#expectedContentBytes = parseContentLength(header, this.#maxContentBytes);
      }

      if (this.#queue.byteLength < this.#expectedContentBytes) return messages;
      const content = this.#queue.consume(this.#expectedContentBytes);
      this.#expectedContentBytes = undefined;
      let value: unknown;
      try {
        value = JSON.parse(utf8Decoder.decode(content));
      } catch (error) {
        throw new Error(
          `Companion stdio payload is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      try {
        assertJsonValue(value);
      } catch (error) {
        throw new Error(
          `Companion stdio payload is outside the JSON value contract: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      messages.push(value);
    }
  }

  finish(): void {
    if (this.#expectedContentBytes !== undefined || this.#queue.byteLength > 0) {
      throw new Error("Companion stdio stream ended with a truncated frame");
    }
  }
}
