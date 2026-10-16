import type { JsonValue } from "./generated/plugin-contract.js";
import {
  PLUGIN_JSON_MAX_DEPTH,
  PLUGIN_JSON_MAX_NODES,
} from "./generated/plugin-contract-limits.js";

export {
  PLUGIN_JSON_MAX_DEPTH,
  PLUGIN_JSON_MAX_NODES,
} from "./generated/plugin-contract-limits.js";

interface JsonValidationBudget {
  nodes: number;
}

function assertJsonValueInternal(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
  budget: JsonValidationBudget,
): void {
  if (depth > PLUGIN_JSON_MAX_DEPTH) {
    throw new RangeError(
      `JSON values must not exceed ${PLUGIN_JSON_MAX_DEPTH} levels of nesting`,
    );
  }
  budget.nodes += 1;
  if (budget.nodes > PLUGIN_JSON_MAX_NODES) {
    throw new RangeError(
      `JSON values must not contain more than ${PLUGIN_JSON_MAX_NODES} nodes`,
    );
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite");
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`Unsupported JSON value type: ${typeof value}`);
  }
  if (ancestors.has(value)) throw new TypeError("JSON values must not contain cycles");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value);
      const ownKeys = Reflect.ownKeys(value);
      if (keys.length !== value.length || ownKeys.length !== value.length + 1) {
        throw new TypeError("JSON arrays must be dense and contain no named properties");
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError("JSON arrays must contain enumerable data properties only");
        }
        assertJsonValueInternal(descriptor.value, ancestors, depth + 1, budget);
      }
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("JSON objects must be plain records");
    }
    const stringKeys = Object.keys(value);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== stringKeys.length) {
      throw new TypeError("JSON objects must not contain symbols or non-enumerable properties");
    }
    for (const key of stringKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new TypeError("JSON objects must not contain accessor properties");
      }
      assertJsonValueInternal(descriptor.value, ancestors, depth + 1, budget);
    }
  } finally {
    ancestors.delete(value);
  }
}

export function assertJsonValue(value: unknown): asserts value is JsonValue {
  assertJsonValueInternal(value, new WeakSet(), 0, { nodes: 0 });
}

export interface JsonValuePropertyObservation {
  readonly depth: number;
  readonly parentKey: string | number | undefined;
  readonly key: string | number;
  readonly value: JsonValue;
}

export type JsonValuePropertyObserver = (
  observation: JsonValuePropertyObservation,
) => void;

function serializeValidatedJsonValue(
  value: JsonValue,
  observer: JsonValuePropertyObserver | undefined,
  depth: number,
  parentKey: string | number | undefined,
): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("Value is not serializable JSON");
    return serialized;
  }
  if (Array.isArray(value)) {
    const serializedItems: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        throw new TypeError("JSON arrays must contain data properties only");
      }
      const item = descriptor.value as JsonValue;
      observer?.({ depth, parentKey, key: index, value: item });
      serializedItems.push(serializeValidatedJsonValue(item, observer, depth + 1, index));
    }
    return `[${serializedItems.join(",")}]`;
  }
  const serializedEntries: string[] = [];
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("JSON objects must contain data properties only");
    }
    const propertyValue = descriptor.value as JsonValue;
    observer?.({ depth, parentKey, key, value: propertyValue });
    serializedEntries.push(
      `${JSON.stringify(key)}:${serializeValidatedJsonValue(
        propertyValue,
        observer,
        depth + 1,
        key,
      )}`,
    );
  }
  return `{${serializedEntries.join(",")}}`;
}

export function serializeJsonValueWithPropertyObserver(
  value: unknown,
  observer: JsonValuePropertyObserver | undefined,
): string {
  assertJsonValue(value);
  return serializeValidatedJsonValue(value, observer, 0, undefined);
}

export function serializeJsonValue(value: unknown): string {
  return serializeJsonValueWithPropertyObserver(value, undefined);
}
