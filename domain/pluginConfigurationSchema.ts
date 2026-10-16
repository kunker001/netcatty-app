const MAX_SCHEMA_DEPTH = 8;
const MAX_SCHEMA_NODES = 256;
const MAX_ENUM_ITEMS = 256;
const MAX_PROPERTY_NAME_LENGTH = 128;
const FORBIDDEN_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const ALLOWED_TYPES = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);
const ALLOWED_KEYWORDS = new Set([
  'additionalProperties',
  'const',
  'enum',
  'items',
  'maxItems',
  'maxLength',
  'maximum',
  'minItems',
  'minLength',
  'minimum',
  'properties',
  'required',
  'type',
  'writeOnly',
]);

type Schema = Record<string, unknown>;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const jsonEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => jsonEqual(value, right[index]));
  }
  if (isPlainRecord(left) && isPlainRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
  }
  return false;
};

const validNonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const validFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const unicodeCharacterLength = (value: string): number => Array.from(value).length;

function assertRestrictedSchema(root: unknown): asserts root is Schema {
  const stack: Array<{ schema: unknown; depth: number }> = [{ schema: root, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !isPlainRecord(current.schema)) throw new TypeError('Schema nodes must be plain objects');
    if (++nodes > MAX_SCHEMA_NODES || current.depth > MAX_SCHEMA_DEPTH) throw new TypeError('Schema is too complex');
    const schema = current.schema;
    if (Object.keys(schema).some((keyword) => !ALLOWED_KEYWORDS.has(keyword))) {
      throw new TypeError('Schema contains an unsupported keyword');
    }
    if (!ALLOWED_TYPES.has(String(schema.type))) throw new TypeError('Schema type is unsupported');
    if (schema.enum !== undefined && (!Array.isArray(schema.enum)
      || schema.enum.length < 1 || schema.enum.length > MAX_ENUM_ITEMS)) {
      throw new TypeError('Schema enum is invalid');
    }
    for (const keyword of ['minItems', 'maxItems', 'minLength', 'maxLength'] as const) {
      if (schema[keyword] !== undefined && !validNonNegativeInteger(schema[keyword])) {
        throw new TypeError(`Schema ${keyword} is invalid`);
      }
    }
    for (const keyword of ['minimum', 'maximum'] as const) {
      if (schema[keyword] !== undefined && !validFiniteNumber(schema[keyword])) {
        throw new TypeError(`Schema ${keyword} is invalid`);
      }
    }
    if (validNonNegativeInteger(schema.minItems) && validNonNegativeInteger(schema.maxItems)
      && schema.minItems > schema.maxItems) throw new TypeError('Schema item bounds are invalid');
    if (validNonNegativeInteger(schema.minLength) && validNonNegativeInteger(schema.maxLength)
      && schema.minLength > schema.maxLength) throw new TypeError('Schema string bounds are invalid');
    if (validFiniteNumber(schema.minimum) && validFiniteNumber(schema.maximum)
      && schema.minimum > schema.maximum) throw new TypeError('Schema numeric bounds are invalid');

    if (schema.type === 'array') {
      if (!isPlainRecord(schema.items)) throw new TypeError('Array schema requires items');
      stack.push({ schema: schema.items, depth: current.depth + 1 });
    } else if (schema.items !== undefined || schema.minItems !== undefined || schema.maxItems !== undefined) {
      throw new TypeError('Array keywords require an array schema');
    }

    if (schema.type === 'object') {
      if (!isPlainRecord(schema.properties) || schema.additionalProperties !== false) {
        throw new TypeError('Object schema must declare closed properties');
      }
      for (const [name, child] of Object.entries(schema.properties)) {
        if (name.length < 1 || name.length > MAX_PROPERTY_NAME_LENGTH || name.includes('\0')
          || FORBIDDEN_PROPERTY_NAMES.has(name)) throw new TypeError('Schema property name is invalid');
        stack.push({ schema: child, depth: current.depth + 1 });
      }
      if (schema.required !== undefined && (!Array.isArray(schema.required)
        || new Set(schema.required).size !== schema.required.length
        || schema.required.some((name) => typeof name !== 'string' || !Object.hasOwn(schema.properties, name)))) {
        throw new TypeError('Schema required fields are invalid');
      }
    } else if (schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined) {
      throw new TypeError('Object keywords require an object schema');
    }
    if (schema.type !== 'string' && (schema.minLength !== undefined || schema.maxLength !== undefined)) {
      throw new TypeError('String keywords require a string schema');
    }
    if (schema.type !== 'number' && schema.type !== 'integer'
      && (schema.minimum !== undefined || schema.maximum !== undefined)) {
      throw new TypeError('Numeric keywords require a numeric schema');
    }
  }
}

function valueMatches(schema: Schema, value: unknown): boolean {
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => jsonEqual(candidate, value))) return false;
  if (schema.const !== undefined && !jsonEqual(schema.const, value)) return false;
  switch (schema.type) {
    case 'null': return value === null;
    case 'boolean': return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string'
        && (!validNonNegativeInteger(schema.minLength) || unicodeCharacterLength(value) >= schema.minLength)
        && (!validNonNegativeInteger(schema.maxLength) || unicodeCharacterLength(value) <= schema.maxLength);
    case 'integer':
    case 'number':
      return validFiniteNumber(value)
        && (schema.type !== 'integer' || Number.isInteger(value))
        && (!validFiniteNumber(schema.minimum) || value >= schema.minimum)
        && (!validFiniteNumber(schema.maximum) || value <= schema.maximum);
    case 'array':
      return Array.isArray(value)
        && (!validNonNegativeInteger(schema.minItems) || value.length >= schema.minItems)
        && (!validNonNegativeInteger(schema.maxItems) || value.length <= schema.maxItems)
        && value.every((item) => valueMatches(schema.items as Schema, item));
    case 'object': {
      if (!isPlainRecord(value)) return false;
      const properties = schema.properties as Record<string, Schema>;
      const required = Array.isArray(schema.required) ? schema.required as string[] : [];
      return required.every((name) => Object.hasOwn(value, name))
        && Object.entries(value).every(([name, item]) => (
          Object.hasOwn(properties, name) && valueMatches(properties[name], item)
        ));
    }
    default: return false;
  }
}

export function pluginConfigurationMatchesSchema(schema: unknown, value: unknown): boolean {
  try {
    assertRestrictedSchema(schema);
    return valueMatches(schema, value);
  } catch {
    return false;
  }
}
