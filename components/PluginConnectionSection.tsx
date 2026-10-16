import React from "react";
import { Plug, RotateCcw } from "lucide-react";
import type { Host, Identity, SSHKey } from "../types";
import { usePluginConnectionSectionState } from "../application/state/usePluginConnectionSectionState";
import { HostDetailsSection } from "./host-details";
import { Button } from "./ui/button";
import { Combobox } from "./ui/combobox";

type Props = {
  form: Host;
  setForm: React.Dispatch<React.SetStateAction<Host>>;
  t: (key: string, params?: Record<string, unknown>) => string;
  onValidityChange: (valid: boolean) => void;
  identities: Identity[];
  keys: SSHKey[];
};

export const PluginConnectionSection: React.FC<Props> = ({
  form,
  setForm,
  t,
  onValidityChange,
  identities,
  keys,
}) => {
  const state = usePluginConnectionSectionState({
    form,
    setForm,
    t,
    onValidityChange,
    identities,
    keys,
  });

  if (!state.active && state.providerCount === 0) return null;

  return (
    <HostDetailsSection
      icon={<Plug size={14} className="text-muted-foreground" />}
      title={t("hostDetails.plugin.title")}
      hint={state.active && !state.installed ? t("hostDetails.plugin.unavailable") : undefined}
    >
      <Combobox
        options={state.providerOptions}
        value={state.providerId}
        onValueChange={state.selectProvider}
        placeholder={t("hostDetails.plugin.provider.placeholder")}
        emptyText={t("hostDetails.plugin.provider.empty")}
      />
      {state.active ? (
        <>
          <Combobox
            options={state.authenticationOptions}
            value={form.pluginConnection?.authenticationProviderId ?? ""}
            onValueChange={state.selectAuthenticationProvider}
            placeholder={t("hostDetails.plugin.authentication.placeholder")}
          />
          <Combobox
            options={state.credentialOptions}
            value={form.pluginConnection?.credentialId ?? ""}
            onValueChange={state.selectCredential}
            placeholder={t("hostDetails.plugin.credential.placeholder")}
          />
          <textarea
            value={state.configurationText}
            onChange={(event) => state.updateConfiguration(event.target.value)}
            spellCheck={false}
            className="min-h-32 w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("hostDetails.plugin.configuration.label")}
          />
          {state.configurationError ? <p className="text-xs text-destructive">{state.configurationError}</p> : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={state.resetToSsh}
          >
            <RotateCcw size={14} className="mr-2" />
            {t("hostDetails.plugin.useSsh")}
          </Button>
        </>
      ) : null}
    </HostDetailsSection>
  );
};
