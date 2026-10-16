import { RE2JS } from 're2js';

export type NonEmptyRangeVisitor = (start: number, length: number) => boolean | void;

export function compileRe2RangeMatcher(pattern: string): (text: string, onMatch: NonEmptyRangeVisitor) => void {
  const compiled = RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
  return (text, onMatch) => {
    const matcher = compiled.matcher(text);
    while (matcher.find()) {
      const start = matcher.start();
      const end = matcher.end();
      if (end > start && onMatch(start, end - start) === false) break;
    }
  };
}

export function forEachNonEmptyRe2Match(
  pattern: string,
  text: string,
  onMatch: NonEmptyRangeVisitor,
): void {
  compileRe2RangeMatcher(pattern)(text, onMatch);
}

export function forEachNonEmptyRegexMatch(
  regex: RegExp,
  text: string,
  onMatch: (match: RegExpExecArray) => void,
) {
  regex.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      if (regex.lastIndex <= match.index) {
        // Advance past the full code point to avoid landing inside a surrogate pair
        const code = text.charCodeAt(match.index);
        regex.lastIndex = match.index + (code >= 0xD800 && code <= 0xDBFF ? 2 : 1);
      }
      if (regex.lastIndex > text.length) {
        break;
      }
      continue;
    }

    onMatch(match);
  }
}
