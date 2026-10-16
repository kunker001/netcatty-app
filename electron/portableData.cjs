const fs = require("node:fs");
const path = require("node:path");

function applyPortableDataDirectory({
  app,
  env = process.env,
  platform = process.platform,
}) {
  if (platform !== "win32" || !app?.isPackaged) return null;

  const portableLauncherDirectory = typeof env?.PORTABLE_EXECUTABLE_DIR === "string"
    ? env.PORTABLE_EXECUTABLE_DIR.trim()
    : "";
  const baseDirectory = portableLauncherDirectory || path.dirname(app.getPath("exe"));
  const dataDirectory = path.join(baseDirectory, "data");
  if (!fs.existsSync(dataDirectory) || !fs.statSync(dataDirectory).isDirectory()) {
    return null;
  }

  app.setPath("userData", dataDirectory);
  app.setPath("sessionData", dataDirectory);
  return {
    dataDirectory,
    source: portableLauncherDirectory
      ? "portable-launcher-directory"
      : "executable-directory",
  };
}

module.exports = { applyPortableDataDirectory };
