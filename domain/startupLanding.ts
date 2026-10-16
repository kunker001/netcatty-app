/**
 * App startup landing preference (Settings → System).
 *
 * - `vault` (default): open the home / host picker
 * - `local-terminal`: open a local terminal when there is nothing to restore
 */
export type StartupLanding = 'vault' | 'local-terminal';

export const DEFAULT_STARTUP_LANDING: StartupLanding = 'vault';

export function isStartupLanding(value: unknown): value is StartupLanding {
  return value === 'vault' || value === 'local-terminal';
}

export function resolveStartupLandingSetting(stored: string | null | undefined): StartupLanding {
  return isStartupLanding(stored) ? stored : DEFAULT_STARTUP_LANDING;
}

/**
 * Whether the main window should create a local terminal on cold start.
 * Session restore, peer/new windows, and queued startup launch intents
 * (ssh/telnet/jms deep links, Explorer "open terminal here") take precedence.
 */
export function shouldOpenLocalTerminalOnStartup(input: {
  startupLanding: StartupLanding;
  hasRestoredSessionState: boolean;
  isPeerSessionWindow: boolean;
  hasQueuedStartupIntent?: boolean;
}): boolean {
  if (input.isPeerSessionWindow) return false;
  if (input.hasRestoredSessionState) return false;
  if (input.hasQueuedStartupIntent) return false;
  return input.startupLanding === 'local-terminal';
}
