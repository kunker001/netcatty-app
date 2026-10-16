import { RegExpParser, type AST } from '@eslint-community/regexpp';
import { RE2JS } from 're2js';

export const MAX_PLUGIN_COMPLETION_ITEMS = 100;
export const MAX_PLUGIN_DECORATION_RULES = 64;
export const MAX_ACTIVE_PLUGIN_DECORATION_RULES = 16;
export const MAX_ACTIVE_PLUGIN_DECORATION_PATTERNS = 32;
export const MAX_PLUGIN_TERMINAL_RANGES = 64;
export const MAX_PLUGIN_PROMPT_ANNOTATIONS = 8;
export const MAX_PLUGIN_BACKGROUND_LAYERS = 4;
export const DEFAULT_PLUGIN_BACKGROUND_OPACITY = 0.15;

const pluginPatternParser = new RegExpParser({ ecmaVersion: 2025 });
const MAX_PLUGIN_PATTERN_QUANTIFIERS = 32;

export interface PluginTerminalCompletionItem {
  readonly text: string;
  readonly displayText: string;
  readonly description?: string;
  readonly score: number;
  readonly providerId: string;
}

export interface PluginTerminalDecorationRule {
  readonly id: string;
  readonly label: string;
  readonly patterns: readonly string[];
  readonly color: string;
  readonly enabled: true;
  readonly providerId: string;
}

export interface PluginTerminalTextRange {
  readonly start: number;
  readonly length: number;
}

export interface PluginTerminalLink extends PluginTerminalTextRange {
  readonly uri: string;
  readonly label?: string;
  readonly providerId: string;
}

export interface PluginTerminalHover extends PluginTerminalTextRange {
  readonly contents: string;
  readonly providerId: string;
}

export interface PluginTerminalOutputMatch extends PluginTerminalTextRange {
  readonly lineId: string;
  readonly label: string;
  readonly severity: 'info' | 'warning' | 'error' | 'success';
  readonly color?: string;
  readonly providerId: string;
}

export interface PluginTerminalAnnotation {
  readonly text: string;
  readonly color?: string;
  readonly description?: string;
  readonly providerId: string;
}

export interface PluginTerminalSemanticResult {
  readonly classification?: string;
  readonly description?: string;
  readonly destructive: boolean;
  readonly idempotent: boolean;
  readonly annotations: readonly PluginTerminalAnnotation[];
}

export interface PluginTerminalBackgroundLayer {
  readonly id: string;
  readonly color: string;
  readonly opacity: number;
  readonly providerId: string;
}

export const PLUGIN_TERMINAL_THEME_COLOR_KEYS = Object.freeze([
  'background', 'foreground', 'cursor', 'selection',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const);

export type PluginTerminalThemeColor = typeof PLUGIN_TERMINAL_THEME_COLOR_KEYS[number];
export type PluginTerminalThemeColors = Readonly<Partial<Record<PluginTerminalThemeColor, string>>>;

export function normalizePluginThemeResult(
  _providerId: string,
  value: unknown,
): PluginTerminalThemeColors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({});
  const colors = (value as { colors?: unknown }).colors;
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return Object.freeze({});
  const normalized: Partial<Record<PluginTerminalThemeColor, string>> = {};
  for (const key of PLUGIN_TERMINAL_THEME_COLOR_KEYS) {
    const color = (colors as Record<string, unknown>)[key];
    if (typeof color === 'string' && /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u.test(color)) {
      normalized[key] = color;
    }
  }
  return Object.freeze(normalized);
}

function hasUnsafeTextControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069)) return true;
  }
  return false;
}

function boundedString(value: unknown, maximum: number, allowEmpty = false): string | null {
  if (typeof value !== 'string'
    || value.length > maximum
    || (!allowEmpty && value.length < 1)
    || hasUnsafeTextControl(value)) {
    return null;
  }
  return value;
}

function finiteScore(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-1_000_000, Math.min(1_000_000, value))
    : 0;
}

function freezeArray<T extends object>(values: T[]): readonly Readonly<T>[] {
  for (const value of values) Object.freeze(value);
  return Object.freeze(values);
}

function normalizeTextRange(
  value: Record<string, unknown>,
  lineLength: number,
): PluginTerminalTextRange | null {
  const start = value.start;
  const length = value.length;
  if (!Number.isInteger(start) || !Number.isInteger(length)) return null;
  const normalizedStart = start as number;
  const normalizedLength = length as number;
  if (normalizedStart < 0
    || normalizedLength < 1
    || normalizedStart > lineLength
    || normalizedLength > lineLength - normalizedStart) return null;
  return { start: normalizedStart, length: normalizedLength };
}

function normalizeColor(value: unknown): string | undefined | null {
  if (value == null) return undefined;
  const color = boundedString(value, 9);
  return color && /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u.test(color) ? color : null;
}

function normalizeAnnotation(
  providerId: string,
  value: unknown,
): PluginTerminalAnnotation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const text = boundedString(source.text, 512);
  const color = normalizeColor(source.color);
  if (!text || color === null) return null;
  return { text, ...(color === undefined ? {} : { color }), providerId };
}

export function normalizePluginLinkResult(
  providerId: string,
  value: unknown,
  lineLength: number,
): readonly PluginTerminalLink[] {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { links?: unknown }
    : null;
  if (!Number.isInteger(lineLength) || lineLength < 0 || lineLength > 8_192
    || !Array.isArray(source?.links) || source.links.length > MAX_PLUGIN_TERMINAL_RANGES) {
    return Object.freeze([]);
  }
  const links: PluginTerminalLink[] = [];
  for (const candidate of source.links) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    const range = normalizeTextRange(item, lineLength);
    const uri = boundedString(item.uri, 2_048);
    const label = item.label == null ? undefined : boundedString(item.label, 256, true);
    if (!range || !uri || (item.label != null && label == null)) continue;
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
      if (parsed.username || parsed.password) continue;
    } catch {
      continue;
    }
    links.push({ ...range, uri, ...(label === undefined ? {} : { label }), providerId });
  }
  return freezeArray(links);
}

export function normalizePluginHoverResult(
  providerId: string,
  value: unknown,
  lineLength: number,
): readonly PluginTerminalHover[] {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { hovers?: unknown }
    : null;
  if (!Number.isInteger(lineLength) || lineLength < 0 || lineLength > 8_192
    || !Array.isArray(source?.hovers) || source.hovers.length > MAX_PLUGIN_TERMINAL_RANGES) {
    return Object.freeze([]);
  }
  const hovers: PluginTerminalHover[] = [];
  for (const candidate of source.hovers) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    const range = normalizeTextRange(item, lineLength);
    const contents = boundedString(item.contents, 2_048);
    if (!range || !contents) continue;
    hovers.push({ ...range, contents, providerId });
  }
  return freezeArray(hovers);
}

export function normalizePluginMatcherResult(
  providerId: string,
  value: unknown,
  lineLengths: ReadonlyMap<string, number>,
): readonly PluginTerminalOutputMatch[] {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { matches?: unknown }
    : null;
  if (!Array.isArray(source?.matches) || source.matches.length > MAX_PLUGIN_TERMINAL_RANGES) {
    return Object.freeze([]);
  }
  const matches: PluginTerminalOutputMatch[] = [];
  for (const candidate of source.matches) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    const lineId = boundedString(item.lineId, 64);
    const lineLength = lineId ? lineLengths.get(lineId) : undefined;
    if (lineLength === undefined) continue;
    const range = normalizeTextRange(item, lineLength);
    const label = boundedString(item.label, 256);
    const severity = item.severity ?? 'info';
    const color = normalizeColor(item.color);
    if (!range || !label || color === null
      || !['info', 'warning', 'error', 'success'].includes(String(severity))) continue;
    matches.push({
      ...range,
      lineId,
      label,
      severity: severity as PluginTerminalOutputMatch['severity'],
      ...(color === undefined ? {} : { color }),
      providerId,
    });
  }
  return freezeArray(matches);
}

export function normalizePluginSemanticResult(
  providerId: string,
  value: unknown,
): Readonly<PluginTerminalSemanticResult> {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const classification = source.classification == null
    ? undefined
    : boundedString(source.classification, 128);
  const description = source.description == null
    ? undefined
    : boundedString(source.description, 1_024, true);
  const annotationSource = Array.isArray(source.annotations)
    && source.annotations.length <= MAX_PLUGIN_PROMPT_ANNOTATIONS
    ? source.annotations
    : [];
  const annotations = annotationSource
    .map((item) => normalizeAnnotation(providerId, item))
    .filter((item): item is PluginTerminalAnnotation => item !== null);
  return Object.freeze({
    ...(classification ? { classification } : {}),
    ...(description != null ? { description } : {}),
    destructive: source.destructive === true,
    idempotent: source.idempotent === true,
    annotations: freezeArray(annotations),
  });
}

export function normalizePluginPromptResult(
  providerId: string,
  value: unknown,
): readonly PluginTerminalAnnotation[] {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { annotations?: unknown }
    : null;
  if (!Array.isArray(source?.annotations)
    || source.annotations.length > MAX_PLUGIN_PROMPT_ANNOTATIONS) return Object.freeze([]);
  return freezeArray(source.annotations
    .map((item) => normalizeAnnotation(providerId, item))
    .filter((item): item is PluginTerminalAnnotation => item !== null));
}

export function normalizePluginBackgroundResult(
  providerId: string,
  value: unknown,
): readonly PluginTerminalBackgroundLayer[] {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { layers?: unknown }
    : null;
  if (!Array.isArray(source?.layers)
    || source.layers.length > MAX_PLUGIN_BACKGROUND_LAYERS) return Object.freeze([]);
  const layers: PluginTerminalBackgroundLayer[] = [];
  const seen = new Set<string>();
  for (const candidate of source.layers) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    const localId = boundedString(item.id, 128);
    const color = normalizeColor(item.color);
    const opacity = item.opacity == null ? DEFAULT_PLUGIN_BACKGROUND_OPACITY : item.opacity;
    if (!localId || !color || typeof opacity !== 'number' || !Number.isFinite(opacity)
      || opacity < 0 || opacity > 0.35) continue;
    const id = `${providerId}:${localId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    layers.push({ id, color, opacity, providerId });
  }
  return freezeArray(layers);
}

export function normalizePluginBackgroundRefreshAfterMs(value: unknown): number | undefined {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { refreshAfterMs?: unknown }
    : null;
  return Number.isInteger(source?.refreshAfterMs)
    && (source?.refreshAfterMs as number) >= 250
    && (source?.refreshAfterMs as number) <= 60_000
    ? source?.refreshAfterMs as number
    : undefined;
}

export function normalizePluginCompletionResult(
  providerId: string,
  value: unknown,
): readonly PluginTerminalCompletionItem[] {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { items?: unknown }
    : null;
  if (!Array.isArray(source?.items) || source.items.length > MAX_PLUGIN_COMPLETION_ITEMS) return Object.freeze([]);
  const items: PluginTerminalCompletionItem[] = [];
  for (const candidate of source.items) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    const text = boundedString(item.text, 4_096);
    if (!text) continue;
    // Plugin labels must never conceal the bytes that accepting the completion
    // inserts. This is particularly important for serial sessions, where the
    // previewless Enter path can execute a selected suggestion immediately.
    const displayText = text;
    const description = item.description == null ? undefined : boundedString(item.description, 2_048, true);
    if (item.description != null && description == null) continue;
    items.push({
      text,
      displayText,
      ...(description === undefined ? {} : { description }),
      score: finiteScore(item.score),
      providerId,
    });
  }
  return freezeArray(items);
}

export function mergePluginCompletionItems(
  groups: readonly (readonly PluginTerminalCompletionItem[])[],
  maximum: number,
): readonly PluginTerminalCompletionItem[] {
  const seen = new Set<string>();
  const merged = groups.flatMap((group, providerRank) => group.map((item, itemRank) => ({
    item,
    providerRank,
    itemRank,
  })));
  merged.sort((left, right) => right.item.score - left.item.score
    || left.providerRank - right.providerRank
    || left.itemRank - right.itemRank
    || left.item.text.localeCompare(right.item.text));
  const result: PluginTerminalCompletionItem[] = [];
  for (const { item } of merged) {
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    result.push(item);
    if (result.length >= maximum) break;
  }
  return freezeArray(result);
}

interface RegexCharacterDomain {
  readonly any: boolean;
  readonly ascii: ReadonlySet<number>;
  readonly nonAscii: boolean;
}

const anyCharacterDomain = (): RegexCharacterDomain => ({
  any: true,
  ascii: new Set(),
  nonAscii: true,
});

function characterDomain(value: number): RegexCharacterDomain {
  if (value > 0x7f) return { any: false, ascii: new Set(), nonAscii: true };
  const ascii = new Set([value]);
  addAsciiIgnoreCaseEquivalents(ascii);
  return { any: false, ascii, nonAscii: false };
}

function addAsciiRange(target: Set<number>, minimum: number, maximum: number): void {
  for (let value = Math.max(0, minimum); value <= Math.min(0x7f, maximum); value += 1) {
    target.add(value);
  }
}

function addAsciiIgnoreCaseEquivalents(target: Set<number>): void {
  for (const value of [...target]) {
    if (value >= 0x41 && value <= 0x5a) target.add(value + 0x20);
    else if (value >= 0x61 && value <= 0x7a) target.add(value - 0x20);
  }
}

function characterSetDomain(element: AST.CharacterSet): RegexCharacterDomain {
  if (element.kind === 'any' || element.kind === 'property' || element.negate) {
    return anyCharacterDomain();
  }
  const ascii = new Set<number>();
  if (element.kind === 'digit') {
    addAsciiRange(ascii, 0x30, 0x39);
  } else if (element.kind === 'word') {
    addAsciiRange(ascii, 0x30, 0x39);
    addAsciiRange(ascii, 0x41, 0x5a);
    addAsciiRange(ascii, 0x61, 0x7a);
    ascii.add(0x5f);
  } else {
    for (const value of [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]) ascii.add(value);
  }
  addAsciiIgnoreCaseEquivalents(ascii);
  return { any: false, ascii, nonAscii: element.kind !== 'digit' };
}

function characterClassDomain(element: AST.CharacterClass): RegexCharacterDomain {
  if (element.negate || element.unicodeSets) return anyCharacterDomain();
  const ascii = new Set<number>();
  let nonAscii = false;
  for (const member of element.elements) {
    if (member.type === 'Character') {
      if (member.value <= 0x7f) ascii.add(member.value);
      else nonAscii = true;
      continue;
    }
    if (member.type === 'CharacterClassRange') {
      addAsciiRange(ascii, member.min.value, member.max.value);
      if (member.max.value > 0x7f) nonAscii = true;
      continue;
    }
    if (member.type === 'CharacterSet') {
      const domain = characterSetDomain(member);
      if (domain.any) return domain;
      for (const value of domain.ascii) ascii.add(value);
      nonAscii ||= domain.nonAscii;
      continue;
    }
    return anyCharacterDomain();
  }
  addAsciiIgnoreCaseEquivalents(ascii);
  return { any: false, ascii, nonAscii };
}

function quantifiedAtomDomain(element: AST.QuantifiableElement): RegexCharacterDomain | null {
  if (element.type === 'Character') return characterDomain(element.value);
  if (element.type === 'CharacterSet') return characterSetDomain(element);
  if (element.type === 'CharacterClass') return characterClassDomain(element);
  return null;
}

function domainsOverlap(left: RegexCharacterDomain, right: RegexCharacterDomain): boolean {
  if (left.any || right.any) return true;
  if (left.nonAscii && right.nonAscii) return true;
  for (const value of left.ascii) {
    if (right.ascii.has(value)) return true;
  }
  return false;
}

function elementCanBeEmpty(element: AST.Element): boolean {
  if (element.type === 'Assertion') return true;
  if (element.type === 'Quantifier') return element.min === 0;
  if (element.type === 'Group' || element.type === 'CapturingGroup') {
    return element.alternatives.some((alternative) => alternative.elements.every(elementCanBeEmpty));
  }
  return false;
}

function hasAmbiguousQuantifiedAtoms(pattern: AST.Pattern): boolean {
  let quantifierCount = 0;
  const inspectAlternatives = (alternatives: readonly AST.Alternative[]): boolean => {
    for (const alternative of alternatives) {
      const { elements } = alternative;
      for (const element of elements) {
        if (element.type === 'Group' || element.type === 'CapturingGroup') {
          if (inspectAlternatives(element.alternatives)) return true;
        }
        if (element.type !== 'Quantifier') continue;
        quantifierCount += 1;
        if (quantifierCount > MAX_PLUGIN_PATTERN_QUANTIFIERS) return true;
        // Quantified groups, assertions, and backreferences are deliberately
        // outside the accepted linear-time subset.
        if (!quantifiedAtomDomain(element.element)) return true;
      }
      for (let leftIndex = 0; leftIndex < elements.length; leftIndex += 1) {
        const left = elements[leftIndex];
        if (left.type !== 'Quantifier' || left.max <= 1) continue;
        const leftDomain = quantifiedAtomDomain(left.element);
        if (!leftDomain) return true;
        for (let rightIndex = leftIndex + 1; rightIndex < elements.length; rightIndex += 1) {
          const right = elements[rightIndex];
          if (right.type === 'Quantifier' && right.max > 1) {
            const rightDomain = quantifiedAtomDomain(right.element);
            if (!rightDomain || domainsOverlap(leftDomain, rightDomain)) return true;
          }
          if (!elementCanBeEmpty(right)) break;
        }
      }
    }
    return false;
  };
  return inspectAlternatives(pattern.alternatives);
}

export function isSafePluginDecorationPattern(source: string): boolean {
  if (!(source.length > 0
    && source.length <= 512
    && !/\(\?/u.test(source)
    && !/\\(?:[1-9]|k<)/u.test(source)
    && !/\)(?:[*+?]|\{\d+(?:,\d*)?\})/u.test(source))) return false;
  try {
    const pattern = pluginPatternParser.parsePattern(source, 0, source.length, {
      unicode: false,
      unicodeSets: false,
    });
    if (pattern.alternatives.some((alternative) => alternative.elements.every(elementCanBeEmpty))) {
      return false;
    }
    if (hasAmbiguousQuantifiedAtoms(pattern)) return false;
    void RE2JS.compile(source, RE2JS.CASE_INSENSITIVE);
    return true;
  } catch {
    return false;
  }
}

export function normalizePluginDecorationResult(
  providerId: string,
  value: unknown,
): readonly PluginTerminalDecorationRule[] {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { rules?: unknown }
    : null;
  if (!Array.isArray(source?.rules) || source.rules.length > MAX_PLUGIN_DECORATION_RULES) return Object.freeze([]);
  const result: PluginTerminalDecorationRule[] = [];
  const seen = new Set<string>();
  for (const candidate of source.rules) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const rule = candidate as Record<string, unknown>;
    const localId = boundedString(rule.id, 128);
    const label = boundedString(rule.label, 256);
    const color = boundedString(rule.color, 32);
    if (!localId || !label || !color || !/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u.test(color)) continue;
    if (!Array.isArray(rule.patterns) || rule.patterns.length < 1 || rule.patterns.length > 16) continue;
    const patterns = rule.patterns.filter((pattern): pattern is string => (
      typeof pattern === 'string' && isSafePluginDecorationPattern(pattern)
    ));
    if (patterns.length !== rule.patterns.length) continue;
    const id = `${providerId}:${localId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      label,
      patterns: Object.freeze([...patterns]),
      color,
      enabled: true,
      providerId,
    });
  }
  return freezeArray(result);
}

export function mergePluginDecorationRules(
  groups: readonly (readonly PluginTerminalDecorationRule[])[],
  maximum = MAX_ACTIVE_PLUGIN_DECORATION_RULES,
): readonly PluginTerminalDecorationRule[] {
  const result: PluginTerminalDecorationRule[] = [];
  const seen = new Set<string>();
  let patternCount = 0;
  for (const group of groups) {
    for (const rule of group) {
      if (seen.has(rule.id)) continue;
      if (patternCount + rule.patterns.length > MAX_ACTIVE_PLUGIN_DECORATION_PATTERNS) continue;
      seen.add(rule.id);
      result.push(rule);
      patternCount += rule.patterns.length;
      if (result.length >= maximum) return freezeArray(result);
    }
  }
  return freezeArray(result);
}
