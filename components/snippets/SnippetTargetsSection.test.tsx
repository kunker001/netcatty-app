import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SnippetTargetsSection } from './SnippetTargetsSection';

const t = (key: string) => ({
  'snippets.targets.title': 'Targets',
  'snippets.targets.selectHosts': 'Select hosts',
  'snippets.targets.selectGroups': 'Select groups',
  'snippets.targets.add': 'Add targets',
  'snippets.targets.allHosts': 'All hosts',
  'snippets.targets.allHostsShort': 'All hosts',
  'snippets.targets.allHostsActive': 'Every host',
}[key] ?? key);

test('renders dynamic group targets separately from explicit hosts', () => {
  const markup = renderToStaticMarkup(
    <SnippetTargetsSection
      t={t}
      targetHosts={[]}
      targetGroups={['Production/Web']}
      onEditTargets={() => undefined}
      onEditGroups={() => undefined}
    />,
  );
  assert.match(markup, /Production\/Web/);
  assert.match(markup, /Select hosts/);
  assert.match(markup, /Select groups/);
});

test('all-host mode hides host and group pickers', () => {
  const markup = renderToStaticMarkup(
    <SnippetTargetsSection
      t={t}
      targetHosts={[]}
      targetGroups={['Production']}
      onEditTargets={() => undefined}
      onEditGroups={() => undefined}
      targetsAllHosts
      onTargetsAllHostsChange={() => undefined}
    />,
  );
  assert.doesNotMatch(markup, /Select hosts/);
  assert.doesNotMatch(markup, /Select groups/);
  assert.match(markup, /Every host/);
});
