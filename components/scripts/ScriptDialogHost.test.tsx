import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ScriptDialogRequest } from "../../types/global/netcatty-bridge-script.d.ts";
import {
  applyFormValue,
  getDialogFieldDomId,
  getInitialFormValues,
  getVisibleDialogFormFields,
  normalizeDialogFormSubmitValues,
  ScriptDialogFormBody,
  ScriptDialogFormFields,
  validateDialogFormValues,
} from "./ScriptDialogHost.tsx";

const formRequest: ScriptDialogRequest = {
  requestId: "dialog-1",
  type: "form",
  message: "Choose options",
  form: {
    title: "Deploy",
    message: "Choose options",
    fields: [
      {
        type: "select",
        name: "env",
        label: "Environment",
        options: [
          { label: "Development", value: "dev" },
          { label: "Production", value: "prod", description: "Use carefully" },
        ],
        defaultValue: "dev",
      },
      {
        type: "checkbox",
        name: "restart",
        label: "Restart service",
        defaultValue: true,
      },
      {
        type: "radio",
        name: "mode",
        label: "Mode",
        options: [
          { label: "Safe", value: "safe" },
          { label: "Fast", value: "fast" },
        ],
        defaultValue: "safe",
      },
      {
        type: "textarea",
        name: "notes",
        label: "Notes",
        defaultValue: "initial note",
        required: false,
      },
      {
        type: "number",
        name: "retries",
        label: "Retries",
        defaultValue: 3,
        min: 0,
        step: 1,
      },
    ],
  },
};

test("script dialog form derives initial values from fields", () => {
  assert.deepEqual(getInitialFormValues(formRequest), {
    env: "dev",
    restart: true,
    mode: "safe",
    notes: "initial note",
    retries: 3,
  });
});

test("script dialog form value helper preserves previous values for submit payload", () => {
  const initial = getInitialFormValues(formRequest);
  const withEnv = applyFormValue(initial, "env", "prod");
  const withRestart = applyFormValue(withEnv, "restart", false);
  const withMode = applyFormValue(withRestart, "mode", "fast");
  const withNotes = applyFormValue(withMode, "notes", "ship it");
  const submitted = normalizeDialogFormSubmitValues(
    formRequest.form!,
    applyFormValue(withNotes, "retries", "5"),
  );

  assert.deepEqual(submitted, {
    env: "prod",
    restart: false,
    mode: "fast",
    notes: "ship it",
    retries: 5,
  });
});

test("script dialog form validates required text and number fields", () => {
  const emptyRequiredRequest: ScriptDialogRequest = {
    ...formRequest,
    form: {
      ...formRequest.form!,
      fields: [
        ...formRequest.form!.fields,
        { type: "textarea", name: "requiredNotes", label: "Required notes", defaultValue: "" },
        { type: "number", name: "requiredCount", label: "Required count" },
      ],
    },
  };
  const values = getInitialFormValues(emptyRequiredRequest);

  assert.deepEqual(validateDialogFormValues(emptyRequiredRequest.form!, values, "Required"), {
    requiredNotes: "Required",
    requiredCount: "Required",
  });
});

test("script dialog form only requires checkboxes when explicitly marked required", () => {
  const form = {
    message: "Confirm",
    fields: [
      {
        type: "checkbox" as const,
        name: "optionalFlag",
        label: "Optional flag",
        defaultValue: false,
      },
      {
        type: "checkbox" as const,
        name: "confirmDanger",
        label: "I understand",
        defaultValue: false,
        required: true,
      },
    ],
  };

  assert.deepEqual(validateDialogFormValues(form, {
    optionalFlag: false,
    confirmDanger: false,
  }, "Required"), {
    confirmDanger: "Required",
  });
  assert.deepEqual(validateDialogFormValues(form, {
    optionalFlag: false,
    confirmDanger: true,
  }, "Required"), {});
});

test("script dialog form validates number min max and step before submit", () => {
  const form = {
    message: "Number limits",
    fields: [{
      type: "number" as const,
      name: "delayMs",
      label: "Delay",
      defaultValue: 500,
      min: 0,
      max: 5000,
      step: 100,
      required: false,
    }],
  };
  const messages = {
    required: "Required",
    numberInvalid: "Invalid",
    numberMin: (min: number) => `Min ${min}`,
    numberMax: (max: number) => `Max ${max}`,
    numberStep: (step: number) => `Step ${step}`,
  };

  assert.deepEqual(validateDialogFormValues(form, { delayMs: -1 }, messages), {
    delayMs: "Min 0",
  });
  assert.deepEqual(validateDialogFormValues(form, { delayMs: 5001 }, messages), {
    delayMs: "Max 5000",
  });
  assert.deepEqual(validateDialogFormValues(form, { delayMs: 550 }, messages), {
    delayMs: "Step 100",
  });
  assert.deepEqual(validateDialogFormValues(form, { delayMs: "" }, messages), {});
  assert.deepEqual(validateDialogFormValues(form, { delayMs: 5000 }, messages), {});

  const defaultBasedForm = {
    message: "Number limits",
    fields: [{
      type: "number" as const,
      name: "oddCount",
      label: "Odd count",
      defaultValue: 5,
      step: 2,
    }],
  };
  assert.deepEqual(validateDialogFormValues(defaultBasedForm, { oddCount: 5 }, messages), {});
  assert.deepEqual(validateDialogFormValues(defaultBasedForm, { oddCount: 7 }, messages), {});
  assert.deepEqual(validateDialogFormValues(defaultBasedForm, { oddCount: 6 }, messages), {
    oddCount: "Step 2",
  });
});

test("script dialog form applies visibleWhen to rendering validation and submit payload", () => {
  const conditionalRequest: ScriptDialogRequest = {
    ...formRequest,
    form: {
      ...formRequest.form!,
      fields: [
        {
          type: "select",
          name: "target",
          label: "Target",
          options: [
            { label: "Local", value: "local" },
            { label: "Remote", value: "remote" },
          ],
          defaultValue: "local",
        },
        {
          type: "textarea",
          name: "host",
          label: "Remote host",
          defaultValue: "",
          visibleWhen: { field: "target", equals: "remote" },
        },
        {
          type: "checkbox",
          name: "confirmRemote",
          label: "Confirm remote",
          defaultValue: false,
          visibleWhen: { field: "target", notEquals: "local" },
        },
        {
          type: "textarea",
          name: "localNote",
          label: "Local note",
          defaultValue: "local only",
          required: false,
          visibleWhen: { field: "target", equals: "local" },
        },
        {
          type: "textarea",
          name: "remoteDetail",
          label: "Remote detail",
          defaultValue: "hidden by hidden controller",
          required: false,
          visibleWhen: { field: "confirmRemote", truthy: true },
        },
      ],
    },
  };
  const localValues = getInitialFormValues(conditionalRequest);
  const localVisibleNames = getVisibleDialogFormFields(conditionalRequest.form!, localValues).map((field) => field.name);

  assert.deepEqual(localVisibleNames, ["target", "localNote"]);
  assert.deepEqual(validateDialogFormValues(conditionalRequest.form!, localValues, "Required"), {});
  assert.deepEqual(normalizeDialogFormSubmitValues(conditionalRequest.form!, localValues), {
    target: "local",
    localNote: "local only",
  });

  const remoteValues = applyFormValue(applyFormValue(localValues, "target", "remote"), "confirmRemote", true);
  const remoteVisibleNames = getVisibleDialogFormFields(conditionalRequest.form!, remoteValues).map((field) => field.name);

  assert.deepEqual(remoteVisibleNames, ["target", "host", "confirmRemote", "remoteDetail"]);
  assert.deepEqual(validateDialogFormValues(conditionalRequest.form!, remoteValues, "Required"), {
    host: "Required",
  });
  assert.deepEqual(normalizeDialogFormSubmitValues(conditionalRequest.form!, applyFormValue(remoteValues, "host", "example.com")), {
    target: "remote",
    host: "example.com",
    confirmRemote: true,
    remoteDetail: "hidden by hidden controller",
  });
});

test("script dialog form does not show fields chained from hidden controllers", () => {
  const request: ScriptDialogRequest = {
    ...formRequest,
    form: {
      ...formRequest.form!,
      fields: [
        {
          type: "select",
          name: "target",
          label: "Target",
          options: [
            { label: "Local", value: "local" },
            { label: "Remote", value: "remote" },
          ],
          defaultValue: "local",
        },
        {
          type: "checkbox",
          name: "advanced",
          label: "Advanced",
          defaultValue: true,
          visibleWhen: { field: "target", equals: "remote" },
        },
        {
          type: "textarea",
          name: "advancedNote",
          label: "Advanced note",
          defaultValue: "should stay hidden",
          visibleWhen: { field: "advanced", truthy: true },
        },
      ],
    },
  };

  assert.deepEqual(
    getVisibleDialogFormFields(request.form!, getInitialFormValues(request)).map((field) => field.name),
    ["target"],
  );
  assert.deepEqual(normalizeDialogFormSubmitValues(request.form!, getInitialFormValues(request)), {
    target: "local",
  });
});

test("script dialog form fields render select checkbox radio textarea and number controls", () => {
  const values = applyFormValue(getInitialFormValues(formRequest), "env", "prod");
  const markup = renderToStaticMarkup(
    <ScriptDialogFormFields
      form={formRequest.form!}
      formValues={values}
      onValueChange={() => {}}
    />,
  );

  assert.match(markup, /Environment/);
  assert.match(markup, /Use carefully/);
  assert.match(markup, /id="script-dialog-env-label"/);
  assert.match(markup, /aria-labelledby="script-dialog-env-label"/);
  assert.match(markup, /Restart service/);
  assert.match(markup, /type="checkbox"[^>]*checked=""/);
  assert.match(markup, /type="radio"[^>]*checked=""[^>]*value="safe"/);
  assert.match(markup, /type="radio"[^>]*value="fast"/);
  assert.match(markup, /<textarea[^>]*>initial note<\/textarea>/);
  assert.match(markup, /type="number"[^>]*min="0"[^>]*step="1"[^>]*value="3"/);
});

test("script dialog form fields do not render hidden visibleWhen controls", () => {
  const request: ScriptDialogRequest = {
    ...formRequest,
    form: {
      ...formRequest.form!,
      fields: [
        {
          type: "select",
          name: "target",
          label: "Target",
          options: [
            { label: "Local", value: "local" },
            { label: "Remote", value: "remote" },
          ],
          defaultValue: "local",
        },
        {
          type: "textarea",
          name: "host",
          label: "Remote host",
          defaultValue: "",
          visibleWhen: { field: "target", equals: "remote" },
        },
      ],
    },
  };

  const markup = renderToStaticMarkup(
    <ScriptDialogFormFields
      form={request.form!}
      formValues={getInitialFormValues(request)}
      onValueChange={() => {}}
    />,
  );

  assert.match(markup, /Target/);
  assert.doesNotMatch(markup, /Remote host/);
});

test("script dialog form body renders fields inside a constrained scroll area", () => {
  const values = getInitialFormValues(formRequest);
  const markup = renderToStaticMarkup(
    <ScriptDialogFormBody
      form={formRequest.form!}
      formValues={values}
      onValueChange={() => {}}
    />,
  );

  assert.match(markup, /data-radix-scroll-area-viewport/);
  assert.match(markup, /min-h-0/);
  assert.match(markup, /Environment/);
});

test("script dialog form fields render required errors", () => {
  const values = getInitialFormValues(formRequest);
  const markup = renderToStaticMarkup(
    <ScriptDialogFormFields
      form={formRequest.form!}
      formValues={values}
      formErrors={{ retries: "Required" }}
      onValueChange={() => {}}
    />,
  );

  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, /id="script-dialog-retries-error"/);
  assert.match(markup, /aria-describedby="script-dialog-retries-error"/);
  assert.match(markup, /Required/);
});

test("script dialog form fields associate checkbox errors with the input", () => {
  const form = {
    message: "Confirm",
    fields: [{
      type: "checkbox" as const,
      name: "confirmDanger",
      label: "I understand",
      description: "Required before continuing",
      defaultValue: false,
      required: true,
    }],
  };
  const markup = renderToStaticMarkup(
    <ScriptDialogFormFields
      form={form}
      formValues={{ confirmDanger: false }}
      formErrors={{ confirmDanger: "Required" }}
      onValueChange={() => {}}
    />,
  );

  assert.match(markup, /id="script-dialog-confirmDanger-description"/);
  assert.match(markup, /id="script-dialog-confirmDanger-error"/);
  assert.match(
    markup,
    /aria-describedby="script-dialog-confirmDanger-description script-dialog-confirmDanger-error"/,
  );
  assert.match(markup, /aria-invalid="true"/);
});

test("script dialog form field DOM ids encode names with spaces", () => {
  const form = {
    message: "Confirm",
    fields: [{
      type: "checkbox" as const,
      name: "confirm danger",
      label: "I understand",
      description: "Required before continuing",
      defaultValue: false,
      required: true,
    }],
  };
  const markup = renderToStaticMarkup(
    <ScriptDialogFormFields
      form={form}
      formValues={{ "confirm danger": false }}
      formErrors={{ "confirm danger": "Required" }}
      onValueChange={() => {}}
    />,
  );

  assert.equal(getDialogFieldDomId("confirm danger"), "script-dialog-confirm%20danger");
  assert.match(markup, /id="script-dialog-confirm%20danger"/);
  assert.match(
    markup,
    /aria-describedby="script-dialog-confirm%20danger-description script-dialog-confirm%20danger-error"/,
  );
  assert.doesNotMatch(markup, /script-dialog-confirm danger/);
});

test("script dialog form control ids encode spaced names for radio text and number fields", () => {
  const form = {
    message: "Spaced names",
    fields: [
      {
        type: "radio" as const,
        name: "run mode",
        label: "Run mode",
        description: "Choose mode",
        options: [
          { label: "Safe", value: "safe" },
          { label: "Fast", value: "fast" },
        ],
        defaultValue: "safe",
      },
      {
        type: "textarea" as const,
        name: "release notes",
        label: "Release notes",
        defaultValue: "",
      },
      {
        type: "number" as const,
        name: "retry count",
        label: "Retry count",
        defaultValue: 3,
      },
    ],
  };
  const markup = renderToStaticMarkup(
    <ScriptDialogFormFields
      form={form}
      formValues={{
        "run mode": "safe",
        "release notes": "",
        "retry count": 3,
      }}
      formErrors={{
        "run mode": "Required",
        "release notes": "Required",
        "retry count": "Required",
      }}
      onValueChange={() => {}}
    />,
  );

  assert.match(markup, /id="script-dialog-run%20mode-0"/);
  assert.match(markup, /name="script-dialog-run%20mode"/);
  assert.match(markup, /id="script-dialog-release%20notes"/);
  assert.match(markup, /for="script-dialog-release%20notes"/);
  assert.match(markup, /id="script-dialog-retry%20count"/);
  assert.match(markup, /for="script-dialog-retry%20count"/);
  assert.doesNotMatch(markup, /script-dialog-run mode/);
  assert.doesNotMatch(markup, /script-dialog-release notes/);
  assert.doesNotMatch(markup, /script-dialog-retry count/);
});
