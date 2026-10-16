import type { TerminalSettings } from "./models/terminal";

/**
 * Inline raster image output (Kitty graphics, SIXEL, iTerm IIP) rendered by
 * `@xterm/addon-image`. The addon keeps decoded bitmaps outside the terminal
 * buffer, so every limit here is a memory guard rather than a cosmetic option:
 *
 * - `storageLimit` caps the FIFO image cache of a single terminal (MB, RGBA8888).
 * - `pixelLimit` caps a single decoded image; the decoder holds up to two pixel
 *   buffers of that size while working, so 4 bytes * pixels * 2 is the transient
 *   peak per decoding terminal.
 * - the sequence limit caps the raw escape-sequence payload before decoding, so
 *   an oversized or corrupt sequence is rejected before it allocates anything.
 */

/** Compile-time kill switch for inline terminal images. */
export const TERMINAL_INLINE_IMAGES_ENABLED = true;

/** Per-terminal image cache size in MB. */
export const TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_DEFAULT = 128;

export const TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_MIN = 8;

export const TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_MAX = 512;

/** Largest single decoded image, in megapixels (16 MP == 4096 x 4096). */
export const TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_DEFAULT = 16;

export const TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_MIN = 1;

export const TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_MAX = 64;

/** Largest single image escape sequence, in MB, before decoding is attempted. */
export const TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_DEFAULT = 24;

export const TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_MIN = 1;

export const TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_MAX = 64;

const BYTES_PER_MB = 1024 * 1024;

const PIXELS_PER_MEGAPIXEL = 1024 * 1024;

const clampInteger = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
};

export function normalizeInlineImageStorageLimitMb(value: unknown): number {
  return clampInteger(
    value,
    TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_MIN,
    TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_MAX,
    TERMINAL_INLINE_IMAGE_STORAGE_LIMIT_MB_DEFAULT,
  );
}

export function normalizeInlineImageMaxMegapixels(value: unknown): number {
  return clampInteger(
    value,
    TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_MIN,
    TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_MAX,
    TERMINAL_INLINE_IMAGE_MAX_MEGAPIXELS_DEFAULT,
  );
}

export function normalizeInlineImageSequenceLimitMb(value: unknown): number {
  return clampInteger(
    value,
    TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_MIN,
    TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_MAX,
    TERMINAL_INLINE_IMAGE_SEQUENCE_LIMIT_MB_DEFAULT,
  );
}

export type TerminalInlineImageSettings = Pick<
  TerminalSettings,
  | "inlineImagesEnabled"
  | "inlineImageKittyEnabled"
  | "inlineImageSixelEnabled"
  | "inlineImageIipEnabled"
  | "inlineImageStorageLimitMb"
  | "inlineImageMaxMegapixels"
  | "inlineImageSequenceLimitMb"
>;

/**
 * Structural mirror of `IImageAddonOptions` from `@xterm/addon-image`. Declared
 * here so the domain layer stays free of renderer dependencies; the runtime
 * passes the result straight into the addon constructor.
 */
export type TerminalInlineImageAddonOptions = {
  enableSizeReports: boolean;
  pixelLimit: number;
  storageLimit: number;
  showPlaceholder: boolean;
  sixelSupport: boolean;
  sixelSizeLimit: number;
  iipSupport: boolean;
  iipSizeLimit: number;
  kittySupport: boolean;
  kittySizeLimit: number;
};

export function resolveTerminalInlineImagesEnabled(
  settings?: Partial<TerminalInlineImageSettings> | null,
): boolean {
  if (!TERMINAL_INLINE_IMAGES_ENABLED) return false;
  if (settings?.inlineImagesEnabled !== true) return false;
  return (
    settings.inlineImageKittyEnabled === true
    || settings.inlineImageSixelEnabled === true
    || settings.inlineImageIipEnabled === true
  );
}

/**
 * Build the addon options for a terminal, or `null` when inline images are off
 * (master switch, or every protocol disabled). A `null` result means the addon
 * must not be loaded at all, so the terminal keeps advertising no graphics
 * capability to the remote side.
 */
export function resolveTerminalInlineImageAddonOptions(
  settings?: Partial<TerminalInlineImageSettings> | null,
): TerminalInlineImageAddonOptions | null {
  if (!resolveTerminalInlineImagesEnabled(settings)) return null;
  const sequenceLimitBytes =
    normalizeInlineImageSequenceLimitMb(settings?.inlineImageSequenceLimitMb) * BYTES_PER_MB;
  return {
    // Image producers need CSI 14/16/18 t to size their output to the grid.
    enableSizeReports: true,
    pixelLimit:
      normalizeInlineImageMaxMegapixels(settings?.inlineImageMaxMegapixels) * PIXELS_PER_MEGAPIXEL,
    storageLimit: normalizeInlineImageStorageLimitMb(settings?.inlineImageStorageLimitMb),
    showPlaceholder: true,
    sixelSupport: settings?.inlineImageSixelEnabled === true,
    sixelSizeLimit: sequenceLimitBytes,
    iipSupport: settings?.inlineImageIipEnabled === true,
    iipSizeLimit: sequenceLimitBytes,
    kittySupport: settings?.inlineImageKittyEnabled === true,
    kittySizeLimit: sequenceLimitBytes,
  };
}
