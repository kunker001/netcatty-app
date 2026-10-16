"use strict";

const THEME_ICON_SHAPES = Object.freeze({
  activity: '<polyline points="3 12 7 12 10 4 14 20 17 12 21 12"/>',
  box: '<path d="M4 7l8-4 8 4-8 4-8-4zm0 0v10l8 4 8-4V7M12 11v10"/>',
  code: '<polyline points="8 9 4 12 8 15M16 9l4 3-4 3M14 5l-4 14"/>',
  command: '<path d="M9 6V5a3 3 0 10-3 3h12a3 3 0 10-3-3v14a3 3 0 103-3H6a3 3 0 103 3V6z"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4"/>',
  folder: '<path d="M3 6h7l2 2h9v11H3z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M15 8l3 3M17 6l2 2"/>',
  "layout-panel": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M9 10h12"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  network: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v5M5 17v-3h14v3"/>',
  palette: '<path d="M12 3a9 9 0 100 18h2a2 2 0 001-3l-1-1a2 2 0 012-3h2a3 3 0 003-3 8 8 0 00-9-8z"/><path d="M7 10h.01M9 6h.01M14 6h.01M17 10h.01"/>',
  play: '<polygon points="8,5 19,12 8,19"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1l2-2-2-3-3 1a7 7 0 00-2-1l-1-3H9L8 6a7 7 0 00-2 1L3 6 1 9l2 2a7 7 0 000 2l-2 2 2 3 3-1a7 7 0 002 1l1 3h4l1-3a7 7 0 002-1l3 1 2-3-2-2a7 7 0 00.1-1z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3 8-8 10-5-2-8-5-8-10V6z"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M9 4v16M15 4v16"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 16h5"/>',
  wrench: '<path d="M14 6a5 5 0 01-6 6l-5 5a3 3 0 004 4l5-5a5 5 0 006-6l-3 2-3-3z"/>',
});

function createThemeContributionNativeImage(nativeImage, icon, dark = false) {
  if (!nativeImage?.createFromDataURL || icon?.kind !== "theme") return undefined;
  const shape = THEME_ICON_SHAPES[icon.name] ?? '<path d="M8 8a4 4 0 118 0c0 3-4 3-4 6M12 18h.01"/>';
  const color = dark ? "white" : "black";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  return image?.isEmpty?.() ? undefined : image;
}

function resolveApplicationMenuIconReference(menu, commandById) {
  return menu?.icon ?? commandById?.get?.(menu?.command)?.icon;
}

module.exports = {
  THEME_ICON_SHAPES,
  createThemeContributionNativeImage,
  resolveApplicationMenuIconReference,
};
