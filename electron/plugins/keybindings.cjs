"use strict";

const MODIFIERS = new Map([
  ["alt", "Alt"],
  ["cmd", "Command"],
  ["cmdorctrl", "CommandOrControl"],
  ["command", "Command"],
  ["commandorcontrol", "CommandOrControl"],
  ["control", "Control"],
  ["ctrl", "Control"],
  ["meta", "Command"],
  ["mod", "CommandOrControl"],
  ["option", "Alt"],
  ["shift", "Shift"],
]);
const PRIMARY_MODIFIERS = new Set(["Command", "CommandOrControl", "Control"]);

const NAMED_KEYS = new Map([
  ["arrowdown", "Down"],
  ["arrowleft", "Left"],
  ["arrowright", "Right"],
  ["arrowup", "Up"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["down", "Down"],
  ["end", "End"],
  ["enter", "Enter"],
  ["escape", "Esc"],
  ["esc", "Esc"],
  ["home", "Home"],
  ["insert", "Insert"],
  ["left", "Left"],
  ["minus", "-"],
  ["pagedown", "PageDown"],
  ["pageup", "PageUp"],
  ["plus", "+"],
  ["right", "Right"],
  ["space", "Space"],
  ["tab", "Tab"],
  ["up", "Up"],
]);

function toElectronAccelerator(shortcut) {
  if (typeof shortcut !== "string" || shortcut.length < 1 || shortcut.length > 128) return undefined;
  const tokens = shortcut.split("+").map((token) => token.trim());
  if (tokens.some((token) => token.length === 0) || tokens.length > 5) return undefined;
  const modifiers = [];
  const seen = new Set();
  let key;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const modifier = MODIFIERS.get(lower);
    if (modifier) {
      if (key || seen.has(modifier)
        || (PRIMARY_MODIFIERS.has(modifier) && [...seen].some((item) => PRIMARY_MODIFIERS.has(item)))) {
        return undefined;
      }
      seen.add(modifier);
      modifiers.push(modifier);
      continue;
    }
    if (key) return undefined;
    if (/^[a-z0-9]$/u.test(lower)) key = lower.toUpperCase();
    else if (/^f(?:[1-9]|1[0-9]|2[0-4])$/u.test(lower)) key = lower.toUpperCase();
    else key = NAMED_KEYS.get(lower);
    if (!key) return undefined;
  }
  return key ? [...modifiers, key].join("+") : undefined;
}

module.exports = { toElectronAccelerator };
