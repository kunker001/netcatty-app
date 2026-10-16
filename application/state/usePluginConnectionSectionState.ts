import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Host, Identity, SSHKey } from "../../types";
import {
  isPluginCredentialCatalogEntryAvailable,
  isPluginHostProtocol,
  pluginProtocolForProvider,
  sanitizePluginConnection,
} from "../../domain/pluginConnection";
import { pluginConfigurationMatchesSchema } from "../../domain/pluginConfigurationSchema";
import { pluginExtensionBridge } from "./pluginExtensionBridge";

type Translation = (key: string, params?: Record<string, unknown>) => string;

export type PluginConnectionSectionStateOptions = {
  form: Host;
  setForm: Dispatch<SetStateAction<Host>>;
  t: Translation;
  onValidityChange: (valid: boolean) => void;
  identities: ReadonlyArray<Identity>;
  keys: ReadonlyArray<SSHKey>;
};

type SelectOption = {
  value: string;
  label: string;
  sublabel?: string;
};

const localizeProviderLabel = (
  value: unknown,
  fallback: string,
  locale = typeof navigator === "undefined" ? "en" : navigator.language,
): string => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const labels = value as Record<string, unknown>;
  const candidate = labels[locale] ?? labels[locale.split("-")[0]] ?? labels.en;
  return typeof candidate === "string" ? candidate : fallback;
};

export function usePluginConnectionSectionState({
  form,
  setForm,
  t,
  onValidityChange,
  identities,
  keys,
}: PluginConnectionSectionStateOptions) {
  const [providers, setProviders] = useState<ReadonlyArray<NetcattyExtensionProviderContribution>>([]);
  const [authenticationProviders, setAuthenticationProviders] = useState<ReadonlyArray<NetcattyExtensionProviderContribution>>([]);
  const [configurationText, setConfigurationText] = useState(() => JSON.stringify(
    form.pluginConnection?.configuration === undefined ? {} : form.pluginConnection.configuration,
    null,
    2,
  ));
  const configurationTextRef = useRef(configurationText);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const onValidityChangeRef = useRef(onValidityChange);
  onValidityChangeRef.current = onValidityChange;

  const credentialCatalogIds = useSyncExternalStore(
    pluginExtensionBridge.subscribeCredentialCatalog,
    pluginExtensionBridge.getCredentialCatalogIds,
    pluginExtensionBridge.getCredentialCatalogIds,
  );
  const credentialCatalogIdSet = useMemo(() => new Set(credentialCatalogIds), [credentialCatalogIds]);
  const active = isPluginHostProtocol(form.protocol);
  const providerId = form.pluginConnection?.providerId ?? (active ? form.protocol.slice(7) : "");
  const selectedProvider = providers.find((entry) => entry.provider.id === providerId);
  const installed = providers.some((entry) => entry.provider.id === providerId);

  useEffect(() => {
    let disposed = false;
    let requestId = 0;
    const refreshProviders = () => {
      const currentRequestId = ++requestId;
      void Promise.all([
        pluginExtensionBridge.listProviders("connection"),
        pluginExtensionBridge.listProviders("authentication"),
      ]).then(([connections, authentications]) => {
        if (disposed || currentRequestId !== requestId) return;
        setProviders(connections);
        setAuthenticationProviders(authentications);
      }).catch(() => {
        if (!disposed && currentRequestId === requestId) {
          setProviders([]);
          setAuthenticationProviders([]);
        }
      });
    };
    refreshProviders();
    const unsubscribe = pluginExtensionBridge.onContributionsChanged(() => { refreshProviders(); });
    return () => {
      disposed = true;
      requestId += 1;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const configuration = form.pluginConnection?.configuration === undefined
      ? {}
      : form.pluginConnection.configuration;
    let localConfigurationMatches = false;
    try {
      localConfigurationMatches = JSON.stringify(JSON.parse(configurationTextRef.current)) === JSON.stringify(configuration);
    } catch {
      // Preserve an in-progress invalid edit until the selected host or provider changes.
    }
    if (!localConfigurationMatches) {
      const nextText = JSON.stringify(configuration, null, 2);
      configurationTextRef.current = nextText;
      setConfigurationText(nextText);
    }
    const structurallyValid = !active || Boolean(sanitizePluginConnection(form.pluginConnection, form.protocol));
    const schemaValid = selectedProvider?.provider.configurationSchema === undefined
      || pluginConfigurationMatchesSchema(selectedProvider.provider.configurationSchema, configuration);
    setConfigurationError(schemaValid ? null : t("hostDetails.plugin.configuration.schemaInvalid"));
    onValidityChangeRef.current(structurallyValid && schemaValid);
  }, [active, form.id, form.pluginConnection, form.protocol, selectedProvider, t]);

  const providerOptions = useMemo<ReadonlyArray<SelectOption>>(() => providers.map((entry) => ({
    value: entry.provider.id,
    label: localizeProviderLabel(entry.provider.label, entry.provider.id),
  })), [providers]);

  const authenticationOptions = useMemo<ReadonlyArray<SelectOption>>(() => [
    { value: "", label: t("hostDetails.plugin.authentication.none") },
    ...authenticationProviders.map((entry) => ({
      value: entry.provider.id,
      label: localizeProviderLabel(entry.provider.label, entry.provider.id),
    })),
  ], [authenticationProviders, t]);

  const credentialOptions = useMemo<ReadonlyArray<SelectOption>>(() => {
    const options = [
      { value: "", label: t("hostDetails.plugin.credential.none") },
      ...identities.flatMap((identity) => isPluginCredentialCatalogEntryAvailable(
        identity.id,
        identity.password,
        credentialCatalogIdSet,
      )
        ? [{
            value: identity.id,
            label: identity.label,
            sublabel: t("hostDetails.plugin.credential.password"),
          }]
        : []),
      ...keys.flatMap((key) => isPluginCredentialCatalogEntryAvailable(
        key.id,
        key.privateKey,
        credentialCatalogIdSet,
      )
        ? [{
            value: key.id,
            label: key.label,
            sublabel: t("hostDetails.plugin.credential.privateKey"),
          }]
        : []),
    ];
    const selected = form.pluginConnection?.credentialId;
    if (selected && !options.some((option) => option.value === selected)) {
      options.push({
        value: selected,
        label: t("hostDetails.plugin.credential.unavailable"),
        sublabel: selected,
      });
    }
    return options;
  }, [credentialCatalogIdSet, form.pluginConnection?.credentialId, identities, keys, t]);

  const updateConfiguration = useCallback((text: string) => {
    configurationTextRef.current = text;
    setConfigurationText(text);
    try {
      const configuration = JSON.parse(text) as unknown;
      if (configuration === undefined) throw new Error("empty");
      const nextConnection = form.pluginConnection ? { ...form.pluginConnection, configuration } : undefined;
      if (!sanitizePluginConnection(nextConnection, form.protocol)) throw new Error("unsafe");
      if (selectedProvider?.provider.configurationSchema !== undefined
        && !pluginConfigurationMatchesSchema(selectedProvider.provider.configurationSchema, configuration)) {
        setConfigurationError(t("hostDetails.plugin.configuration.schemaInvalid"));
        onValidityChange(false);
        return;
      }
      setConfigurationError(null);
      onValidityChange(true);
      setForm((previous) => previous.pluginConnection ? ({
        ...previous,
        pluginConnection: { ...previous.pluginConnection, configuration },
      }) : previous);
    } catch {
      setConfigurationError(t("hostDetails.plugin.configuration.invalid"));
      onValidityChange(false);
    }
  }, [form.pluginConnection, form.protocol, onValidityChange, selectedProvider, setForm, t]);

  const selectProvider = useCallback((nextProviderId: string) => {
    const configuration = {};
    const nextProvider = providers.find((entry) => entry.provider.id === nextProviderId);
    const schemaValid = nextProvider?.provider.configurationSchema === undefined
      || pluginConfigurationMatchesSchema(nextProvider.provider.configurationSchema, configuration);
    setForm((previous) => ({
      ...previous,
      protocol: pluginProtocolForProvider(nextProviderId),
      pluginConnection: { providerId: nextProviderId, configuration },
    }));
    setConfigurationText("{}");
    configurationTextRef.current = "{}";
    setConfigurationError(schemaValid ? null : t("hostDetails.plugin.configuration.schemaInvalid"));
    onValidityChange(schemaValid);
  }, [onValidityChange, providers, setForm, t]);

  const selectAuthenticationProvider = useCallback((authenticationProviderId: string) => {
    setForm((previous) => previous.pluginConnection ? ({
      ...previous,
      pluginConnection: {
        ...previous.pluginConnection,
        ...(authenticationProviderId ? { authenticationProviderId } : { authenticationProviderId: undefined }),
      },
    }) : previous);
  }, [setForm]);

  const selectCredential = useCallback((credentialId: string) => {
    setForm((previous) => previous.pluginConnection ? ({
      ...previous,
      pluginConnection: {
        ...previous.pluginConnection,
        ...(credentialId ? { credentialId } : { credentialId: undefined }),
      },
    }) : previous);
  }, [setForm]);

  const resetToSsh = useCallback(() => {
    setForm((previous) => ({
      ...previous,
      protocol: "ssh",
      pluginConnection: undefined,
    }));
    onValidityChange(true);
  }, [onValidityChange, setForm]);

  return {
    active,
    installed,
    providerId,
    providerCount: providers.length,
    providerOptions,
    authenticationOptions,
    credentialOptions,
    configurationText,
    configurationError,
    updateConfiguration,
    selectProvider,
    selectAuthenticationProvider,
    selectCredential,
    resetToSsh,
  };
}
