"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertRestrictedJsonSchema,
  compileRestrictedJsonSchema,
} = require("./restrictedJsonSchema.cjs");

function tableSchema() {
  return {
    type: "array",
    maxItems: 8,
    items: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 32 },
        port: { type: "integer", minimum: 1, maximum: 65_535 },
      },
      required: ["name", "port"],
      additionalProperties: false,
    },
  };
}

test("restricted setting schemas validate bounded structured values", () => {
  const validate = compileRestrictedJsonSchema(tableSchema(), { rootType: "array" });
  assert.equal(validate([{ name: "primary", port: 22 }]), true);
  assert.throws(() => validate([{ name: "primary", port: 70_000 }]), /does not match/u);
  assert.throws(() => validate([{ name: "primary", port: 22, token: "secret" }]), /does not match/u);
});

test("restricted setting schemas reject executable or ambiguous JSON Schema features", () => {
  assert.throws(() => assertRestrictedJsonSchema({
    type: "array",
    items: { type: "string", pattern: "(a+)+$" },
  }, { rootType: "array" }), /keyword is not allowed: pattern/u);
  assert.throws(() => assertRestrictedJsonSchema({
    type: "array",
    items: {
      type: "object",
      properties: { constructor: { type: "string" } },
      additionalProperties: false,
    },
  }), /property name is invalid/u);
  assert.throws(() => assertRestrictedJsonSchema({
    type: "object",
    properties: {},
  }), /additionalProperties/u);
  assert.throws(() => assertRestrictedJsonSchema({
    type: "array",
    items: { type: "integer", minimum: 1.2, maximum: 1.8 },
  }, { rootType: "array" }), /no valid value/u);
});
