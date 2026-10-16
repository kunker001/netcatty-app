import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "../../../application/i18n/I18nProvider.tsx";
import type { KeywordHighlightRule } from "../../../domain/models/terminal.ts";
import {
  KeywordHighlightRulesEditor,
  toggleKeywordHighlightRuleEnabled,
} from "./SettingsTerminalTabControls.tsx";

const sampleRules: KeywordHighlightRule[] = [
  {
    id: "error",
    label: "Error",
    patterns: ["\\berror\\b"],
    color: "#F87171",
    enabled: true,
  },
  {
    id: "warning",
    label: "Warning",
    patterns: ["\\bwarn(?:ing)?\\b"],
    color: "#FBBF24",
    enabled: false,
  },
];

test("toggleKeywordHighlightRuleEnabled flips only the selected rule", () => {
  const next = toggleKeywordHighlightRuleEnabled(sampleRules, "error");

  assert.equal(next[0]?.enabled, false);
  assert.equal(next[1]?.enabled, false);
  assert.equal(sampleRules[0]?.enabled, true);
});

test("toggleKeywordHighlightRuleEnabled re-enables a disabled rule", () => {
  const next = toggleKeywordHighlightRuleEnabled(sampleRules, "warning");

  assert.equal(next[0]?.enabled, true);
  assert.equal(next[1]?.enabled, true);
});

test("keyword highlight rules editor exposes a per-rule enable switch", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { locale: "en" },
      React.createElement(KeywordHighlightRulesEditor, {
        rules: sampleRules,
        onChange: () => {},
      }),
    ),
  );

  assert.match(markup, /role="switch" aria-checked="true" aria-label="Error, Enabled"/);
  assert.match(markup, /role="switch" aria-checked="false" aria-label="Warning, Disabled"/);
  assert.match(markup, /line-through/);
});
