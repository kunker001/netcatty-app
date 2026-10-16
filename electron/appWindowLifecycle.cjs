"use strict";

/**
 * Electron's window-all-closed event includes hidden plugin host windows. Use
 * the WindowManager's explicit app-content registry to decide when the user
 * has closed the last Netcatty window instead.
 */
function createAppContentWindowClosedHandler(options) {
  const { app, windowManager, platform = process.platform } = options;
  if (!app || typeof app.quit !== "function") {
    throw new TypeError("App content window lifecycle requires app.quit()");
  }
  if (!windowManager || typeof windowManager.getAppContentWindows !== "function") {
    throw new TypeError("App content window lifecycle requires WindowManager content tracking");
  }

  return function handleAppContentWindowClosed() {
    if (platform === "darwin" || windowManager.getIsQuitting?.()) return false;
    const remaining = windowManager.getAppContentWindows();
    if (!Array.isArray(remaining) || remaining.length > 0) return false;
    app.quit();
    return true;
  };
}

module.exports = { createAppContentWindowClosedHandler };
