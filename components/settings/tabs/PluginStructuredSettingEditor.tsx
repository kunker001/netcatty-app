import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import React from 'react';

import { canonicalJsonString, jsonValuesEqual } from '../../../domain/convergentSync/json';
import type { JsonValue } from '../../../domain/convergentSync/types';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';

type RestrictedSchema = {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: RestrictedSchema;
  properties?: Record<string, RestrictedSchema>;
  required?: string[];
};

function asSchema(value: unknown): RestrictedSchema {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RestrictedSchema : {};
}

export function createPluginStructuredDefaultValue(schema: RestrictedSchema): unknown {
  if (schema.const !== undefined) return structuredClone(schema.const);
  if (schema.enum?.length) return structuredClone(schema.enum[0]);
  if (schema.type === 'boolean') return false;
  if (schema.type === 'number' || schema.type === 'integer') {
    if (schema.type === 'integer') {
      return schema.minimum !== undefined
        ? Math.ceil(schema.minimum)
        : Math.min(0, Math.floor(schema.maximum ?? 0));
    }
    return schema.minimum ?? Math.min(0, schema.maximum ?? 0);
  }
  if (schema.type === 'array') {
    return Array.from(
      { length: schema.minItems ?? 0 },
      () => createPluginStructuredDefaultValue(asSchema(schema.items)),
    );
  }
  if (schema.type === 'null') return null;
  if (schema.type === 'object') {
    const required = new Set(schema.required ?? []);
    return Object.fromEntries(Object.entries(schema.properties ?? {})
      .filter(([key]) => required.has(key))
      .map(([key, child]) => [key, createPluginStructuredDefaultValue(child)]));
  }
  return ''.padEnd(schema.minLength ?? 0, 'x');
}

function StructuredValueInput({
  schema,
  value,
  disabled,
  label,
  onChange,
  onCommit,
  sortable = false,
  labels,
}: {
  schema: RestrictedSchema;
  value: unknown;
  disabled: boolean;
  label: string;
  onChange(value: unknown): void;
  onCommit(value: unknown): void;
  sortable?: boolean;
  labels: { add: string; remove: string; moveUp(index: number): string; moveDown(index: number): string };
}) {
  if (schema.const !== undefined) {
    return <code className="block rounded bg-muted/40 px-2 py-1.5 text-xs">{JSON.stringify(schema.const)}</code>;
  }
  if (schema.enum?.length) {
    const selectedIndex = schema.enum.findIndex((candidate) => (
      jsonValuesEqual(candidate as JsonValue, value as JsonValue)
    ));
    return (
      <select
        aria-label={label}
        value={String(Math.max(0, selectedIndex))}
        disabled={disabled}
        onChange={(event) => {
          const selected = schema.enum?.[Number(event.target.value)];
          onChange(selected);
          onCommit(selected);
        }}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        {schema.enum.map((candidate, index) => (
          <option key={`${index}:${JSON.stringify(candidate)}`} value={String(index)}>
            {typeof candidate === 'string' ? candidate : canonicalJsonString(candidate as JsonValue)}
          </option>
        ))}
      </select>
    );
  }
  if (schema.type === 'null') {
    return <code className="block rounded bg-muted/40 px-2 py-1.5 text-xs">null</code>;
  }
  if (schema.type === 'boolean') {
    return (
      <input
        aria-label={label}
        type="checkbox"
        checked={value === true}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
          onCommit(event.target.checked);
        }}
        className="h-4 w-4 accent-primary"
      />
    );
  }
  if (schema.type === 'object') {
    const record = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const required = new Set(schema.required ?? []);
    return (
      <div className="space-y-2 rounded-md border border-border/60 p-2">
        {Object.entries(schema.properties ?? {}).map(([key, child]) => {
          const present = Object.hasOwn(record, key);
          if (!required.has(key) && !present) {
            return (
              <div key={key} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-muted-foreground">{key}</span>
                <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => {
                  const next = { ...record, [key]: createPluginStructuredDefaultValue(child) };
                  onChange(next);
                  onCommit(next);
                }} aria-label={`${labels.add}: ${key}`}><Plus size={13} className="mr-2" />{labels.add}</Button>
              </div>
            );
          }
          return (
          <div key={key} className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">{key}</span>
            <div className="flex items-start gap-1">
              <div className="min-w-0 flex-1">
                <StructuredValueInput
                  schema={child}
                  value={record[key]}
                  disabled={disabled}
                  label={`${label} ${key}`}
                  labels={labels}
                  onChange={(next) => onChange({ ...record, [key]: next })}
                  onCommit={(next) => onCommit({ ...record, [key]: next })}
                />
              </div>
              {!required.has(key) && <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" disabled={disabled} onClick={() => {
                const next = { ...record };
                delete next[key];
                onChange(next);
                onCommit(next);
              }} aria-label={`${labels.remove}: ${key}`}><Trash2 size={13} /></Button>}
            </div>
          </div>
          );
        })}
      </div>
    );
  }
  if (schema.type === 'array') {
    const items = Array.isArray(value) ? value : [];
    const itemSchema = asSchema(schema.items);
    const commitItems = (next: unknown[]) => {
      onChange(next);
      onCommit(next);
    };
    return (
      <div className="space-y-2 rounded-md border border-border/60 p-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <StructuredValueInput
                schema={itemSchema}
                value={item}
                disabled={disabled}
                label={`${label} ${index + 1}`}
                labels={labels}
                onChange={(nextItem) => {
                  const next = [...items];
                  next[index] = nextItem;
                  onChange(next);
                }}
                onCommit={(nextItem) => {
                  const next = [...items];
                  next[index] = nextItem;
                  onCommit(next);
                }}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {sortable && <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={disabled || index === 0} onClick={() => {
                const next = [...items];
                const [moved] = next.splice(index, 1);
                next.splice(index - 1, 0, moved);
                commitItems(next);
              }} aria-label={labels.moveUp(index)}><ArrowUp size={13} /></Button>}
              {sortable && <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={disabled || index === items.length - 1} onClick={() => {
                const next = [...items];
                const [moved] = next.splice(index, 1);
                next.splice(index + 1, 0, moved);
                commitItems(next);
              }} aria-label={labels.moveDown(index)}><ArrowDown size={13} /></Button>}
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" disabled={disabled || items.length <= (schema.minItems ?? 0)} onClick={() => commitItems(items.filter((_item, itemIndex) => itemIndex !== index))} aria-label={labels.remove}><Trash2 size={13} /></Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" disabled={disabled || items.length >= (schema.maxItems ?? Number.POSITIVE_INFINITY)} onClick={() => commitItems([...items, createPluginStructuredDefaultValue(itemSchema)])}>
          <Plus size={13} className="mr-2" />{labels.add}
        </Button>
      </div>
    );
  }
  const numeric = schema.type === 'number' || schema.type === 'integer';
  return (
    <Input
      aria-label={label}
      type={numeric ? 'number' : 'text'}
      value={numeric ? Number(value ?? 0) : String(value ?? '')}
      min={schema.minimum}
      max={schema.maximum}
      minLength={schema.minLength}
      maxLength={schema.maxLength}
      step={schema.type === 'integer' ? 1 : undefined}
      disabled={disabled}
      onChange={(event) => onChange(numeric ? Number(event.target.value) : event.target.value)}
      onBlur={(event) => onCommit(numeric ? Number(event.currentTarget.value) : event.currentTarget.value)}
      className="min-w-28"
    />
  );
}

export function PluginStructuredSettingEditor({
  setting,
  value,
  disabled,
  onChange,
  onCommit,
  labels,
}: {
  setting: NetcattyPluginSettingContribution;
  value: unknown;
  disabled: boolean;
  onChange(value: unknown[]): void;
  onCommit(value: unknown[]): void;
  labels: { add: string; remove: string; moveUp(index: number): string; moveDown(index: number): string };
}) {
  const root = asSchema(setting.valueSchema);
  const itemSchema = asSchema(root.items);
  const items = Array.isArray(value) ? value : [];
  const properties = itemSchema.type === 'object' && !itemSchema.enum?.length && itemSchema.const === undefined
    ? Object.entries(itemSchema.properties ?? {})
    : [];
  const updateItem = (index: number, nextItem: unknown, commit: boolean) => {
    const next = [...items];
    next[index] = nextItem;
    onChange(next);
    if (commit) onCommit(next);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
    onCommit(next);
  };
  const remove = (index: number) => {
    const next = items.filter((_item, itemIndex) => itemIndex !== index);
    onChange(next);
    onCommit(next);
  };
  const add = () => {
    const next = [...items, createPluginStructuredDefaultValue(itemSchema)];
    onChange(next);
    onCommit(next);
  };

  return (
    <div className="max-w-2xl space-y-2">
      {properties.length > 0 && (
        <div className="grid gap-2 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          style={{ gridTemplateColumns: `repeat(${properties.length}, minmax(7rem, 1fr)) auto` }}>
          {properties.map(([key]) => <span key={key}>{key}</span>)}
          <span className="sr-only">Actions</span>
        </div>
      )}
      {items.map((item, index) => {
        const objectItem = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
        const required = new Set(itemSchema.required ?? []);
        return (
          <div
            key={`${setting.id}:${index}`}
            className="grid items-center gap-2 rounded-md border border-border/70 bg-muted/10 p-2"
            style={{ gridTemplateColumns: properties.length ? `repeat(${properties.length}, minmax(7rem, 1fr)) auto` : 'minmax(0, 1fr) auto' }}
          >
            {properties.length ? properties.map(([key, schema]) => {
              const present = Object.hasOwn(objectItem, key);
              if (!required.has(key) && !present) {
                return <Button key={key} type="button" variant="outline" size="sm" disabled={disabled} onClick={() => updateItem(index, {
                  ...objectItem,
                  [key]: createPluginStructuredDefaultValue(schema),
                }, true)} aria-label={`${labels.add}: ${key}`}><Plus size={13} className="mr-2" />{labels.add}</Button>;
              }
              return (
                <div key={key} className="flex min-w-0 items-start gap-1">
                  <div className="min-w-0 flex-1">
                    <StructuredValueInput
                      schema={schema}
                      value={objectItem[key]}
                      disabled={disabled}
                      label={`${setting.label} ${key} ${index + 1}`}
                      labels={labels}
                      onChange={(next) => updateItem(index, { ...objectItem, [key]: next }, false)}
                      onCommit={(next) => updateItem(index, { ...objectItem, [key]: next }, true)}
                    />
                  </div>
                  {!required.has(key) && <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" disabled={disabled} onClick={() => {
                    const next = { ...objectItem };
                    delete next[key];
                    updateItem(index, next, true);
                  }} aria-label={`${labels.remove}: ${key}`}><Trash2 size={13} /></Button>}
                </div>
              );
            }) : (
              <StructuredValueInput
                schema={itemSchema}
                value={item}
                disabled={disabled}
                label={`${setting.label} ${index + 1}`}
                labels={labels}
                sortable={setting.sortable}
                onChange={(next) => updateItem(index, next, false)}
                onCommit={(next) => updateItem(index, next, true)}
              />
            )}
            <div className="flex items-center justify-end gap-1">
              {setting.sortable && (
                <>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={disabled || index === 0} onClick={() => move(index, index - 1)} aria-label={labels.moveUp(index)}><ArrowUp size={13} /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={disabled || index === items.length - 1} onClick={() => move(index, index + 1)} aria-label={labels.moveDown(index)}><ArrowDown size={13} /></Button>
                </>
              )}
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" disabled={disabled || items.length <= (root.minItems ?? 0)} onClick={() => remove(index)} aria-label={labels.remove}><Trash2 size={13} /></Button>
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" disabled={disabled || items.length >= (root.maxItems ?? Number.POSITIVE_INFINITY)} onClick={add}>
        <Plus size={13} className="mr-2" />{labels.add}
      </Button>
    </div>
  );
}
