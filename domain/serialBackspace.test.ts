import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareSerialConfigForSavedHost,
  resolveSerialBackspaceFormValue,
  resolveSerialBackspaceOverrideOnSave,
} from "./serialBackspace";

test("saved quick-connect hosts omit the default Backspace override", () => {
  const config = {
    path: "COM3",
    baudRate: 115200,
    backspaceBehavior: "default" as const,
  };

  const saved = prepareSerialConfigForSavedHost(config);

  assert.deepEqual(saved, {
    path: "COM3",
    baudRate: 115200,
  });
  assert.equal(config.backspaceBehavior, "default");
});

test("saved quick-connect hosts retain an explicit Ctrl-H override", () => {
  assert.deepEqual(prepareSerialConfigForSavedHost({
    path: "COM3",
    baudRate: 115200,
    backspaceBehavior: "ctrl-h",
  }), {
    path: "COM3",
    baudRate: 115200,
    backspaceBehavior: "ctrl-h",
  });
});

test("serial Backspace form shows inherited Ctrl-H without creating an override", () => {
  const initialHost = {
    group: "network/serial",
    serialConfig: { path: "COM3", baudRate: 115200 },
  };

  const selectedBehavior = resolveSerialBackspaceFormValue(initialHost, {
    backspaceBehavior: "ctrl-h",
  });
  const savedBehavior = resolveSerialBackspaceOverrideOnSave({
    initialHost,
    selectedBehavior,
    behaviorChanged: false,
  });

  assert.equal(selectedBehavior, "ctrl-h");
  assert.equal(savedBehavior, undefined);
});

test("serial Backspace form keeps default inheritance unset when untouched", () => {
  const initialHost = {
    group: "network/serial",
    serialConfig: { path: "COM3", baudRate: 115200 },
  };

  const selectedBehavior = resolveSerialBackspaceFormValue(initialHost);
  const savedBehavior = resolveSerialBackspaceOverrideOnSave({
    initialHost,
    selectedBehavior,
    behaviorChanged: false,
  });

  assert.equal(selectedBehavior, "default");
  assert.equal(savedBehavior, undefined);
});

test("serial Backspace form preserves explicit and migrated host overrides", () => {
  const explicitDefaultHost = {
    group: "network/serial",
    serialConfig: {
      path: "COM3",
      baudRate: 115200,
      backspaceBehavior: "default" as const,
    },
  };
  const legacyCtrlHHost = {
    group: "network/serial",
    serialConfig: { path: "COM3", baudRate: 115200 },
    backspaceBehavior: "ctrl-h" as const,
  };

  assert.equal(resolveSerialBackspaceOverrideOnSave({
    initialHost: explicitDefaultHost,
    selectedBehavior: "default",
    behaviorChanged: false,
  }), "default");
  assert.equal(resolveSerialBackspaceOverrideOnSave({
    initialHost: legacyCtrlHHost,
    selectedBehavior: "ctrl-h",
    behaviorChanged: false,
  }), "ctrl-h");
});

test("serial Backspace form saves a deliberate selection change explicitly", () => {
  const initialHost = {
    group: "network/serial",
    serialConfig: { path: "COM3", baudRate: 115200 },
  };

  assert.equal(resolveSerialBackspaceOverrideOnSave({
    initialHost,
    selectedBehavior: "default",
    behaviorChanged: true,
  }), "default");
});

test("serial Backspace form keeps inherited behavior unset across group moves", () => {
  const initialHost = {
    group: "network/serial",
    serialConfig: { path: "COM3", baudRate: 115200 },
  };

  assert.equal(resolveSerialBackspaceOverrideOnSave({
    initialHost,
    selectedBehavior: "default",
    behaviorChanged: false,
  }), undefined);
  assert.equal(resolveSerialBackspaceOverrideOnSave({
    initialHost,
    selectedBehavior: "ctrl-h",
    behaviorChanged: false,
  }), undefined);
});
