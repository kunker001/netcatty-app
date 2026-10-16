/** Pure helpers for the terminal cursor-line highlight (WindTerm-style). */

export type CursorLineHighlightColors = {
  background: string;
  foreground: string;
  selection: string;
};

const HEX_RGB_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

type Rgb = { r: number; g: number; b: number };

const MIN_CURSOR_LINE_CONTRAST = 4.5;

const parseHexRgb = (value: string): Rgb | null => {
  const match = value.trim().match(HEX_RGB_RE);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex.split('').map((ch) => ch + ch).join('');
  } else if (hex.length === 8) {
    hex = hex.slice(0, 6);
  }
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if (![r, g, b].every((channel) => Number.isFinite(channel))) return null;
  return { r, g, b };
};

const relativeLuminance = ({ r, g, b }: Rgb): number => {
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
};

const contrastRatio = (left: Rgb, right: Rgb): number => {
  const brighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (brighter + 0.05) / (darker + 0.05);
};

const mixRgb = (base: Rgb, accent: Rgb, amount: number): Rgb => ({
  r: Math.round(base.r + (accent.r - base.r) * amount),
  g: Math.round(base.g + (accent.g - base.g) * amount),
  b: Math.round(base.b + (accent.b - base.b) * amount),
});

const toHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

/** Keep the cursor-row background readable against other foreground decorations. */
export const ensureCursorLineHighlightContrast = (
  backgroundColor: string,
  foregroundColors: readonly string[],
): string => {
  const background = parseHexRgb(backgroundColor);
  const foregrounds = foregroundColors
    .map(parseHexRgb)
    .filter((color): color is Rgb => color !== null);
  if (!background || foregrounds.length === 0) return backgroundColor;
  const contrastScore = (candidate: Rgb) =>
    Math.min(...foregrounds.map((foreground) => contrastRatio(candidate, foreground)));
  const baseScore = contrastScore(background);
  if (baseScore >= MIN_CURSOR_LINE_CONTRAST) return backgroundColor;

  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  const blackScore = contrastScore(black);
  const whiteScore = contrastScore(white);
  if (blackScore >= MIN_CURSOR_LINE_CONTRAST && blackScore >= whiteScore) return '#000000';
  if (whiteScore >= MIN_CURSOR_LINE_CONTRAST) return '#ffffff';
  return blackScore >= Math.max(baseScore, whiteScore) ? '#000000' : '#ffffff';
};

/** Strength of the theme accent mixed into the terminal background. */
export const CURSOR_LINE_HIGHLIGHT_BLEND = 0.55;

/**
 * Resolve an opaque background for the cursor line decoration.
 * Prefers selection over foreground so the highlight stays theme-aligned.
 * The renderer applies this only to cells with the default background, which
 * keeps ANSI-colored cells and the terminal's text foreground untouched.
 */
export const resolveCursorLineHighlightBackground = (
  colors: CursorLineHighlightColors,
): string => {
  const background = parseHexRgb(colors.background) ?? { r: 13, g: 17, b: 23 };
  const backgroundLuminance =
    background.r * 0.299 + background.g * 0.587 + background.b * 0.114;
  const overlay =
    parseHexRgb(colors.selection) ??
    parseHexRgb(colors.foreground) ??
    (backgroundLuminance >= 128
      ? { r: 0, g: 0, b: 0 }
      : { r: 255, g: 255, b: 255 });
  const foreground =
    parseHexRgb(colors.foreground) ??
    (backgroundLuminance >= 128
      ? { r: 0, g: 0, b: 0 }
      : { r: 255, g: 255, b: 255 });
  const contrastSafeAccents = [overlay, { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
  const baseContrast = contrastRatio(background, foreground);
  let mixed = background;
  let bestContrast = baseContrast;
  for (const [accentIndex, accent] of contrastSafeAccents.entries()) {
    const maxAmount = accentIndex === 0 ? CURSOR_LINE_HIGHLIGHT_BLEND : 1;
    for (let step = 20; step >= 0; step -= 1) {
      const amount = maxAmount * (step / 20);
      const candidate = mixRgb(background, accent, amount);
      const candidateContrast = contrastRatio(candidate, foreground);
      if (candidateContrast > bestContrast) {
        mixed = candidate;
        bestContrast = candidateContrast;
      }
      if (step > 0 && candidateContrast >= MIN_CURSOR_LINE_CONTRAST) {
        mixed = candidate;
        return toHex(mixed);
      }
    }
  }
  return toHex(mixed);
};
