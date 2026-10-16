import type { GroupConfig, Host, SerialConfig } from "./models";

export type SerialBackspaceBehavior = NonNullable<SerialConfig["backspaceBehavior"]>;

export const prepareSerialConfigForSavedHost = (
  config: SerialConfig,
): SerialConfig => {
  const { backspaceBehavior, ...rest } = config;
  return backspaceBehavior === "ctrl-h"
    ? { ...rest, backspaceBehavior }
    : rest;
};

export const resolveSerialBackspaceFormValue = (
  host: Pick<Host, "serialConfig" | "backspaceBehavior">,
  groupDefaults?: Pick<GroupConfig, "backspaceBehavior">,
): SerialBackspaceBehavior => (
  host.serialConfig?.backspaceBehavior
  ?? (host.backspaceBehavior === "ctrl-h" ? "ctrl-h" : undefined)
  ?? (groupDefaults?.backspaceBehavior === "ctrl-h" ? "ctrl-h" : "default")
);

export const resolveSerialBackspaceOverrideOnSave = ({
  initialHost,
  selectedBehavior,
  behaviorChanged,
}: {
  initialHost: Pick<Host, "serialConfig" | "backspaceBehavior">;
  selectedBehavior: SerialBackspaceBehavior;
  behaviorChanged: boolean;
}): SerialConfig["backspaceBehavior"] => {
  const hasExplicitBehavior = initialHost.serialConfig?.backspaceBehavior !== undefined
    || initialHost.backspaceBehavior === "ctrl-h";

  return hasExplicitBehavior || behaviorChanged
    ? selectedBehavior
    : undefined;
};
