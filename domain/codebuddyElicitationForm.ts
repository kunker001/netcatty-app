export interface CodebuddyElicitationOption {
  key: string;
  value: unknown;
  label: string;
}

export interface CodebuddyElicitationField {
  id: string;
  title: string;
  description: string;
  type: string;
  required: boolean;
  defaultValue?: unknown;
  options: CodebuddyElicitationOption[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
}

export type CodebuddyElicitationValidationCode =
  | 'required'
  | 'invalidType'
  | 'integer'
  | 'notInteger'
  | 'minimum'
  | 'maximum'
  | 'minLength'
  | 'maxLength'
  | 'minItems'
  | 'maxItems'
  | 'format'
  | 'option';

export interface CodebuddyElicitationValidationIssue {
  fieldId: string;
  fieldTitle: string;
  code: CodebuddyElicitationValidationCode;
  limit?: number;
  format?: string;
}

const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_PATTERN =
  /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)(?:[Zz]|([+-])(\d{2})(?::?(\d{2}))?)$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function fieldOptions(schema: Record<string, unknown>): CodebuddyElicitationOption[] {
  if (Array.isArray(schema.enum)) {
    const labels = Array.isArray(schema.enumNames) ? schema.enumNames : [];
    return schema.enum.map((value, index) => ({
      key: `enum:${index}`,
      value,
      label: String(labels[index] ?? value),
    }));
  }
  const variants = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : [];
  return variants.flatMap((variant, index) => {
    const option = asRecord(variant);
    return !Object.prototype.hasOwnProperty.call(option, 'const')
      ? []
      : [{
          key: `variant:${index}`,
          value: option.const,
          label: String(option.title ?? option.const),
        }];
  });
}

export function parseCodebuddyElicitationFields(
  requestedSchema: unknown,
): CodebuddyElicitationField[] {
  const schema = asRecord(requestedSchema);
  const properties = asRecord(schema.properties);
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.map((value) => String(value)) : [],
  );
  return Object.entries(properties).map(([id, rawField]) => {
    const field = asRecord(rawField);
    const type = String(field.type || 'string');
    return {
      id,
      title: String(field.title || id),
      description: String(field.description || ''),
      type,
      required: required.has(id),
      defaultValue: field.default === null ? undefined : field.default,
      options: fieldOptions(type === 'array' ? asRecord(field.items) : field),
      minimum: optionalNumber(field.minimum),
      maximum: optionalNumber(field.maximum),
      minLength: optionalNumber(field.minLength),
      maxLength: optionalNumber(field.maxLength),
      minItems: optionalNumber(field.minItems),
      maxItems: optionalNumber(field.maxItems),
      format: typeof field.format === 'string' ? field.format : undefined,
    };
  });
}

export function initialCodebuddyElicitationValues(
  fields: CodebuddyElicitationField[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.id, field.defaultValue]),
  );
}

export function selectedCodebuddyOptionKey(
  options: CodebuddyElicitationOption[],
  value: unknown,
): string {
  return options.find((option) => Object.is(option.value, value))?.key || '';
}

export function toggleCodebuddyArrayOption(
  currentValue: unknown,
  optionValue: unknown,
  checked: boolean,
): unknown[] {
  const selected = Array.isArray(currentValue) ? currentValue : [];
  if (checked) {
    return selected.some((value) => Object.is(value, optionValue))
      ? selected
      : [...selected, optionValue];
  }
  return selected.filter((value) => !Object.is(value, optionValue));
}

export function buildCodebuddyElicitationContent(
  values: Record<string, unknown>,
  fields?: CodebuddyElicitationField[],
): Record<string, unknown> {
  const allowedFieldIds = fields
    ? new Set(fields.map((field) => field.id))
    : null;
  return Object.fromEntries(
    Object.entries(values).filter(
      ([fieldId, value]) => value !== undefined
        && (!allowedFieldIds || allowedFieldIds.has(fieldId)),
    ),
  );
}

function hasOptionValue(
  options: CodebuddyElicitationOption[],
  value: unknown,
): boolean {
  return options.some((option) => Object.is(option.value, value));
}

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidDateTime(value: string): boolean {
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match || !isValidDate(match[1])) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  const offsetSign = match[5] === '-' ? -1 : 1;
  const offsetHour = match[6] === undefined ? 0 : Number(match[6]);
  const offsetMinute = match[7] === undefined ? 0 : Number(match[7]);
  if (offsetHour > 23 || offsetMinute > 59) return false;
  if (hour <= 23 && minute <= 59 && second < 60) return true;

  const utcMinute = minute - offsetMinute * offsetSign;
  const utcHour = hour - offsetHour * offsetSign - (utcMinute < 0 ? 1 : 0);
  return (utcHour === 23 || utcHour === -1)
    && (utcMinute === 59 || utcMinute === -1)
    && second < 61;
}

function matchesFormat(value: string, format: string | undefined): boolean {
  if (!format) return true;
  if (format === 'email') {
    return EMAIL_PATTERN.test(value);
  }
  if (format === 'uri') {
    try {
      return Boolean(new URL(value).protocol);
    } catch {
      return false;
    }
  }
  if (format === 'date') {
    return isValidDate(value);
  }
  if (format === 'date-time') {
    return isValidDateTime(value);
  }
  return true;
}

function issue(
  field: CodebuddyElicitationField,
  code: CodebuddyElicitationValidationCode,
  details: Pick<CodebuddyElicitationValidationIssue, 'limit' | 'format'> = {},
): CodebuddyElicitationValidationIssue {
  return {
    fieldId: field.id,
    fieldTitle: field.title,
    code,
    ...details,
  };
}

function validateField(
  field: CodebuddyElicitationField,
  value: unknown,
): CodebuddyElicitationValidationIssue | null {
  if (value === undefined) {
    return field.required ? issue(field, 'required') : null;
  }

  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') return issue(field, 'invalidType');
    if (field.options.length > 0 && !hasOptionValue(field.options, value)) {
      return issue(field, 'option');
    }
    return null;
  }

  if (field.type === 'array') {
    if (!Array.isArray(value)) return issue(field, 'invalidType');
    if (field.minItems !== undefined && value.length < field.minItems) {
      return issue(field, 'minItems', { limit: field.minItems });
    }
    if (field.maxItems !== undefined && value.length > field.maxItems) {
      return issue(field, 'maxItems', { limit: field.maxItems });
    }
    if (
      field.options.length > 0 &&
      value.some((selected) => !hasOptionValue(field.options, selected))
    ) {
      return issue(field, 'option');
    }
    return null;
  }

  if (field.type === 'number' || field.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return issue(field, 'invalidType');
    }
    if (field.type === 'integer' && !Number.isInteger(value)) {
      return issue(field, 'notInteger');
    }
    if (field.minimum !== undefined && value < field.minimum) {
      return issue(field, 'minimum', { limit: field.minimum });
    }
    if (field.maximum !== undefined && value > field.maximum) {
      return issue(field, 'maximum', { limit: field.maximum });
    }
    if (field.options.length > 0 && !hasOptionValue(field.options, value)) {
      return issue(field, 'option');
    }
    return null;
  }

  if (typeof value !== 'string') return issue(field, 'invalidType');
  const length = [...value].length;
  if (field.minLength !== undefined && length < field.minLength) {
    return issue(field, 'minLength', { limit: field.minLength });
  }
  if (field.maxLength !== undefined && length > field.maxLength) {
    return issue(field, 'maxLength', { limit: field.maxLength });
  }
  if (!matchesFormat(value, field.format)) {
    return issue(field, 'format', { format: field.format });
  }
  if (field.options.length > 0 && !hasOptionValue(field.options, value)) {
    return issue(field, 'option');
  }
  return null;
}

export function validateCodebuddyElicitationValues(
  fields: CodebuddyElicitationField[],
  values: Record<string, unknown>,
): CodebuddyElicitationValidationIssue[] {
  return fields.flatMap((field) => {
    const validationIssue = validateField(field, values[field.id]);
    return validationIssue ? [validationIssue] : [];
  });
}
