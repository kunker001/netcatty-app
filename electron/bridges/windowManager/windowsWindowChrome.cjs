/**
 * Windows frameless window chrome helpers.
 *
 * Background (#2505):
 * - Frameless Win11 windows need an explicit `roundedCorners: true` so DWM
 *   applies the system round clip (Electron 34+).
 * - Transparent tray popups that keep the default opaque white backdrop + CSS
 *   `border-radius` produce square tips under a rounded panel.
 *
 * Approach:
 * - App content windows (resizable): solid host + native `roundedCorners`.
 *   Do NOT set `transparent: true` here - Electron documents transparent
 *   windows as not resizable, and `resizable: true` can break them
 *   (https://www.electronjs.org/docs/latest/tutorial/custom-window-styles).
 * - Tray / CSS-shaped popovers (`resizable: false`): transparent host + clear
 *   backdrop + `roundedCorners: false` so only the CSS radius defines the
 *   silhouette (Electron #46468: Win11 otherwise forces OS rounding on
 *   transparent windows).
 */

const CLEAR_BACKGROUND = "#00000000";

function isWindowsPlatform(platform = process.platform) {
  return platform === "win32";
}

/**
 * Options for full-bleed app windows (main / settings / terminal popup).
 * Safe to spread on non-Windows - returns an empty object.
 */
function windowsFramelessContentChromeOptions(platform = process.platform) {
  if (!isWindowsPlatform(platform)) return {};
  return {
    roundedCorners: true,
  };
}

/**
 * Options for CSS-rounded overlay windows (tray panel).
 * Always apply when creating those windows; callers already opt into transparency.
 */
function windowsCssRoundedOverlayChromeOptions(platform = process.platform) {
  return {
    transparent: true,
    backgroundColor: CLEAR_BACKGROUND,
    // Overlay shape comes from CSS; keep OS rounding off on Win11.
    ...(isWindowsPlatform(platform) ? { roundedCorners: false } : {}),
  };
}

module.exports = {
  CLEAR_BACKGROUND,
  isWindowsPlatform,
  windowsFramelessContentChromeOptions,
  windowsCssRoundedOverlayChromeOptions,
};
