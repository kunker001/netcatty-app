import assert from 'node:assert/strict';
import test from 'node:test';
import type { Host, Snippet } from './models';
import { getScriptApiReference } from './scriptApiReference.ts';
import {
  applySnippetAgentPatch,
  applySnippetCreateToVault,
  applySnippetUpdateToVault,
  buildSnippetFromAgentDraft,
  deleteSnippetFromVault,
  filterScriptSnippets,
  serializeSnippetForAgentGet,
  setHostConnectScriptIds,
} from './snippetAgentOps.ts';

const host: Host = {
  id: 'host-a',
  label: 'A',
  hostname: 'a.example',
  username: 'root',
  os: 'linux',
  protocol: 'ssh',
  tags: [],
};

test('getScriptApiReference includes nct API and wrapper rules', () => {
  const ref = getScriptApiReference();
  assert.match(ref, /nct\.screen\.waitForPrompt/);
  assert.match(ref, /nct\.session\.name/);
  assert.match(ref, /Only JavaScript is executed/);
  assert.match(ref, /onConnect/);
});

test('filterScriptSnippets returns only script kind', () => {
  const snippets: Snippet[] = [
    { id: '1', label: 'cmd', command: 'ls', kind: 'snippet' },
    { id: '2', label: 'auto', command: 'nct.log(1)', kind: 'script' },
  ];
  assert.deepEqual(filterScriptSnippets(snippets).map((s) => s.id), ['2']);
});

test('serializeSnippetForAgentGet includes script metadata', () => {
  const snippet: Snippet = {
    id: 's1',
    label: 'Deploy',
    command: 'await main();',
    kind: 'script',
    trigger: 'onConnect',
    targets: ['host-a'],
    targetGroups: ['Production'],
    language: 'javascript',
  };
  const serialized = serializeSnippetForAgentGet(snippet);
  assert.equal(serialized.kind, 'script');
  assert.equal(serialized.trigger, 'onConnect');
  assert.deepEqual(serialized.targets, ['host-a']);
  assert.deepEqual(serialized.targetGroups, ['Production']);
});

test('agent serialization preserves missing and explicit empty group scopes', () => {
  const unscoped = serializeSnippetForAgentGet({
    id: 'legacy',
    label: 'Legacy',
    command: 'nct.log(1)',
    kind: 'script',
    trigger: 'onOutput',
    triggerPattern: 'READY',
  });
  const disabled = serializeSnippetForAgentGet({
    id: 'disabled',
    label: 'Disabled',
    command: 'nct.log(1)',
    kind: 'script',
    trigger: 'onOutput',
    triggerPattern: 'READY',
    targetGroups: [],
  });

  assert.equal(unscoped.targetGroups, undefined);
  assert.deepEqual(disabled.targetGroups, []);
});

test('buildSnippetFromAgentDraft validates onOutput triggerPattern', () => {
  const bad = buildSnippetFromAgentDraft(
    { label: 'x', command: 'nct.log(1)', trigger: 'onOutput' },
    [],
    { forceKind: 'script' },
  );
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  assert.match(bad.error, /triggerPattern/);

  const good = buildSnippetFromAgentDraft(
    { label: 'x', command: 'nct.log(1)', trigger: 'onOutput', triggerPattern: 'ERROR' },
    [],
    { forceKind: 'script' },
  );
  assert.equal(good.ok, true);
});

test('buildSnippetFromAgentDraft accepts multi-line run mode', () => {
  const result = buildSnippetFromAgentDraft(
    { label: 'login', command: 'user\npass', multiLineRunMode: 'lineDelay' },
    [],
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snippet.multiLineRunMode, 'lineDelay');
});

test('deleteSnippetFromVault removes snippet and host connect references', () => {
  const snippets: Snippet[] = [
    {
      id: 'run',
      label: 'Run',
      command: 'nct.log(1)',
      kind: 'script',
      trigger: 'onConnect',
      targets: ['host-a'],
    },
  ];
  const hosts = [{ ...host, connectScriptIds: ['run'] }];
  const result = deleteSnippetFromVault(snippets, hosts, 'run');
  if ('error' in result) {
    assert.fail(result.error);
  }
  assert.equal(result.snippets.length, 0);
  assert.deepEqual(result.hosts[0].connectScriptIds, []);
});

test('applySnippetCreateToVault syncs onConnect targets to host queue', () => {
  const snippet: Snippet = {
    id: 'run',
    label: 'Run',
    command: 'nct.log(1)',
    kind: 'script',
    trigger: 'onConnect',
    targets: ['host-a'],
  };
  const result = applySnippetCreateToVault([], [host], snippet);
  assert.deepEqual(result.hosts[0].connectScriptIds, ['run']);
});

test('applySnippetUpdateToVault syncs target changes', () => {
  const snippet: Snippet = {
    id: 'run',
    label: 'Run',
    command: 'nct.log(1)',
    kind: 'script',
    trigger: 'onConnect',
    targets: ['host-a'],
  };
  const created = applySnippetCreateToVault([snippet], [host], snippet);
  const updatedSnippet = { ...snippet, targets: [] as string[] | undefined, targetsAllHosts: true };
  const updated = applySnippetUpdateToVault(created.snippets, created.hosts, updatedSnippet, snippet, ['host-a']);
  assert.equal(updated.hosts[0].connectScriptIds?.includes('run'), false);
});

test('applySnippetUpdateToVault clears host queue when onConnect is demoted', () => {
  const snippet: Snippet = {
    id: 'run',
    label: 'Run',
    command: 'nct.log(1)',
    kind: 'script',
    trigger: 'onConnect',
    targets: ['host-a'],
  };
  const host: Host = {
    id: 'host-a',
    label: 'A',
    hostname: 'a.example',
    username: 'root',
    os: 'linux',
    protocol: 'ssh',
    tags: [],
    connectScriptIds: ['run'],
  };
  const created = applySnippetCreateToVault([snippet], [host], snippet);
  const manual = { ...snippet, trigger: 'manual' as const };
  const updated = applySnippetUpdateToVault(created.snippets, created.hosts, manual, snippet);
  assert.equal(updated.hosts[0].connectScriptIds?.includes('run'), false);
});

test('applySnippetAgentPatch clears targetsAllHosts when explicit targets are set', () => {
  const existing: Snippet = {
    id: 'run',
    label: 'Run',
    command: 'nct.log(1)',
    kind: 'script',
    trigger: 'onConnect',
    targetsAllHosts: true,
  };
  const patched = applySnippetAgentPatch(existing, { targets: ['host-a'] });
  assert.equal(patched.ok, true);
  if (!patched.ok) return;
  assert.equal(patched.snippet.targetsAllHosts, undefined);
  assert.deepEqual(patched.snippet.targets, ['host-a']);
});

test('applySnippetAgentPatch supports dynamic groups alongside explicit hosts', () => {
  const existing: Snippet = {
    id: 'run',
    label: 'Run',
    command: 'nct.log(1)',
    kind: 'script',
    trigger: 'onConnect',
    targets: ['host-a'],
  };
  const patched = applySnippetAgentPatch(existing, { targetGroups: ['Production'] });
  assert.equal(patched.ok, true);
  if (!patched.ok) return;
  assert.deepEqual(patched.snippet.targets, ['host-a']);
  assert.deepEqual(patched.snippet.targetGroups, ['Production']);
});

test('agent group targets normalize paths and preserve an explicit empty scope', () => {
  const built = buildSnippetFromAgentDraft({
    label: 'Run',
    command: 'nct.log(1)',
    kind: 'script',
    targetGroups: [' Production\\Web ', 'Production//Web'],
  }, []);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(built.snippet.targetGroups, ['Production/Web']);

  const patched = applySnippetAgentPatch(built.snippet, { targetGroups: [] });
  assert.equal(patched.ok, true);
  if (!patched.ok) return;
  assert.deepEqual(patched.snippet.targetGroups, []);
});

test('applySnippetAgentPatch updates multi-line run mode', () => {
  const existing: Snippet = {
    id: 'login',
    label: 'Login',
    command: 'user\npass',
    multiLineRunMode: 'lineDelay',
  };
  const patched = applySnippetAgentPatch(existing, { multiLineRunMode: 'paste' });
  assert.equal(patched.ok, true);
  if (!patched.ok) return;
  assert.equal(patched.snippet.multiLineRunMode, 'paste');
});

test('setHostConnectScriptIds rejects non-onConnect scripts', () => {
  const snippets: Snippet[] = [
    { id: 'manual', label: 'M', command: 'x', kind: 'script', trigger: 'manual' },
  ];
  const result = setHostConnectScriptIds(host, ['manual'], snippets);
  assert.equal(result.ok, false);
});
