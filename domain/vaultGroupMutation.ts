import type { GroupConfig, Host, ManagedSource, Snippet } from './models';

export type VaultGroupMutationState = {
  groups: string[];
  configs: GroupConfig[];
  hosts: Host[];
  managedSources: ManagedSource[];
  snippets: Snippet[];
};

export type VaultGroupMutationResult =
  | { ok: true; state: VaultGroupMutationState }
  | { ok: false; error: string };
