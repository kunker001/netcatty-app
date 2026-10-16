"use strict";

const PLUGIN_JSON_MAX_DEPTH = 128;
const PLUGIN_JSON_MAX_NODES = 100_000;

function jsonStringByteLength(value) {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09
      || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2;
    } else if (code < 0x20) {
      bytes += 6;
    } else if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function assertPluginJsonValue(value, options = {}) {
  const maxBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("Plugin JSON maxBytes must be a positive safe integer");
  }
  const stack = [{ value, depth: 0 }];
  const ancestors = new Set();
  let nodes = 0;
  let bytes = 0;
  const addBytes = (count) => {
    bytes += count;
    if (bytes > maxBytes) throw new RangeError(`Plugin JSON exceeds ${maxBytes} bytes`);
  };
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.exit) {
      ancestors.delete(current.value);
      continue;
    }
    nodes += 1;
    if (nodes > PLUGIN_JSON_MAX_NODES) {
      throw new RangeError(`Plugin JSON exceeds ${PLUGIN_JSON_MAX_NODES} values`);
    }
    if (current.depth > PLUGIN_JSON_MAX_DEPTH) {
      throw new RangeError(`Plugin JSON exceeds ${PLUGIN_JSON_MAX_DEPTH} levels`);
    }
    const item = current.value;
    if (item === null) {
      addBytes(4);
      continue;
    }
    if (typeof item === "string") {
      addBytes(jsonStringByteLength(item));
      continue;
    }
    if (typeof item === "boolean") {
      addBytes(item ? 4 : 5);
      continue;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError("Plugin JSON numbers must be finite");
      addBytes(Buffer.byteLength(String(item), "utf8"));
      continue;
    }
    if (typeof item !== "object") throw new TypeError("Plugin wire values must be JSON values");
    if (ancestors.has(item)) throw new TypeError("Plugin JSON values must not contain cycles");
    ancestors.add(item);
    stack.push({ value: item, depth: current.depth, exit: true });
    if (Array.isArray(item)) {
      addBytes(Math.max(2, item.length + 1));
      if (Object.keys(item).length !== item.length || Reflect.ownKeys(item).length !== item.length + 1) {
        throw new TypeError("Plugin JSON arrays must be dense and contain no named properties");
      }
      for (let index = item.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError("Plugin JSON arrays must contain enumerable data properties only");
        }
        stack.push({ value: descriptor.value, depth: current.depth + 1 });
      }
      continue;
    }
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Plugin JSON objects must be plain objects");
    }
    const stringKeys = Object.keys(item);
    addBytes(Math.max(2, stringKeys.length + 1));
    if (Reflect.ownKeys(item).length !== stringKeys.length) {
      throw new TypeError("Plugin JSON objects must not contain symbols or non-enumerable properties");
    }
    for (let index = stringKeys.length - 1; index >= 0; index -= 1) {
      const descriptor = Object.getOwnPropertyDescriptor(item, stringKeys[index]);
      if (!descriptor || !("value" in descriptor)) {
        throw new TypeError("Plugin JSON objects must contain own data properties");
      }
      addBytes(jsonStringByteLength(stringKeys[index]) + 1);
      stack.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }
  return value;
}

module.exports = {
  PLUGIN_JSON_MAX_DEPTH,
  PLUGIN_JSON_MAX_NODES,
  assertPluginJsonValue,
};
