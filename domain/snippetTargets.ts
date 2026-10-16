import type { Host, Snippet } from './models';
import { hostMatchesGroupPath } from './selectHostSelection.ts';
import { normalizeGroupTargetPath } from './hostGroupPathMutations.ts';
import { isScriptSnippet } from './snippetScript.ts';

/** Whether the snippet has a runnable scope (explicit targets or all-hosts flag). */
export function snippetHasRunTargets(
  snippet: Pick<Snippet, 'targets' | 'targetGroups' | 'targetsAllHosts'>,
): boolean {
  if (snippet.targetsAllHosts) return true;
  return Boolean(
    (snippet.targets && snippet.targets.length > 0)
    || (snippet.targetGroups && snippet.targetGroups.length > 0),
  );
}

export type SnippetTargetHost = Pick<Host, 'id' | 'group'>;

export function snippetTargetsHostExplicitly(
  snippet: Pick<Snippet, 'targets'>,
  hostId: string,
): boolean {
  return Boolean(snippet.targets?.includes(hostId));
}

export function snippetTargetsHostGroup(
  snippet: Pick<Snippet, 'targetGroups'>,
  host: Pick<Host, 'group'>,
): boolean {
  return Boolean(snippet.targetGroups?.some(
    (groupPath) => hostMatchesGroupPath(host, normalizeGroupTargetPath(groupPath)),
  ));
}

/** Keep legacy unscoped onOutput semantics distinct from a deleted/cleared group scope. */
export function resolveSnippetTargetGroupsForSave(
  snippet: Pick<Snippet, 'targetGroups' | 'targetsAllHosts'>,
  selectedGroupPaths: string[],
): string[] | undefined {
  if (snippet.targetsAllHosts) return undefined;
  if (snippet.targetGroups === undefined && selectedGroupPaths.length === 0) {
    return undefined;
  }
  return selectedGroupPaths;
}

function normalizeTargetHost(hostOrId?: SnippetTargetHost | string): SnippetTargetHost | undefined {
  if (typeof hostOrId === 'string') return { id: hostOrId };
  return hostOrId;
}

/** Connectable hosts for manual run / save-and-run. */
export function getRunnableHostsForSnippet(
  snippet: Pick<Snippet, 'targets' | 'targetGroups' | 'targetsAllHosts'>,
  hosts: Host[],
): Host[] {
  const connectable = hosts.filter((host) => host.protocol !== 'serial');
  if (snippet.targetsAllHosts) return connectable;
  const idSet = new Set(snippet.targets ?? []);
  return connectable.filter(
    (host) => idSet.has(host.id) || snippetTargetsHostGroup(snippet, host),
  );
}

/** Whether a snippet/script applies to the given host based on targets or all-hosts flag. */
export function snippetAppliesToHost(
  snippet: Pick<Snippet, 'targets' | 'targetGroups' | 'targetsAllHosts'>,
  hostOrId?: SnippetTargetHost | string,
): boolean {
  const host = normalizeTargetHost(hostOrId);
  if (!host) return false;
  if (snippet.targetsAllHosts) return true;
  return snippetTargetsHostExplicitly(snippet, host.id)
    || snippetTargetsHostGroup(snippet, host);
}

/** Whether a library/shortcut invocation may run in the current terminal. */
export function snippetCanRunInTerminal(
  snippet: Pick<Snippet, 'targets' | 'targetGroups' | 'targetsAllHosts'>,
  host: SnippetTargetHost,
): boolean {
  if (snippet.targetsAllHosts) return true;
  const hasScopedTargets = Boolean(
    snippet.targets?.length || snippet.targetGroups !== undefined,
  );
  return !hasScopedTargets || snippetAppliesToHost(snippet, host);
}

/**
 * onOutput triggers listen on the active terminal session. When no explicit targets
 * are configured, they apply to whichever host the session is connected to.
 */
export function snippetAppliesToOutputTrigger(
  snippet: Pick<Snippet, 'trigger' | 'targets' | 'targetGroups' | 'targetsAllHosts'>,
  hostOrId?: SnippetTargetHost | string,
): boolean {
  if (snippet.trigger !== 'onOutput') return false;
  const host = normalizeTargetHost(hostOrId);
  if (!host) return false;
  if (snippet.targetsAllHosts) return true;
  if (snippet.targets?.length || snippet.targetGroups !== undefined) {
    return snippetAppliesToHost(snippet, host);
  }
  return true;
}

/** Scripts explicitly linked to a host via targets (excludes all-hosts scripts). */
export function getScriptsLinkedToHost(snippets: Snippet[], hostId: string): Snippet[] {
  return snippets.filter(
    (snippet) => isScriptSnippet(snippet)
      && !snippet.targetsAllHosts
      && Boolean(snippet.targets?.includes(hostId)),
  );
}

export function linkHostToScript(snippet: Snippet, hostId: string): Snippet {
  const targets = snippet.targets ?? [];
  if (targets.includes(hostId)) {
    return { ...snippet, targetsAllHosts: undefined };
  }
  return {
    ...snippet,
    targets: [...targets, hostId],
    targetsAllHosts: undefined,
  };
}

export function unlinkHostFromScript(snippet: Snippet, hostId: string): Snippet {
  const targets = snippet.targets ?? [];
  if (!targets.includes(hostId)) return snippet;
  const nextTargets = targets.filter((id) => id !== hostId);
  return { ...snippet, targets: nextTargets.length > 0 ? nextTargets : undefined };
}

export function unlinkHostFromScripts(snippets: Snippet[], hostId: string, scriptId: string): Snippet[] {
  return snippets.map((snippet) => (
    snippet.id === scriptId ? unlinkHostFromScript(snippet, hostId) : snippet
  ));
}
