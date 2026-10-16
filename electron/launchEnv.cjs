/**
 * Electron rejects certain Node CLI flags in NODE_OPTIONS (exit code 9), notably
 * `--openssl-legacy-provider`. Shell profiles sometimes set that for older Node
 * tooling; strip Electron-incompatible tokens so `npm run dev` can start.
 */
function sanitizeNodeOptionsForElectron(nodeOptions) {
  if (nodeOptions == null || nodeOptions === "") return undefined;
  const cleaned = String(nodeOptions)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token !== "--openssl-legacy-provider")
    .join(" ")
    .trim();
  return cleaned || undefined;
}

function applyElectronLaunchEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  delete env.ELECTRON_RUN_AS_NODE;

  const sanitizedNodeOptions = sanitizeNodeOptionsForElectron(env.NODE_OPTIONS);
  if (sanitizedNodeOptions === undefined) delete env.NODE_OPTIONS;
  else env.NODE_OPTIONS = sanitizedNodeOptions;

  return env;
}

module.exports = {
  sanitizeNodeOptionsForElectron,
  applyElectronLaunchEnv,
};
