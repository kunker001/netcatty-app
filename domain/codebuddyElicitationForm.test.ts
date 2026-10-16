import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodebuddyElicitationContent,
  initialCodebuddyElicitationValues,
  parseCodebuddyElicitationFields,
  selectedCodebuddyOptionKey,
  toggleCodebuddyArrayOption,
  validateCodebuddyElicitationValues,
} from './codebuddyElicitationForm';

test('CodeBuddy elicitation options preserve typed enum and const values', () => {
  const fields = parseCodebuddyElicitationFields({
    type: 'object',
    properties: {
      retries: {
        type: 'integer',
        enum: [1, 2],
        default: 1,
      },
      enabled: {
        type: 'boolean',
        oneOf: [
          { const: true, title: 'Enabled' },
          { const: false, title: 'Disabled' },
        ],
      },
      mixed: {
        type: 'array',
        items: {
          enum: [1, '1', false],
        },
      },
    },
  });

  assert.equal(fields[0].options[1].value, 2);
  assert.equal(fields[1].options[1].value, false);
  assert.equal(selectedCodebuddyOptionKey(fields[0].options, 1), 'enum:0');
  assert.deepEqual(initialCodebuddyElicitationValues(fields), { retries: 1 });

  let mixed: unknown[] = [];
  mixed = toggleCodebuddyArrayOption(mixed, 1, true);
  mixed = toggleCodebuddyArrayOption(mixed, '1', true);
  mixed = toggleCodebuddyArrayOption(mixed, false, true);
  mixed = toggleCodebuddyArrayOption(mixed, '1', true);

  assert.deepEqual(mixed, [1, '1', false]);
  assert.deepEqual(buildCodebuddyElicitationContent({
    retries: 2,
    enabled: false,
    mixed,
    omitted: undefined,
  }), {
    retries: 2,
    enabled: false,
    mixed: [1, '1', false],
  });
});

test('CodeBuddy elicitation content excludes stale fields from a replaced schema', () => {
  const fields = parseCodebuddyElicitationFields({
    type: 'object',
    properties: {
      current: { type: 'string' },
    },
  });

  assert.deepEqual(buildCodebuddyElicitationContent({
    stale: 'must not leak',
    current: 'kept',
    omitted: undefined,
  }, fields), {
    current: 'kept',
  });
});

test('CodeBuddy elicitation validation enforces numeric and array constraints', () => {
  const fields = parseCodebuddyElicitationFields({
    type: 'object',
    properties: {
      retries: {
        type: 'integer',
        title: 'Retries',
        minimum: 10,
        maximum: 20,
      },
      choices: {
        type: 'array',
        title: 'Choices',
        minItems: 2,
        maxItems: 2,
        items: { enum: ['a', 'b', 'c'] },
      },
    },
    required: ['retries', 'choices'],
  });

  assert.deepEqual(
    validateCodebuddyElicitationValues(fields, {
      retries: 1,
      choices: ['a'],
    }).map(({ fieldId, code, limit }) => ({ fieldId, code, limit })),
    [
      { fieldId: 'retries', code: 'minimum', limit: 10 },
      { fieldId: 'choices', code: 'minItems', limit: 2 },
    ],
  );
  assert.deepEqual(validateCodebuddyElicitationValues(fields, {
    retries: 10.5,
    choices: ['a', 'b', 'c'],
  }).map(({ fieldId, code, limit }) => ({ fieldId, code, limit })), [
    { fieldId: 'retries', code: 'notInteger', limit: undefined },
    { fieldId: 'choices', code: 'maxItems', limit: 2 },
  ]);
  assert.deepEqual(validateCodebuddyElicitationValues(fields, {
    retries: 12,
    choices: ['a', 'b'],
  }), []);
});

test('CodeBuddy elicitation validation reports notInteger for fractional numeric input', () => {
  const fields = parseCodebuddyElicitationFields({
    type: 'object',
    properties: {
      retries: {
        type: 'integer',
        title: 'Retries',
        minimum: 2,
        maximum: 5,
      },
    },
    required: ['retries'],
  });

  const issues = validateCodebuddyElicitationValues(fields, { retries: 3.5 });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'notInteger');
  assert.equal(issues[0].fieldId, 'retries');
  assert.equal(issues[0].fieldTitle, 'Retries');
});

test('CodeBuddy elicitation validation enforces string lengths, formats, and options', () => {
  const fields = parseCodebuddyElicitationFields({
    type: 'object',
    properties: {
      name: {
        type: 'string',
        minLength: 2,
        maxLength: 3,
      },
      email: {
        type: 'string',
        format: 'email',
      },
      date: {
        type: 'string',
        format: 'date',
      },
      dateTime: {
        type: 'string',
        format: 'date-time',
      },
      environment: {
        type: 'string',
        enum: ['staging', 'production'],
      },
      optional: {
        type: 'string',
        default: null,
      },
    },
    required: ['name', 'email', 'date', 'dateTime', 'environment'],
  });

  assert.deepEqual(initialCodebuddyElicitationValues(fields), {});
  assert.deepEqual(
    validateCodebuddyElicitationValues(fields, {
      name: 'a',
      email: 'not-an-email',
      date: '2026-02-30',
      dateTime: '2026-02-30T12:00:00Z',
      environment: 'unknown',
    }).map(({ fieldId, code }) => ({ fieldId, code })),
    [
      { fieldId: 'name', code: 'minLength' },
      { fieldId: 'email', code: 'format' },
      { fieldId: 'date', code: 'format' },
      { fieldId: 'dateTime', code: 'format' },
      { fieldId: 'environment', code: 'option' },
    ],
  );
  assert.deepEqual(validateCodebuddyElicitationValues(fields, {
    name: '猫猫',
    email: 'cat@example.com',
    date: '2026-07-27',
    dateTime: '2026-07-27T15:30:00+08:00',
    environment: 'staging',
  }), []);
});

test('CodeBuddy elicitation validation follows standard email and date-time boundaries', () => {
  const fields = parseCodebuddyElicitationFields({
    type: 'object',
    properties: {
      email: {
        type: 'string',
        format: 'email',
      },
      dateTime: {
        type: 'string',
        format: 'date-time',
      },
    },
    required: ['email', 'dateTime'],
  });

  assert.deepEqual(validateCodebuddyElicitationValues(fields, {
    email: 'cat+alerts@example.com',
    dateTime: '2026-07-27t15:30:00z',
  }), []);
  assert.deepEqual(validateCodebuddyElicitationValues(fields, {
    email: 'cat@example.com',
    dateTime: '1990-12-31T23:59:60Z',
  }), []);
  assert.deepEqual(
    validateCodebuddyElicitationValues(fields, {
      email: 'cat@example..com',
      dateTime: '2026-07-27T15:30:00Z',
    }).map(({ fieldId, code }) => ({ fieldId, code })),
    [{ fieldId: 'email', code: 'format' }],
  );
});

test('CodeBuddy required fields allow empty values unless size constraints reject them', () => {
  const fields = parseCodebuddyElicitationFields({
    type: 'object',
    properties: {
      note: { type: 'string' },
      choices: {
        type: 'array',
        items: { enum: ['a', 'b'] },
      },
      constrainedNote: {
        type: 'string',
        minLength: 1,
      },
      constrainedChoices: {
        type: 'array',
        minItems: 1,
        items: { enum: ['a', 'b'] },
      },
    },
    required: ['note', 'choices', 'constrainedNote', 'constrainedChoices'],
  });

  assert.deepEqual(
    validateCodebuddyElicitationValues(fields, {
      note: '',
      choices: [],
      constrainedNote: '',
      constrainedChoices: [],
    }).map(({ fieldId, code }) => ({ fieldId, code })),
    [
      { fieldId: 'constrainedNote', code: 'minLength' },
      { fieldId: 'constrainedChoices', code: 'minItems' },
    ],
  );
});
