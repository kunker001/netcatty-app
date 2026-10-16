import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/application/i18n/I18nProvider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { netcattyBridge } from '@/infrastructure/services/netcattyBridge.ts';
import type {
  ScriptDialogCondition,
  ScriptDialogField,
  ScriptDialogForm,
  ScriptDialogFormValue,
  ScriptDialogRequest,
} from '@/types/global/netcatty-bridge-script.d.ts';

type FormValues = Record<string, ScriptDialogFormValue>;
type FormErrors = Record<string, string>;
type FormValidationMessages = string | {
  required: string;
  numberInvalid: string;
  numberMin: (min: number) => string;
  numberMax: (max: number) => string;
  numberStep: (step: number) => string;
};

export function getInitialFormValues(request: ScriptDialogRequest): FormValues {
  if (request.type !== 'form' || !request.form) return {};
  return Object.fromEntries(
    request.form.fields.map((field) => [field.name, field.defaultValue]),
  );
}

export function applyFormValue(values: FormValues, name: string, value: ScriptDialogFormValue): FormValues {
  return { ...values, [name]: value };
}

export function getDialogFieldDomId(name: string): string {
  return `script-dialog-${encodeURIComponent(name || 'field')}`;
}

function resolveValidationMessages(messages: FormValidationMessages = 'Required') {
  if (typeof messages === 'string') {
    return {
      required: messages,
      numberInvalid: messages,
      numberMin: () => messages,
      numberMax: () => messages,
      numberStep: () => messages,
    };
  }
  return messages;
}

function matchesNumberStep(value: number, step: number, base = 0) {
  const quotient = (value - base) / step;
  return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

function getNumberStepBase(field: Extract<ScriptDialogField, { type: 'number' }>) {
  return field.min ?? field.defaultValue ?? 0;
}

function getConditionFieldValue(
  form: ScriptDialogForm,
  values: FormValues,
  fieldName: string,
): ScriptDialogFormValue {
  const field = form.fields.find((candidate) => candidate.name === fieldName);
  const value = values[fieldName];
  if (field?.type === 'number') {
    if (value === undefined || value === '') return undefined;
    const numberValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numberValue) ? numberValue : value;
  }
  if (field?.type === 'checkbox') {
    return Boolean(value);
  }
  return value;
}

export function evaluateDialogCondition(
  form: ScriptDialogForm,
  values: FormValues,
  condition: ScriptDialogCondition,
): boolean {
  const value = getConditionFieldValue(form, values, condition.field);
  if ('equals' in condition) {
    return value === condition.equals;
  }
  if ('notEquals' in condition) {
    return value !== condition.notEquals;
  }
  if ('truthy' in condition) {
    return Boolean(value);
  }
  return !value;
}

export function isDialogFieldVisible(
  form: ScriptDialogForm,
  field: ScriptDialogField,
  values: FormValues,
): boolean {
  return getVisibleDialogFormFields(form, values).some((visibleField) => visibleField.name === field.name);
}

export function getVisibleDialogFormFields(form: ScriptDialogForm, values: FormValues): ScriptDialogField[] {
  const visibleFields: ScriptDialogField[] = [];
  const visibleNames = new Set<string>();
  for (const field of form.fields) {
    if (!field.visibleWhen) {
      visibleFields.push(field);
      visibleNames.add(field.name);
      continue;
    }
    if (!visibleNames.has(field.visibleWhen.field)) {
      continue;
    }
    if (evaluateDialogCondition(form, values, field.visibleWhen)) {
      visibleFields.push(field);
      visibleNames.add(field.name);
    }
  }
  return visibleFields;
}

export function validateDialogFormValues(
  form: ScriptDialogForm,
  values: FormValues,
  messages: FormValidationMessages = 'Required',
): FormErrors {
  const validationMessages = resolveValidationMessages(messages);
  const errors: FormErrors = {};
  for (const field of getVisibleDialogFormFields(form, values)) {
    const value = values[field.name];
    if (field.type === 'checkbox') {
      if (field.required === true && !value) {
        errors[field.name] = validationMessages.required;
      }
      continue;
    }
    if (field.type === 'number') {
      const isEmpty = value === undefined || value === '';
      if (isEmpty) {
        if (field.required !== false) {
          errors[field.name] = validationMessages.required;
        }
        continue;
      }
      const numberValue = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numberValue)) {
        errors[field.name] = validationMessages.numberInvalid;
        continue;
      }
      if (field.min !== undefined && numberValue < field.min) {
        errors[field.name] = validationMessages.numberMin(field.min);
        continue;
      }
      if (field.max !== undefined && numberValue > field.max) {
        errors[field.name] = validationMessages.numberMax(field.max);
        continue;
      }
      if (field.step !== undefined && !matchesNumberStep(numberValue, field.step, getNumberStepBase(field))) {
        errors[field.name] = validationMessages.numberStep(field.step);
      }
      continue;
    }
    if (field.required === false) continue;
    if (value === undefined || String(value).trim() === '') {
      errors[field.name] = validationMessages.required;
    }
  }
  return errors;
}

export function normalizeDialogFormSubmitValues(form: ScriptDialogForm, values: FormValues): FormValues {
  const next: FormValues = {};
  for (const field of getVisibleDialogFormFields(form, values)) {
    const value = values[field.name];
    if (field.type === 'number') {
      if (value === undefined || value === '') {
        next[field.name] = undefined;
        continue;
      }
      const numberValue = typeof value === 'number' ? value : Number(value);
      next[field.name] = Number.isFinite(numberValue) ? numberValue : undefined;
      continue;
    }
    next[field.name] = value;
  }
  return next;
}

export function ScriptDialogFormFields({
  form,
  formValues,
  formErrors = {},
  onValueChange,
}: {
  form: ScriptDialogForm;
  formValues: FormValues;
  formErrors?: FormErrors;
  onValueChange: (name: string, value: ScriptDialogFormValue) => void;
}) {
  const renderFormField = (field: ScriptDialogField) => {
    const inputId = getDialogFieldDomId(field.name);
    const fieldError = formErrors[field.name];
    const descriptionId = field.description ? `${inputId}-description` : undefined;
    const errorId = fieldError ? `${inputId}-error` : undefined;
    const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
    const fieldDescription = field.description ? (
      <p id={descriptionId} className="text-xs text-muted-foreground">{field.description}</p>
    ) : null;
    const inlineDescription = field.description ? (
      <span id={descriptionId} className="mt-1 block text-xs text-muted-foreground">{field.description}</span>
    ) : null;
    const errorMessage = fieldError ? (
      <p id={errorId} className="text-xs text-destructive">{fieldError}</p>
    ) : null;
    const inlineErrorMessage = fieldError ? (
      <span id={errorId} className="mt-1 block text-xs text-destructive">{fieldError}</span>
    ) : null;

    if (field.type === 'select') {
      const labelId = `${inputId}-label`;
      const selectedValue = String(formValues[field.name] ?? field.defaultValue);
      const selectedOption = field.options.find((option) => option.value === selectedValue);
      const selectedDescriptionId = selectedOption?.description ? `${inputId}-selected-description` : undefined;
      const selectDescribedBy = [describedBy, selectedDescriptionId].filter(Boolean).join(' ') || undefined;
      return (
        <div key={field.name} className="space-y-2">
          <Label id={labelId} htmlFor={inputId}>{field.label}</Label>
          <Select
            value={selectedValue}
            onValueChange={(value) => onValueChange(field.name, value)}
          >
            <SelectTrigger
              id={inputId}
              aria-labelledby={labelId}
              aria-describedby={selectDescribedBy}
              aria-invalid={fieldError ? true : undefined}
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  textValue={option.label}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{option.label}</span>
                    {option.description ? (
                      <span className="truncate text-xs text-muted-foreground">{option.description}</span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedOption?.description ? (
            <p id={selectedDescriptionId} className="text-xs text-muted-foreground">{selectedOption.description}</p>
          ) : null}
          {fieldDescription}
          {errorMessage}
        </div>
      );
    }

    if (field.type === 'radio') {
      const selectedValue = String(formValues[field.name] ?? field.defaultValue);
      return (
        <fieldset
          key={field.name}
          className="space-y-2"
          aria-describedby={describedBy}
          aria-invalid={fieldError ? true : undefined}
        >
          <legend className="text-sm font-medium leading-5">{field.label}</legend>
          {fieldDescription}
          <div className="space-y-2">
            {field.options.map((option, index) => {
              const optionInputId = `${inputId}-${index}`;
              return (
                <label
                  key={option.value}
                  htmlFor={optionInputId}
                  className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
                >
                  <input
                    id={optionInputId}
                    type="radio"
                    name={inputId}
                    value={option.value}
                    checked={selectedValue === option.value}
                    disabled={option.disabled}
                    onChange={(event) => onValueChange(field.name, event.target.value)}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block">{option.label}</span>
                    {option.description ? (
                      <span className="block text-xs text-muted-foreground">{option.description}</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
          {errorMessage}
        </fieldset>
      );
    }

    if (field.type === 'textarea') {
      return (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={inputId}>{field.label}</Label>
          <Textarea
            id={inputId}
            value={String(formValues[field.name] ?? field.defaultValue)}
            placeholder={field.placeholder}
            onChange={(event) => onValueChange(field.name, event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={fieldError ? true : undefined}
          />
          {fieldDescription}
          {errorMessage}
        </div>
      );
    }

    if (field.type === 'number') {
      return (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={inputId}>{field.label}</Label>
          <Input
            id={inputId}
            type="number"
            value={formValues[field.name] ?? field.defaultValue ?? ''}
            placeholder={field.placeholder}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(event) => onValueChange(field.name, event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={fieldError ? true : undefined}
          />
          {fieldDescription}
          {errorMessage}
        </div>
      );
    }

    return (
      <div key={field.name} className="space-y-2">
        <label htmlFor={inputId} className="flex items-start gap-2 text-sm">
          <input
            id={inputId}
            type="checkbox"
            checked={Boolean(formValues[field.name] ?? field.defaultValue)}
            onChange={(event) => onValueChange(field.name, event.target.checked)}
            aria-describedby={describedBy}
            aria-invalid={fieldError ? true : undefined}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span className="min-w-0">
            <span className="block font-medium leading-5">{field.label}</span>
            {inlineDescription}
            {inlineErrorMessage}
          </span>
        </label>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {getVisibleDialogFormFields(form, formValues).map(renderFormField)}
    </div>
  );
}

export function ScriptDialogFormBody({
  form,
  formValues,
  formErrors,
  onValueChange,
}: {
  form: ScriptDialogForm;
  formValues: FormValues;
  formErrors?: FormErrors;
  onValueChange: (name: string, value: ScriptDialogFormValue) => void;
}) {
  return (
    <ScrollArea className="min-h-0 pr-3">
      <ScriptDialogFormFields
        form={form}
        formValues={formValues}
        formErrors={formErrors}
        onValueChange={onValueChange}
      />
    </ScrollArea>
  );
}

export function ScriptDialogHost() {
  const { t } = useI18n();
  const [request, setRequest] = useState<ScriptDialogRequest | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [formValues, setFormValues] = useState<FormValues>({});
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  useEffect(() => {
    const dispose = netcattyBridge.get()?.onScriptDialogRequest?.((payload) => {
      setRequest(payload);
      setPromptValue(payload.defaultValue ?? '');
      setFormValues(getInitialFormValues(payload));
      setFormErrors({});
    });
    return dispose;
  }, []);

  const respond = useCallback(async (value?: unknown, cancelled = false) => {
    if (!request) return;
    await netcattyBridge.get()?.scriptDialogResponse?.(request.requestId, value, cancelled);
    setRequest(null);
  }, [request]);

  if (!request) return null;

  const form = request.type === 'form' ? request.form : undefined;
  const dialogTitle = request.type === 'waitForTimeout'
    ? t('scripts.dialog.waitForTimeoutTitle')
    : form?.title || t('scripts.dialog.title');
  const message = form?.message ?? request.message;

  const setFormValue = (name: string, value: ScriptDialogFormValue) => {
    setFormValues((current) => applyFormValue(current, name, value));
    setFormErrors((current) => {
      if (!current[name]) return current;
      const { [name]: _removed, ...rest } = current;
      return rest;
    });
  };

  const submitForm = () => {
    if (!form) return;
    const errors = validateDialogFormValues(form, formValues, {
      required: t('scripts.dialog.required'),
      numberInvalid: t('scripts.dialog.numberInvalid'),
      numberMin: (min) => t('scripts.dialog.numberMin', { min }),
      numberMax: (max) => t('scripts.dialog.numberMax', { max }),
      numberStep: (step) => t('scripts.dialog.numberStep', { step }),
    });
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    const submitValues = normalizeDialogFormSubmitValues(form, formValues);
    void respond(submitValues);
  };

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) {
        void respond(request.type === 'waitForTimeout' ? 'abort' : undefined, true);
      }
    }}
    >
      <DialogContent className={form ? 'max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden' : undefined}>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          {message ? <DialogDescription>{message}</DialogDescription> : null}
        </DialogHeader>
        {request.type === 'prompt' ? (
          <Input
            type={request.sensitive ? 'password' : 'text'}
            value={promptValue}
            onChange={(event) => setPromptValue(event.target.value)}
            autoFocus
          />
        ) : null}
        {form ? (
          <ScriptDialogFormBody
            form={form}
            formValues={formValues}
            formErrors={formErrors}
            onValueChange={setFormValue}
          />
        ) : null}
        <DialogFooter>
          {request.type === 'waitForTimeout' ? (
            <>
              <Button variant="outline" onClick={() => void respond('abort')}>
                {t('scripts.dialog.abort')}
              </Button>
              <Button variant="secondary" onClick={() => void respond('skip')}>
                {t('scripts.dialog.skip')}
              </Button>
              <Button onClick={() => void respond('retry')}>
                {t('scripts.dialog.retry')}
              </Button>
            </>
          ) : request.type === 'confirm' ? (
            <>
              <Button variant="outline" onClick={() => void respond(false)}>{t('common.cancel')}</Button>
              <Button onClick={() => void respond(true)}>{t('scripts.dialog.ok')}</Button>
            </>
          ) : request.type === 'prompt' ? (
            <>
              <Button variant="outline" onClick={() => void respond(undefined, true)}>{t('common.cancel')}</Button>
              <Button onClick={() => void respond(promptValue)}>{t('scripts.dialog.ok')}</Button>
            </>
          ) : request.type === 'form' ? (
            <>
              <Button variant="outline" onClick={() => void respond(undefined, true)}>
                {form?.cancelLabel || t('common.cancel')}
              </Button>
              <Button onClick={submitForm}>
                {form?.submitLabel || t('scripts.dialog.ok')}
              </Button>
            </>
          ) : (
            <Button onClick={() => void respond(undefined)}>{t('scripts.dialog.ok')}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
