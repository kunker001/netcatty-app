import test from "node:test";
import assert from "node:assert/strict";

import { getCompletions } from "./autocomplete/completionEngine";
import { DEFAULT_AUTOCOMPLETE_SETTINGS } from "./autocomplete/useTerminalAutocomplete";
import type { Snippet } from "../../domain/models";

const deploySnippet: Snippet = { id: "d", label: "deploy", command: "kubectl apply -f ." };

test("getCompletions includes snippet suggestions at the command position", async () => {
  const out = await getCompletions("dep", { snippets: [deploySnippet] });
  const snip = out.find((s) => s.source === "snippet");
  assert.ok(snip, "expected a snippet suggestion");
  assert.equal(snip?.displayText, "deploy");
});

test("getCompletions does not surface snippets past the command position", async () => {
  const out = await getCompletions("git dep", { snippets: [deploySnippet] });
  assert.equal(out.find((s) => s.source === "snippet"), undefined);
});

test("getCompletions applies dynamic group targets to the current host", async () => {
  const groupedSnippet: Snippet = {
    ...deploySnippet,
    targetGroups: ["Production"],
  };

  const matching = await getCompletions("dep", {
    hostId: "host-prod",
    hostGroup: "Production/Web",
    snippets: [groupedSnippet],
  });
  const outside = await getCompletions("dep", {
    hostId: "host-dev",
    hostGroup: "Development",
    snippets: [groupedSnippet],
  });

  assert.ok(matching.some((suggestion) => suggestion.source === "snippet"));
  assert.equal(outside.some((suggestion) => suggestion.source === "snippet"), false);
});

test("getCompletions returns more than 8 snippet matches when default maxSuggestions allows it", async () => {
  const snippets: Snippet[] = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`,
    label: `deploy-${String(i).padStart(2, "0")}`,
    command: `echo deploy-${i}`,
  }));

  assert.ok(
    DEFAULT_AUTOCOMPLETE_SETTINGS.maxSuggestions > 8,
    `expected raised default maxSuggestions (>8), got ${DEFAULT_AUTOCOMPLETE_SETTINGS.maxSuggestions}`,
  );

  const out = await getCompletions("dep", {
    snippets,
    maxResults: DEFAULT_AUTOCOMPLETE_SETTINGS.maxSuggestions,
  });
  const snippetMatches = out.filter((s) => s.source === "snippet");
  assert.ok(
    snippetMatches.length > 8,
    `expected more than 8 snippet matches for scrolling popup, got ${snippetMatches.length}`,
  );
  assert.equal(snippetMatches.length, 20);
});
