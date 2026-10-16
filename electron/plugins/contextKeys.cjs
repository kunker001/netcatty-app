"use strict";

const MAX_EXPRESSION_LENGTH = 2_048;
const MAX_TOKENS = 256;
const IDENTIFIER = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,255}/u;
const FULL_IDENTIFIER = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,255}$/u;
const PLUGIN_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;
const PLUGIN_CONTEXT_KEY_SUFFIX = /^[A-Za-z0-9_][A-Za-z0-9_:-]{0,255}$/u;

class ContextKeySyntaxError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContextKeySyntaxError";
  }
}

function tokenize(expression) {
  if (typeof expression !== "string" || expression.length < 1 || expression.length > MAX_EXPRESSION_LENGTH) {
    throw new ContextKeySyntaxError("Context Key expression length is invalid");
  }
  const tokens = [];
  let offset = 0;
  const push = (type, value = type) => {
    if (tokens.length >= MAX_TOKENS) throw new ContextKeySyntaxError("Context Key expression is too complex");
    tokens.push({ type, value });
  };
  while (offset < expression.length) {
    const rest = expression.slice(offset);
    const whitespace = /^\s+/u.exec(rest);
    if (whitespace) { offset += whitespace[0].length; continue; }
    const operator = /^(===|!==|&&|\|\||==|!=|>=|<=|>|<|!|\(|\))/u.exec(rest);
    if (operator) { push(operator[0]); offset += operator[0].length; continue; }
    const quoted = /^("(?:[^"\\]|\\["\\bfnrt]|\\u[0-9a-fA-F]{4})*"|'(?:[^'\\]|\\['\\bfnrt]|\\u[0-9a-fA-F]{4})*')/u.exec(rest);
    if (quoted) {
      const source = quoted[0];
      let value;
      try {
        value = source[0] === "\"" ? JSON.parse(source) : JSON.parse(`"${source.slice(1, -1).replace(/\\'/gu, "'").replace(/"/gu, '\\"')}"`);
      } catch { throw new ContextKeySyntaxError("Context Key string is invalid"); }
      push("literal", value);
      offset += source.length;
      continue;
    }
    const identifier = IDENTIFIER.exec(rest);
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?/u.exec(rest);
    if (number && (!identifier || number[0].length >= identifier[0].length)) {
      push("literal", Number(number[0]));
      offset += number[0].length;
      continue;
    }
    if (!identifier) throw new ContextKeySyntaxError(`Unexpected Context Key token at ${offset}`);
    offset += identifier[0].length;
    if (identifier[0] === "true") push("literal", true);
    else if (identifier[0] === "false") push("literal", false);
    else if (identifier[0] === "null") push("literal", null);
    else if (identifier[0] === "in") push("in");
    else if (identifier[0] === "not") push("not");
    else push("identifier", identifier[0]);
  }
  push("eof");
  return tokens;
}

function parseContextKeyExpression(expression) {
  const tokens = tokenize(expression);
  let index = 0;
  const current = () => tokens[index];
  const consume = (type) => {
    if (current().type !== type) throw new ContextKeySyntaxError(`Expected ${type}`);
    return tokens[index++];
  };
  const primary = () => {
    if (current().type === "literal") return { type: "literal", value: consume("literal").value };
    if (current().type === "identifier") return { type: "key", name: consume("identifier").value };
    if (current().type === "(") {
      consume("(");
      const value = or();
      consume(")");
      return value;
    }
    throw new ContextKeySyntaxError("Expected Context Key value");
  };
  const unary = () => current().type === "!"
    ? (consume("!"), { type: "not", value: unary() })
    : primary();
  const comparison = () => {
    const left = unary();
    let operator = current().type;
    if (operator === "not" && tokens[index + 1]?.type === "in") {
      consume("not"); consume("in"); operator = "not in";
    } else if (["==", "===", "!=", "!==", ">", ">=", "<", "<=", "in"].includes(operator)) {
      consume(operator);
    } else return left;
    return { type: "compare", operator, left, right: unary() };
  };
  const and = () => {
    let value = comparison();
    while (current().type === "&&") { consume("&&"); value = { type: "and", left: value, right: comparison() }; }
    return value;
  };
  const or = () => {
    let value = and();
    while (current().type === "||") { consume("||"); value = { type: "or", left: value, right: and() }; }
    return value;
  };
  const syntax = or();
  consume("eof");
  return Object.freeze(syntax);
}

function contextValue(context, key) {
  if (context instanceof Map) return context.get(key);
  if (!context || typeof context !== "object") return undefined;
  return Object.hasOwn(context, key) ? context[key] : undefined;
}

function evaluateSyntax(node, context) {
  if (node.type === "literal") return node.value;
  if (node.type === "key") return contextValue(context, node.name);
  if (node.type === "not") return !Boolean(evaluateSyntax(node.value, context));
  if (node.type === "and") return Boolean(evaluateSyntax(node.left, context)) && Boolean(evaluateSyntax(node.right, context));
  if (node.type === "or") return Boolean(evaluateSyntax(node.left, context)) || Boolean(evaluateSyntax(node.right, context));
  const left = evaluateSyntax(node.left, context);
  const right = evaluateSyntax(node.right, context);
  switch (node.operator) {
    case "==": case "===": return left === right;
    case "!=": case "!==": return left !== right;
    case ">": return typeof left === typeof right && left > right;
    case ">=": return typeof left === typeof right && left >= right;
    case "<": return typeof left === typeof right && left < right;
    case "<=": return typeof left === typeof right && left <= right;
    case "in": return Array.isArray(right) ? right.includes(left) : Boolean(right && typeof right === "object" && Object.hasOwn(right, String(left)));
    case "not in": return !(Array.isArray(right) ? right.includes(left) : Boolean(right && typeof right === "object" && Object.hasOwn(right, String(left))));
    default: return false;
  }
}

function evaluateContextKeyExpression(expression, context) {
  if (expression == null || expression === "") return true;
  try { return Boolean(evaluateSyntax(parseContextKeyExpression(expression), context)); }
  catch { return false; }
}

function assertPluginContextKey(pluginId, key) {
  if (typeof pluginId !== "string" || pluginId.length > 128 || !PLUGIN_ID.test(pluginId)) {
    throw new TypeError("Plugin ID is invalid");
  }
  const prefix = `${pluginId}.`;
  const suffix = typeof key === "string" && key.startsWith(prefix)
    ? key.slice(prefix.length)
    : "";
  if (typeof key !== "string" || !FULL_IDENTIFIER.test(key) || !PLUGIN_CONTEXT_KEY_SUFFIX.test(suffix)) {
    throw new TypeError(`Plugin Context Key must be namespaced to ${pluginId}`);
  }
  return key;
}

module.exports = {
  ContextKeySyntaxError,
  MAX_EXPRESSION_LENGTH,
  MAX_TOKENS,
  assertPluginContextKey,
  evaluateContextKeyExpression,
  parseContextKeyExpression,
  tokenize,
};
