import type { RefObject } from 'react';

import type { Host, KeywordHighlightRule, TerminalSettings } from '../../types';

export type AdditionalTerminalKeywordHighlightRule = Readonly<
  Pick<KeywordHighlightRule, 'id' | 'label' | 'patterns' | 'color' | 'enabled'>
> & { readonly patterns: readonly string[]; readonly providerId?: string };

interface TerminalKeywordHighlightTarget {
  keywordHighlighter: {
    setRules(rules: readonly (KeywordHighlightRule & { readonly providerId?: string })[], enabled: boolean): void;
  };
}

export function applyTerminalKeywordHighlightRules(
  runtime: TerminalKeywordHighlightTarget,
  terminalSettingsRef: RefObject<TerminalSettings | undefined>,
  host: Host,
  additionalRules: readonly AdditionalTerminalKeywordHighlightRule[] = Object.freeze([]),
): void {
  const globalRules = terminalSettingsRef.current?.keywordHighlightRules ?? [];
  const hostRules = host?.keywordHighlightRules ?? [];
  const globalEnabled = terminalSettingsRef.current?.keywordHighlightEnabled ?? false;
  const hostEnabled = host?.keywordHighlightEnabled ?? false;
  const normalizedAdditionalRules = additionalRules.map((rule) => ({
    ...rule,
    patterns: [...rule.patterns],
  }));
  const mergedRules = [
    ...(globalEnabled ? globalRules : []),
    ...(hostEnabled ? hostRules : []),
    ...normalizedAdditionalRules,
  ];
  runtime.keywordHighlighter.setRules(
    mergedRules,
    globalEnabled || hostEnabled || normalizedAdditionalRules.length > 0,
  );
}
