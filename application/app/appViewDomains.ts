/**
 * Domain-scoped wiring for the main window shell.
 * App re-renders may rebuild the parent, but AppView only re-renders when one
 * of these domain slice identities changes.
 */

export type AppViewDomainBag = Record<string, unknown>;

export type AppViewDomains = {
  /** Vault hosts/keys/notes/snippets (not shellHistory — that uses shellHistoryStore). */
  vault: AppViewDomainBag;
  /** Terminal sessions/workspaces/SFTP settings and terminal-layer handlers. */
  terminal: AppViewDomainBag;
  /** Top chrome: tabs, theme chrome, sync, host tree related. */
  chrome: AppViewDomainBag;
  /** Modals, queues, rename targets, quick switcher. */
  dialogs: AppViewDomainBag;
  /** Lazy mount components (stable module references). */
  mounts: AppViewDomainBag;
};

export function mergeAppViewDomains(domains: AppViewDomains): AppViewDomainBag {
  return {
    ...domains.vault,
    ...domains.terminal,
    ...domains.chrome,
    ...domains.dialogs,
    ...domains.mounts,
  };
}

export function appViewDomainsEqual(
  prev: AppViewDomains,
  next: AppViewDomains,
): boolean {
  return prev.vault === next.vault
    && prev.terminal === next.terminal
    && prev.chrome === next.chrome
    && prev.dialogs === next.dialogs
    && prev.mounts === next.mounts;
}
