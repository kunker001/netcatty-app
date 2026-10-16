import type { GroupConfig, Host } from './models';

export type VaultJumpGraphIssue = {
  key: string;
  targetId: string;
  jumpHostId: string;
  kind: 'self' | 'missing' | 'protocol';
  error: string;
};

const identity = (host: Host): Host => host;

export function findVaultGroupConfigJumpReference(
  configs: GroupConfig[],
  hostId: string,
): GroupConfig | undefined {
  return configs.find((config) => config.hostChain?.hostIds?.includes(hostId));
}

export function collectVaultJumpGraphIssues(
  hosts: Host[],
  resolveEffectiveHost: (host: Host) => Host = identity,
): Map<string, VaultJumpGraphIssue> {
  const effectiveHosts = new Map(hosts.map((host) => [host.id, resolveEffectiveHost(host)]));
  const issues = new Map<string, VaultJumpGraphIssue>();

  for (const [targetId, target] of effectiveHosts) {
    for (const jumpHostId of target.hostChain?.hostIds ?? []) {
      if (jumpHostId === targetId) {
        const issue: VaultJumpGraphIssue = {
          key: `${targetId}:${jumpHostId}:self`,
          targetId,
          jumpHostId,
          kind: 'self',
          error: `Host "${targetId}" cannot use itself as an inherited jump host.`,
        };
        issues.set(issue.key, issue);
        continue;
      }

      const jumpHost = effectiveHosts.get(jumpHostId);
      if (!jumpHost) {
        const issue: VaultJumpGraphIssue = {
          key: `${targetId}:${jumpHostId}:missing`,
          targetId,
          jumpHostId,
          kind: 'missing',
          error: `Jump host "${jumpHostId}" was not found.`,
        };
        issues.set(issue.key, issue);
        continue;
      }

      if (jumpHost.protocol !== undefined && jumpHost.protocol !== 'ssh') {
        const issue: VaultJumpGraphIssue = {
          key: `${targetId}:${jumpHostId}:protocol`,
          targetId,
          jumpHostId,
          kind: 'protocol',
          error: `Jump host "${jumpHostId}" does not support SSH jump connections.`,
        };
        issues.set(issue.key, issue);
      }
    }
  }

  return issues;
}

export function findIntroducedVaultJumpGraphIssue(
  beforeHosts: Host[],
  afterHosts: Host[],
  resolveBefore: (host: Host) => Host = identity,
  resolveAfter: (host: Host) => Host = resolveBefore,
): VaultJumpGraphIssue | undefined {
  const previousIssues = collectVaultJumpGraphIssues(beforeHosts, resolveBefore);
  return [...collectVaultJumpGraphIssues(afterHosts, resolveAfter).values()]
    .find((issue) => !previousIssues.has(issue.key));
}
