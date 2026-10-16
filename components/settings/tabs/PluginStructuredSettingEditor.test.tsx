import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  createPluginStructuredDefaultValue,
  PluginStructuredSettingEditor,
} from './PluginStructuredSettingEditor';

const labels = {
  add: 'Add item',
  remove: 'Remove item',
  moveUp: (index: number) => `Move ${index} up`,
  moveDown: (index: number) => `Move ${index} down`,
};

test('structured setting defaults preserve nested const, object, and array semantics', () => {
  assert.deepEqual(createPluginStructuredDefaultValue({
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'ssh' },
      enabled: { type: 'boolean' },
      ports: { type: 'array', items: { type: 'integer', minimum: 1 } },
    },
    required: ['kind', 'ports'],
  }), { kind: 'ssh', ports: [] });

  assert.deepEqual(createPluginStructuredDefaultValue({
    type: 'array',
    minItems: 2,
    items: { type: 'string', minLength: 3 },
  }), ['xxx', 'xxx']);
  assert.equal(createPluginStructuredDefaultValue({ type: 'integer', maximum: -2 }), -2);
});

test('structured table settings render native nested controls instead of a JSON textarea', () => {
  const setting = {
    id: 'com.example.routes',
    label: 'Routes',
    control: 'table',
    scope: 'application',
    scopeId: 'application',
    visible: true,
    sortable: true,
    valueSchema: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1 },
          targets: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          note: { type: 'string' },
        },
        required: ['name', 'targets'],
      },
    },
  } as NetcattyPluginSettingContribution;
  const html = renderToStaticMarkup(
    <PluginStructuredSettingEditor
      setting={setting}
      value={[{ name: 'Production', targets: ['host-1'] }]}
      disabled={false}
      onChange={() => {}}
      onCommit={() => {}}
      labels={labels}
    />,
  );

  assert.match(html, /aria-label="Routes name 1"/u);
  assert.match(html, /aria-label="Routes targets 1 1"/u);
  assert.match(html, /aria-label="Add item: note"/u);
  assert.match(html, />Add item</u);
  assert.doesNotMatch(html, /<textarea/u);
});

test('structured enum controls select deserialized object values by canonical JSON equality', () => {
  const setting = {
    id: 'com.example.targets',
    label: 'Targets',
    control: 'list',
    scope: 'application',
    scopeId: 'application',
    visible: true,
    valueSchema: {
      type: 'array',
      items: {
        type: 'object',
        enum: [{ kind: 'host', id: 'one' }, { id: 'two', kind: 'host' }],
        properties: { id: { type: 'string' }, kind: { type: 'string' } },
        required: ['id', 'kind'],
        additionalProperties: false,
      },
    },
  } as NetcattyPluginSettingContribution;
  const html = renderToStaticMarkup(
    <PluginStructuredSettingEditor
      setting={setting}
      value={[{ kind: 'host', id: 'two' }]}
      disabled={false}
      onChange={() => {}}
      onCommit={() => {}}
      labels={labels}
    />,
  );

  assert.match(html, /<option value="1" selected="">/u);
  assert.match(html, /\{&quot;id&quot;:&quot;two&quot;,&quot;kind&quot;:&quot;host&quot;\}/u);
});
